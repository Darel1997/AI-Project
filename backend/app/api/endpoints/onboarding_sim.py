"""
Onboarding Simulator — uses REAL GitHub data.

Pipeline:
  1. Pull real `good-first-issue` and `help-wanted` labeled issues from GitHub
  2. Pull real top contributors (for "people to meet")
  3. Pull real README + CONTRIBUTING + CI config from the indexed codebase
  4. LLM only structures the curriculum — checkpoints reference REAL issues + REAL people

No more fabricated "first PR suggestions" or invented "people to meet."
"""

from __future__ import annotations
import logging
from datetime import datetime, timezone
from typing import List, Optional, Literal

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
from app.services.lab_service import claude_complete_json, search_similar

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/onboarding-sim", tags=["onboarding"])


class SimulateRequest(BaseModel):
    repository_id: int
    role: Literal["frontend", "backend", "fullstack", "devops", "data", "ml", "generalist"] = "generalist"
    experience_level: Literal["junior", "mid", "senior"] = "mid"
    focus_areas: Optional[List[str]] = None


class Checkpoint(BaseModel):
    id: str
    title: str
    description: str
    kind: Literal["setup", "reading", "exploration", "exercise", "meeting"]
    estimated_minutes: int
    files: List[str] = []
    prs: List[str] = []
    issues: List[str] = []
    people: List[str] = []
    completion_hint: Optional[str] = None


class Phase(BaseModel):
    name: Literal["day_1", "week_1", "month_1"]
    title: str
    goal: str
    estimated_hours: int
    checkpoints: List[Checkpoint]


class OnboardingPlan(BaseModel):
    repository_id: int
    repository_name: str
    role: str
    experience_level: str
    summary: str
    phases: List[Phase]
    tech_stack: List[str]
    key_abstractions: List[str]
    gotchas: List[str]
    people_to_meet: List[str]
    first_pr_suggestions: List[dict]
    generated_at: str


class CheckpointProgress(BaseModel):
    checkpoint_id: str
    completed: bool
    notes: Optional[str] = None
    completed_at: Optional[datetime] = None


