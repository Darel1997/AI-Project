"""
Tribal Knowledge Capture — uses REAL git history.

Pipeline:
  1. Get the contributor's actual commits via GitHub commits API filtered by ?author=
  2. Aggregate by file path → real ownership percentages from real commit counts
  3. Identify high-risk files (only this person has touched them recently)
  4. Use LLM only to write the narrative + describe what knowledge that contributor
     likely carries (grounded in the real file list and real commit messages)

Replaces the previous version that hypothesized ownership from semantic search.
"""

from __future__ import annotations
import logging
import json
from collections import defaultdict, Counter
from datetime import datetime, timezone, timedelta
from typing import List, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.crypto import get_github_token
from app.core.security import get_current_user
from app.services.feature_gate import require_feature
from app.models.user import User
from app.models.repository import Repository
from app.services.lab_service import claude_complete_json

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/tribal-knowledge", tags=["tribal-knowledge"])


class CaptureRequest(BaseModel):
    repository_id: int
    contributor: str = Field(..., description="GitHub username")
    include_deep_history: bool = Field(True, description=">12 months lookback")


class OwnedArea(BaseModel):
    path: str
    commits_by_target: int
    total_commits: int
    ownership_percent: float
    last_touched: Optional[str] = None
    risk_level: str
    reason: str


class UniqueKnowledge(BaseModel):
    title: str
    description: str
    evidence: List[str] = []
    successor_briefing: str


class DecisionRecord(BaseModel):
    topic: str
    choice_made: str
    alternatives_considered: List[str] = []
    rationale: str
    files: List[str] = []


class TribalKnowledgeDump(BaseModel):
    repository_id: int
    repository_name: str
    contributor: str
    summary: str
    bus_factor_impact: str
    owned_areas: List[OwnedArea]
    unique_knowledge: List[UniqueKnowledge]
    decisions: List[DecisionRecord]
    conventions_introduced: List[str]
    high_risk_files: List[str]
    recommended_handoff_meetings: List[dict]
    generated_at: str


