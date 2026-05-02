"""
Living Architecture Decision Records.

When a team makes a significant architectural change — switching libraries,
changing an API style, migrating a database — that decision usually lives
nowhere except in a Slack thread. Six months later the new engineer asks
"why did we choose X?" and nobody remembers.

This feature:
  1. Auto-detects "shift events" from real git history — moments where a major
     dependency changed, a manifest had a notable swap, or a directory's
     dominant pattern flipped.

  2. Prompts the team to file a structured ADR for each detected shift.

  3. Stores ADRs in the database (linked to the repo) so they're searchable
     and inspectable later.

The detection is grounded in real commit data — we never invent decisions.
"""

from __future__ import annotations
import json
import logging
import re
from collections import Counter, defaultdict
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Literal

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import (
    Column, Integer, String, Text, BigInteger, ForeignKey, DateTime, select,
)
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db, Base
from app.core.security import get_current_user
from app.services.feature_gate import require_feature
from app.models.user import User
from app.models.repository import Repository
from app.services.lab_service import claude_complete_json

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/adrs", tags=["adrs"])


# ─────────────────────────────────────────────────────────────────
# Model — ADR records persisted per repository
# ─────────────────────────────────────────────────────────────────

class ArchitectureDecisionRecord(Base):
    __tablename__ = "architecture_decisions"

    id = Column(Integer, primary_key=True)
    repository_id = Column(Integer, ForeignKey("repositories.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)

    # ADR content
    title = Column(String(255), nullable=False)
    status = Column(String(32), default="proposed")  # proposed | accepted | superseded | deprecated
    context = Column(Text)            # what triggered the decision
    decision = Column(Text)           # what was decided
    consequences = Column(Text)       # what follows from the decision
    alternatives = Column(Text)       # JSON array of alternatives considered

    # Evidence linking back to real signals
    detection_kind = Column(String(64))   # "library_swap", "api_style_change", "db_change", "manual"
    evidence = Column(Text)               # JSON: {commits, files, signals}

    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    decided_at = Column(DateTime)


# ─────────────────────────────────────────────────────────────────
# Schemas
# ─────────────────────────────────────────────────────────────────

class DetectShiftsRequest(BaseModel):
    repository_id: int
    lookback_months: int = Field(6, ge=1, le=24)


class ShiftCandidate(BaseModel):
    kind: str
    title: str
    description: str
    evidence_commits: List[str]
    evidence_files: List[str]
    confidence: int  # 0-100
    detected_at: str


class ShiftDetectionResult(BaseModel):
    repository_id: int
    repository_name: str
    summary: str
    candidates: List[ShiftCandidate]
    generated_at: str


class CreateADRRequest(BaseModel):
    repository_id: int
    title: str
    context: str
    decision: str
    consequences: Optional[str] = ""
    alternatives: Optional[List[str]] = None
    status: Literal["proposed", "accepted", "superseded", "deprecated"] = "accepted"
    detection_kind: str = "manual"
    evidence: Optional[dict] = None


class ADRView(BaseModel):
    id: int
    title: str
    status: str
    context: Optional[str]
    decision: Optional[str]
    consequences: Optional[str]
    alternatives: List[str]
    detection_kind: Optional[str]
    created_at: str
    decided_at: Optional[str]


# ─────────────────────────────────────────────────────────────────
# Endpoints
# ─────────────────────────────────────────────────────────────────

@router.post("/detect",
    dependencies=[Depends(require_feature("adrs"))],  # Team tier
    response_model=ShiftDetectionResult,
)
async def detect_shifts(
    body: DetectShiftsRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Scan recent commits for events that look like architectural shifts.
    Returns candidates the team should consider documenting.
    """
    res = await db.execute(select(Repository).where(Repository.id == body.repository_id))
    repo = res.scalar_one_or_none()
    if not repo:
        raise HTTPException(status_code=404, detail="Repository not found")

    owner, name = repo.full_name.split("/")
    headers = {"Accept": "application/vnd.github+json"}
    if user.github_access_token:
        headers["Authorization"] = f"Bearer {user.github_access_token}"

    since = (datetime.now(timezone.utc) - timedelta(days=body.lookback_months * 30)).isoformat()

    # ── Pull commits that touched manifest files (likely architectural changes) ──
    candidates: list[ShiftCandidate] = []
    manifest_files = ["package.json", "requirements.txt", "pyproject.toml", "Cargo.toml", "go.mod", "Gemfile"]

    async with httpx.AsyncClient(timeout=20) as client:
        # For each manifest, pull commits that touched it
        for manifest in manifest_files:
            try:
                r = await client.get(
                    f"https://api.github.com/repos/{owner}/{name}/commits",
                    headers=headers,
                    params={"path": manifest, "since": since, "per_page": 30},
                )
            except Exception:
                continue
            if r.status_code != 200:
                continue
            commits = r.json()
            if not commits:
                continue

            # Examine each commit's diff for added/removed dep names
            for c in commits[:15]:  # cap per manifest
                sha = c.get("sha", "")
                if not sha:
                    continue
                try:
                    cr = await client.get(
                        f"https://api.github.com/repos/{owner}/{name}/commits/{sha}",
                        headers=headers,
                    )
                except Exception:
                    continue
                if cr.status_code != 200:
                    continue
                cdata = cr.json()

                # Find the manifest file's patch
                for f in cdata.get("files", []):
                    if f.get("filename") != manifest:
                        continue
                    patch = f.get("patch", "")
                    if not patch:
                        continue
                    added, removed = _parse_dep_changes(patch, manifest)
                    if not (added and removed):
                        continue  # need both sides for a "swap"

                    # Real swap detected — meaningful architectural signal
                    msg = c.get("commit", {}).get("message", "").split("\n")[0][:160]
                    date = c.get("commit", {}).get("author", {}).get("date", "")[:10]
                    confidence = 90 if len(added) <= 3 and len(removed) <= 3 else 65

                    candidates.append(ShiftCandidate(
                        kind="library_swap",
                        title=f"Replaced {', '.join(removed[:3])} with {', '.join(added[:3])}",
                        description=(
                            f"Commit \"{msg}\" on {date} removed {', '.join(removed)} "
                            f"and added {', '.join(added)} in {manifest}."
                        ),
                        evidence_commits=[sha[:7]],
                        evidence_files=[manifest],
                        confidence=confidence,
                        detected_at=date,
                    ))

    # ── Also detect API-style changes from file-content shifts ──
    # (e.g., introduction of GraphQL schemas alongside REST routes, gRPC files appearing, etc.)
    api_patterns = await _detect_api_style_shifts(db, repo.id)
    candidates.extend(api_patterns)

    # Cap and dedupe — sometimes the same swap shows up across multiple commits
    seen_titles: set[str] = set()
    unique = []
    for c in candidates:
        key = c.title.lower()
        if key in seen_titles:
            continue
        seen_titles.add(key)
        unique.append(c)
    unique = unique[:12]

    summary = (
        f"Detected {len(unique)} potential architectural shift(s) in the last {body.lookback_months} months. "
        "Consider documenting them as ADRs."
        if unique else
        f"No notable architectural shifts detected in the last {body.lookback_months} months."
    )

    return ShiftDetectionResult(
        repository_id=repo.id,
        repository_name=repo.full_name,
        summary=summary,
        candidates=unique,
        generated_at=datetime.now(timezone.utc).isoformat(),
    )


@router.post("/create",
    dependencies=[Depends(require_feature("adrs"))],
    response_model=ADRView,
)
async def create_adr(
    body: CreateADRRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a new ADR record."""
    res = await db.execute(select(Repository).where(Repository.id == body.repository_id))
    repo = res.scalar_one_or_none()
    if not repo:
        raise HTTPException(status_code=404, detail="Repository not found")

    adr = ArchitectureDecisionRecord(
        repository_id=body.repository_id,
        user_id=user.id,
        title=body.title,
        status=body.status,
        context=body.context,
        decision=body.decision,
        consequences=body.consequences or "",
        alternatives=json.dumps(body.alternatives or []),
        detection_kind=body.detection_kind,
        evidence=json.dumps(body.evidence or {}),
        decided_at=datetime.now(timezone.utc) if body.status == "accepted" else None,
    )
    db.add(adr)
    await db.commit()
    await db.refresh(adr)
    return _adr_view(adr)


@router.get("/{repository_id}", response_model=List[ADRView])
async def list_adrs(
    repository_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List all ADRs for a repository."""
    res = await db.execute(
        select(ArchitectureDecisionRecord)
        .where(ArchitectureDecisionRecord.repository_id == repository_id)
        .order_by(ArchitectureDecisionRecord.created_at.desc())
    )
    return [_adr_view(a) for a in res.scalars().all()]


@router.post("/draft",
    dependencies=[Depends(require_feature("adrs"))],
)
async def draft_adr_from_candidate(
    repository_id: int,
    candidate: ShiftCandidate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    LLM drafts an ADR from a detected shift candidate. The LLM only fills in
    structure — context/decision/consequences sentences — based on the real
    evidence we pass it. It MUST NOT invent specifics outside of that.
    """
    prompt = (
        f"REPOSITORY: {repository_id}\n"
        f"DETECTED SHIFT: {candidate.title}\n"
        f"DESCRIPTION (from REAL git data): {candidate.description}\n"
        f"EVIDENCE COMMITS: {candidate.evidence_commits}\n"
        f"EVIDENCE FILES: {candidate.evidence_files}\n"
        f"DETECTED AT: {candidate.detected_at}\n\n"
        "Draft a concise ADR following the standard format. Stay grounded in the REAL "
        "evidence above — DO NOT INVENT additional context or consequences not implied "
        "by the swap itself.\n\n"
        "Return STRICT JSON: {\n"
        "  \"title\": str,\n"
        "  \"context\": str (2-3 sentences about what was true before),\n"
        "  \"decision\": str (1-2 sentences about what changed),\n"
        "  \"consequences\": str (2-3 sentences about implications, both positive and negative),\n"
        "  \"alternatives\": [str] (libraries/approaches that could have been chosen instead)\n"
        "}"
    )
    try:
        result = await claude_complete_json(
            system="You draft ADRs from REAL detected shifts. Never invent specifics. Return STRICT JSON.",
            prompt=prompt,
        )
    except Exception:
        result = {}

    return {
        "title": result.get("title") or candidate.title,
        "context": result.get("context") or candidate.description,
        "decision": result.get("decision") or "",
        "consequences": result.get("consequences") or "",
        "alternatives": result.get("alternatives") or [],
        "detection_kind": candidate.kind,
        "evidence": {
            "commits": candidate.evidence_commits,
            "files": candidate.evidence_files,
            "confidence": candidate.confidence,
        },
    }


# ─────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────

def _parse_dep_changes(patch: str, manifest: str) -> tuple[list[str], list[str]]:
    """Extract added/removed dependency names from a manifest diff."""
    added, removed = [], []
    name_pattern = re.compile(r'"?([a-zA-Z0-9_\-\.]+)"?\s*[:=]\s*"?[\w\-\.\^~>=<]+"?')
    for line in patch.splitlines():
        if not line or line.startswith("+++") or line.startswith("---") or line.startswith("@@"):
            continue
        if line.startswith("+"):
            m = name_pattern.search(line[1:])
            if m and m.group(1) not in ("name", "version", "description", "main"):
                added.append(m.group(1))
        elif line.startswith("-"):
            m = name_pattern.search(line[1:])
            if m and m.group(1) not in ("name", "version", "description", "main"):
                removed.append(m.group(1))

    # Treat overlapping names as version bumps, not swaps — exclude them
    overlap = set(added) & set(removed)
    added = [a for a in added if a not in overlap]
    removed = [r for r in removed if r not in overlap]
    return added, removed


async def _detect_api_style_shifts(db, repo_id: int) -> list[ShiftCandidate]:
    """
    Look at indexed file content for API-style coexistence: are there
    GraphQL schemas alongside REST routes? Both gRPC and REST? This often
    indicates a transition in progress.
    """
    from app.models.repository import RepoFile
    res = await db.execute(
        select(RepoFile.path).where(RepoFile.repository_id == repo_id)
    )
    paths = [p for p, in res]

    has_graphql = any(p.endswith(".graphql") or "schema.graphql" in p for p in paths)
    has_grpc = any(p.endswith(".proto") for p in paths)
    has_rest_routes = any("/routes/" in p or "/endpoints/" in p or "/api/" in p for p in paths)
    has_openapi = any("openapi.yaml" in p or "swagger.yaml" in p or "openapi.json" in p for p in paths)

    out: list[ShiftCandidate] = []
    today = datetime.now(timezone.utc).date().isoformat()

    if has_graphql and has_rest_routes:
        out.append(ShiftCandidate(
            kind="api_style_coexistence",
            title="GraphQL and REST coexist in this repository",
            description="Both GraphQL schema files and REST endpoint files exist. This often indicates a transition in progress that warrants documenting.",
            evidence_commits=[],
            evidence_files=[p for p in paths if p.endswith(".graphql")][:3] +
                          [p for p in paths if "/routes/" in p or "/endpoints/" in p][:3],
            confidence=70,
            detected_at=today,
        ))
    if has_grpc and has_rest_routes:
        out.append(ShiftCandidate(
            kind="api_style_coexistence",
            title="gRPC and REST coexist in this repository",
            description=".proto files and REST endpoint files both exist. This often indicates a transition that should be documented.",
            evidence_commits=[],
            evidence_files=[p for p in paths if p.endswith(".proto")][:3],
            confidence=70,
            detected_at=today,
        ))
    return out


def _adr_view(a: ArchitectureDecisionRecord) -> ADRView:
    try:
        alts = json.loads(a.alternatives) if a.alternatives else []
    except Exception:
        alts = []
    return ADRView(
        id=a.id,
        title=a.title,
        status=a.status,
        context=a.context,
        decision=a.decision,
        consequences=a.consequences,
        alternatives=alts,
        detection_kind=a.detection_kind,
        created_at=a.created_at.isoformat() if a.created_at else "",
        decided_at=a.decided_at.isoformat() if a.decided_at else None,
    )