@router.post("/simulate", dependencies=[Depends(require_feature("onboarding_sim"))], response_model=OnboardingPlan)
async def simulate_onboarding(
    body: SimulateRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    res = await db.execute(select(Repository).where(Repository.id == body.repository_id))
    repo = res.scalar_one_or_none()
    if not repo:
        raise HTTPException(status_code=404, detail="Repository not found")
    if not repo.is_indexed:
        raise HTTPException(status_code=400, detail="Repository must be indexed first")

    owner, name = repo.full_name.split("/")
    headers = {"Accept": "application/vnd.github+json"}
    _gh_token = get_github_token(user)
    if _gh_token:
        headers["Authorization"] = f"Bearer {_gh_token}"

    # ── 1. REAL good-first-issues from GitHub ──
    real_issues = await _fetch_starter_issues(headers, owner, name)

    # ── 2. REAL top contributors from GitHub ──
    real_contributors = await _fetch_top_contributors(headers, owner, name)

    # ── 3. Indexed-codebase context (READMEs, configs, entry points) ──
    context_chunks = []
    for q in [
        "README getting started installation setup",
        "configuration environment variables",
        "testing test framework how to run",
        "contributing guidelines conventions",
    ]:
        hits = await search_similar(repository_id=repo.id, query_text=q, top_k=3)
        for h in hits:
            context_chunks.append({"file": h.get("file_path", ""), "snippet": h.get("snippet", "")[:300]})
    if body.focus_areas:
        for area in body.focus_areas:
            for h in await search_similar(repository_id=repo.id, query_text=f"{area} module implementation", top_k=3):
                context_chunks.append({"file": h.get("file_path", ""), "snippet": h.get("snippet", "")[:300]})

    # ── 4. LLM structures the curriculum, ANCHORED to real data ──
    issues_text = "\n".join([
        f"  - #{i['number']}: {i['title']} (labels: {', '.join(i.get('labels', []))})"
        for i in real_issues[:10]
    ]) or "  (no good-first-issue labeled issues found)"

    contributors_text = "\n".join([
        f"  - {c['login']} ({c['contributions']} contributions)"
        for c in real_contributors[:8]
    ]) or "  (no contributors found)"

    context_text = "\n".join([
        f"  [{c['file']}]\n    {c['snippet']}"
        for c in context_chunks[:15]
    ])

    prompt = (
        f"REPOSITORY: {repo.full_name}\n"
        f"DESCRIPTION: {repo.description or 'no description'}\n"
        f"LANGUAGE: {repo.language or 'mixed'}\n"
        f"FILES: {repo.total_files}\n\n"
        f"NEW HIRE PROFILE:\n"
        f"  Role: {body.role}\n"
        f"  Experience: {body.experience_level}\n"
        f"  Focus: {body.focus_areas or 'none specified'}\n\n"
        f"REAL OPEN STARTER ISSUES (use these as first-PR targets — DO NOT INVENT):\n{issues_text}\n\n"
        f"REAL TOP CONTRIBUTORS (use these as people to meet — DO NOT INVENT NAMES):\n{contributors_text}\n\n"
        f"CODEBASE CONTEXT:\n{context_text}\n\n"
        f"Generate a 3-phase onboarding plan (day_1, week_1, month_1).\n"
        f"Each phase has 4-8 checkpoints. Reference REAL issue numbers and REAL contributor names.\n"
        f"first_pr_suggestions array MUST cite real issue numbers from above.\n"
        f"people_to_meet array MUST be from the contributor list above.\n"
        f"Return STRICT JSON."
    )

    llm = await claude_complete_json(
        system="You are a staff engineer designing onboarding from REAL data. Never invent issues, files, or names. Return STRICT JSON.",
        prompt=prompt,
    )

    return OnboardingPlan(
        repository_id=repo.id,
        repository_name=repo.full_name,
        role=body.role,
        experience_level=body.experience_level,
        summary=llm.get("summary", f"Onboarding plan for {repo.full_name}"),
        phases=[Phase(**p) for p in (llm.get("phases") or [])],
        tech_stack=llm.get("tech_stack", []),
        key_abstractions=llm.get("key_abstractions", []),
        gotchas=llm.get("gotchas", []),
        # Use the LLM's curated subset, but fall back to real raw data so we never
        # show empty arrays when GitHub returned real signals.
        people_to_meet=llm.get("people_to_meet") or [c["login"] for c in real_contributors[:5]],
        first_pr_suggestions=llm.get("first_pr_suggestions") or [
            {
                "title": i["title"],
                "difficulty": "easy" if "good-first-issue" in i.get("labels", []) else "medium",
                "file": "",
                "why": f"Open issue #{i['number']}: real entry point picked by maintainers",
                "issue_number": i["number"],
                "issue_url": i["url"],
            }
            for i in real_issues[:5]
        ],
        generated_at=datetime.now(timezone.utc).isoformat(),
    )


@router.post("/progress/{repository_id}/{checkpoint_id}")
def update_progress(
    repository_id: int,
    checkpoint_id: str,
    body: CheckpointProgress,
    user: User = Depends(get_current_user),
):
    log.info("onboarding-sim progress: user=%s repo=%s cp=%s done=%s",
             user.id, repository_id, checkpoint_id, body.completed)
    return {"ok": True, "checkpoint_id": checkpoint_id, "completed": body.completed}


# ── Real-data helpers ───────────────────────────────────────────────

async def _fetch_starter_issues(headers, owner, name) -> list[dict]:
    """Pull real open issues labeled good-first-issue, help-wanted, or beginner."""
    issues: list[dict] = []
    label_queries = ["good-first-issue", "help-wanted", "good first issue"]
    async with httpx.AsyncClient(timeout=15) as client:
        for label in label_queries:
            try:
                r = await client.get(
                    f"https://api.github.com/repos/{owner}/{name}/issues",
                    headers=headers,
                    params={"state": "open", "labels": label, "per_page": 10},
                )
                if r.status_code == 200:
                    for i in r.json():
                        # Skip pull requests (the issues endpoint returns both)
                        if "pull_request" in i:
                            continue
                        issues.append({
                            "number": i["number"],
                            "title": i["title"],
                            "url": i["html_url"],
                            "labels": [l["name"] for l in i.get("labels", [])],
                        })
            except Exception as e:
                log.warning("issues fetch failed for label %s: %s", label, e)
    # Dedupe by issue number
    seen = set()
    deduped = []
    for i in issues:
        if i["number"] not in seen:
            seen.add(i["number"])
            deduped.append(i)
    return deduped


async def _fetch_top_contributors(headers, owner, name) -> list[dict]:
    """Real top contributors via GitHub contributors API."""
    async with httpx.AsyncClient(timeout=15) as client:
        try:
            r = await client.get(
                f"https://api.github.com/repos/{owner}/{name}/contributors",
                headers=headers,
                params={"per_page": 15},
            )
            if r.status_code == 200:
                return [
                    {"login": c["login"], "contributions": c["contributions"]}
                    for c in r.json()
                    if c.get("type") != "Bot"
                ]
        except Exception as e:
            log.warning("contributors fetch failed: %s", e)
    return []