@router.post("/capture", dependencies=[Depends(require_feature("tribal_knowledge"))], response_model=TribalKnowledgeDump)
async def capture_tribal_knowledge(
    body: CaptureRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    res = await db.execute(select(Repository).where(Repository.id == body.repository_id))
    repo = res.scalar_one_or_none()
    if not repo:
        raise HTTPException(status_code=404, detail="Repository not found")

    owner, name = repo.full_name.split("/")
    headers = {"Accept": "application/vnd.github+json"}
    _gh_token = get_github_token(user)
    if _gh_token:
        headers["Authorization"] = f"Bearer {_gh_token}"

    months = 36 if body.include_deep_history else 12
    since = (datetime.now(timezone.utc) - timedelta(days=months * 30)).isoformat()

    # ── 1. Pull this contributor's actual commits ──
    target_commits = []
    async with httpx.AsyncClient(timeout=20) as client:
        for page in range(1, 6):
            try:
                r = await client.get(
                    f"https://api.github.com/repos/{owner}/{name}/commits",
                    headers=headers,
                    params={"author": body.contributor, "since": since, "per_page": 100, "page": page},
                )
            except Exception as e:
                log.warning("tribal-knowledge: commits fetch failed: %s", e)
                break
            if r.status_code != 200:
                break
            batch = r.json()
            if not batch:
                break
            target_commits.extend(batch)
            if len(batch) < 100:
                break

        if not target_commits:
            return _empty_report(repo, body.contributor)

        # ── 2. Pull each commit's file diff to compute per-file ownership ──
        # Cap at 100 most recent commits per contributor — beyond that ownership
        # patterns are stable, more API calls don't add insight.
        file_counts_by_target: Counter = Counter()
        commit_msgs_by_file: dict[str, list[str]] = defaultdict(list)
        last_touched_by_file: dict[str, str] = {}

        for c in target_commits[:100]:
            sha = c.get("sha")
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
            commit_date = c["commit"]["author"]["date"][:10]
            msg = c["commit"]["message"].split("\n")[0][:200]

            for f in cdata.get("files", []):
                fpath = f.get("filename")
                if not fpath:
                    continue
                file_counts_by_target[fpath] += 1
                commit_msgs_by_file[fpath].append(msg)
                if fpath not in last_touched_by_file or commit_date > last_touched_by_file[fpath]:
                    last_touched_by_file[fpath] = commit_date

        # ── 3. Pull total commits per file across ALL authors for ownership % ──
        # We do this for the top 30 files this contributor touched — full repo
        # would be hundreds of API calls.
        top_files = [f for f, _ in file_counts_by_target.most_common(30)]
        total_commits_by_file: dict[str, int] = {}
        for fpath in top_files:
            try:
                tr = await client.get(
                    f"https://api.github.com/repos/{owner}/{name}/commits",
                    headers=headers,
                    params={"path": fpath, "since": since, "per_page": 100},
                )
            except Exception:
                continue
            if tr.status_code != 200:
                continue
            total = len(tr.json())
            total_commits_by_file[fpath] = max(total, file_counts_by_target[fpath])

    # ── 4. Build owned_areas with REAL ownership data ──
    owned_areas = []
    high_risk_files = []
    for fpath in top_files:
        target_count = file_counts_by_target[fpath]
        total_count = total_commits_by_file.get(fpath, target_count)
        ownership_pct = round((target_count / total_count) * 100, 1) if total_count else 100.0

        # Real risk classification based on real ownership concentration
        if ownership_pct >= 90:
            risk = "critical"
            reason = f"This contributor authored {target_count} of {total_count} commits ({ownership_pct}%) — effectively sole owner"
            high_risk_files.append(fpath)
        elif ownership_pct >= 75:
            risk = "high"
            reason = f"Dominant author with {ownership_pct}% of commits — limited backup"
        elif ownership_pct >= 50:
            risk = "medium"
            reason = f"Primary contributor at {ownership_pct}% but shares ownership"
        else:
            risk = "low"
            reason = f"Active contributor at {ownership_pct}% — well-distributed ownership"

        owned_areas.append(OwnedArea(
            path=fpath,
            commits_by_target=target_count,
            total_commits=total_count,
            ownership_percent=ownership_pct,
            last_touched=last_touched_by_file.get(fpath),
            risk_level=risk,
            reason=reason,
        ))

    # ── 5. LLM only for narrative — grounded in the real numbers ──
    sample_messages = []
    for fpath, msgs in list(commit_msgs_by_file.items())[:10]:
        sample_messages.append(f"  {fpath}: {' / '.join(msgs[:3])}")
    real_context = (
        f"CONTRIBUTOR: {body.contributor}\n"
        f"REPOSITORY: {repo.full_name}\n"
        f"COMMIT WINDOW: {months} months\n"
        f"TOTAL COMMITS BY THIS PERSON: {len(target_commits)}\n"
        f"FILES TOUCHED: {len(file_counts_by_target)}\n"
        f"FILES WHERE SOLE OWNER (>=90%): {len(high_risk_files)}\n"
        f"\nSAMPLE COMMIT MESSAGES BY FILE:\n" + "\n".join(sample_messages) + "\n\n"
        f"Based on these REAL signals, write:\n"
        f"  - summary (2-3 sentences about this contributor's footprint)\n"
        f"  - bus_factor_impact (what the org loses if they leave)\n"
        f"  - 3-5 unique_knowledge items (knowledge they likely carry, with successor_briefing)\n"
        f"  - 2-4 decisions (architectural choices implied by the file patterns + commit messages)\n"
        f"  - conventions_introduced (coding patterns suggested by file types they own)\n"
        f"  - 2-3 recommended_handoff_meetings (with: role, topics, duration_minutes)\n"
        f"DO NOT INVENT FILE PATHS OR COMMIT FACTS. Only synthesize from what's above. Return STRICT JSON."
    )
    llm = await claude_complete_json(
        system="You are an engineering leader writing a real handoff plan. Never invent specifics. Return STRICT JSON.",
        prompt=real_context,
    )

    return TribalKnowledgeDump(
        repository_id=repo.id,
        repository_name=repo.full_name,
        contributor=body.contributor,
        summary=llm.get("summary") or f"{body.contributor} contributed {len(target_commits)} commits across {len(file_counts_by_target)} files.",
        bus_factor_impact=llm.get("bus_factor_impact") or "",
        owned_areas=owned_areas,
        unique_knowledge=[UniqueKnowledge(**u) for u in (llm.get("unique_knowledge") or [])],
        decisions=[DecisionRecord(**d) for d in (llm.get("decisions") or [])],
        conventions_introduced=llm.get("conventions_introduced", []),
        high_risk_files=high_risk_files,
        recommended_handoff_meetings=llm.get("recommended_handoff_meetings", []),
        generated_at=datetime.now(timezone.utc).isoformat(),
    )


def _empty_report(repo, contributor: str) -> TribalKnowledgeDump:
    return TribalKnowledgeDump(
        repository_id=repo.id,
        repository_name=repo.full_name,
        contributor=contributor,
        summary=f"No commits found for '{contributor}' in this repository. Verify the GitHub username.",
        bus_factor_impact="",
        owned_areas=[],
        unique_knowledge=[],
        decisions=[],
        conventions_introduced=[],
        high_risk_files=[],
        recommended_handoff_meetings=[],
        generated_at=datetime.now(timezone.utc).isoformat(),
    )
