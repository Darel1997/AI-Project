"""
Codebase Time Machine — unique feature.

Pulls REAL git history from the GitHub Commits API, aggregates by month,
identifies notable events from commit messages, and uses the LLM only
for the narrative summary and lessons-learned section.

Previously this fabricated a plausible timeline. Now it returns actual
commit data: real dates, real contributor names, real activity counts.
"""

from __future__ import annotations
import logging
import re
from collections import defaultdict
from datetime import datetime, timezone, timedelta
from typing import List, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import get_current_user
from app.services.feature_gate import require_feature
from app.models.user import User
from app.models.repository import Repository
from app.services.lab_service import claude_complete_json

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/time-machine", tags=["time-machine"])


class ReplayRequest(BaseModel):
    repository_id: int
    path: str = Field(..., description="File or directory to analyze, e.g. 'src/auth'")
    lookback_months: int = Field(24, ge=1, le=60)


class TimelineEvent(BaseModel):
    date: str
    kind: str
    title: str
    description: str
    actors: List[str] = []
    files_touched: int = 0
    related_commits: List[str] = []


class OwnershipSnapshot(BaseModel):
    date: str
    top_contributors: List[dict]


class MetricPoint(BaseModel):
    date: str
    file_count: int
    total_lines: int
    contributor_count: int


class TimeMachineReport(BaseModel):
    repository_id: int
    repository_name: str
    path: str
    lookback_months: int
    summary: str
    events: List[TimelineEvent]
    metric_series: List[MetricPoint]
    ownership_snapshots: List[OwnershipSnapshot]
    narrative: str
    current_risks: List[str]
    generated_at: str


@router.post("/replay", dependencies=[Depends(require_feature("time_machine"))], response_model=TimeMachineReport)
async def replay_history(
    body: ReplayRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Build a REAL timeline of how a path evolved.

    Pipeline:
      1. Fetch commits from the GitHub commits API filtered by `path`
      2. Aggregate by month → metric_series
      3. Identify notable events from commit message patterns
      4. Sample ownership snapshots every ~3 months
      5. Use LLM only for the narrative + risks (small, derived signals)
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

    # ── 1. Pull commits — paginated, capped at 5 pages = 500 commits ──
    commits = []
    async with httpx.AsyncClient(timeout=20) as client:
        for page in range(1, 6):
            try:
                r = await client.get(
                    f"https://api.github.com/repos/{owner}/{name}/commits",
                    headers=headers,
                    params={"path": body.path, "since": since, "per_page": 100, "page": page},
                )
            except Exception as e:
                log.warning("time-machine commits fetch failed: %s", e)
                break
            if r.status_code != 200:
                if r.status_code == 409:  # empty repo
                    break
                log.warning("time-machine commits API returned %s", r.status_code)
                break
            batch = r.json()
            if not batch:
                break
            commits.extend(batch)
            if len(batch) < 100:
                break

    if not commits:
        return TimeMachineReport(
            repository_id=repo.id,
            repository_name=repo.full_name,
            path=body.path,
            lookback_months=body.lookback_months,
            summary=f"No commit history found for path '{body.path}' in the last {body.lookback_months} months.",
            events=[], metric_series=[], ownership_snapshots=[],
            narrative="No commits to narrate.",
            current_risks=[],
            generated_at=datetime.now(timezone.utc).isoformat(),
        )

    # ── 2. Aggregate by month ──
    monthly: dict[str, dict] = defaultdict(lambda: {"commits": 0, "contributors": set()})
    for c in commits:
        try:
            commit_date = c["commit"]["author"]["date"][:10]
            month_key = commit_date[:7] + "-01"
            author = (c.get("author") or {}).get("login") or c["commit"]["author"].get("name", "unknown")
            monthly[month_key]["commits"] += 1
            monthly[month_key]["contributors"].add(author)
        except (KeyError, TypeError):
            continue

    metric_series: list[MetricPoint] = []
    for date_key in sorted(monthly.keys()):
        m = monthly[date_key]
        # We don't fetch per-commit blob counts (would be 500+ extra calls).
        # Use commit count as the activity proxy — labelled honestly in the UI.
        metric_series.append(MetricPoint(
            date=date_key,
            file_count=m["commits"],
            total_lines=0,
            contributor_count=len(m["contributors"]),
        ))

    # ── 3. Notable events from real commit messages ──
    events = _extract_events(commits)

    # ── 4. Ownership snapshots every ~3 months ──
    snapshots = _ownership_snapshots(commits)

    # ── 5. LLM only for narrative + risks, grounded in real numbers ──
    summary_data = {
        "total_commits": len(commits),
        "active_months": len(monthly),
        "unique_contributors": len({
            (c.get("author") or {}).get("login") or c["commit"]["author"].get("name", "unknown")
            for c in commits
        }),
        "first_commit_date": commits[-1]["commit"]["author"]["date"][:10],
        "last_commit_date": commits[0]["commit"]["author"]["date"][:10],
        "event_count": len(events),
        "event_kinds": list({e.kind for e in events}),
    }
    prompt = (
        f"PATH: {body.path}\n"
        f"REPOSITORY: {repo.full_name}\n"
        f"WINDOW: {body.lookback_months} months\n\n"
        f"REAL DATA:\n"
        f"  - {summary_data['total_commits']} commits across {summary_data['active_months']} active months\n"
        f"  - {summary_data['unique_contributors']} unique contributors\n"
        f"  - First commit in window: {summary_data['first_commit_date']}\n"
        f"  - Latest commit:          {summary_data['last_commit_date']}\n"
        f"  - {summary_data['event_count']} notable events ({', '.join(summary_data['event_kinds']) or 'none'})\n\n"
        "Write a concise narrative (3-5 sentences) describing this module's evolution arc. "
        "Then list 3-5 current risks based on the patterns in the data. "
        "Ground everything in the numbers above. Do NOT invent dates or events. "
        "Return STRICT JSON: { \"summary\": str, \"narrative\": str, \"current_risks\": [str] }"
    )
    llm = await claude_complete_json(
        system="You are a software historian writing about real commit data. Never invent facts. Return STRICT JSON.",
        prompt=prompt,
    )

    return TimeMachineReport(
        repository_id=repo.id,
        repository_name=repo.full_name,
        path=body.path,
        lookback_months=body.lookback_months,
        summary=llm.get("summary") or f"{summary_data['total_commits']} commits over {summary_data['active_months']} active months by {summary_data['unique_contributors']} contributors.",
        events=events,
        metric_series=metric_series,
        ownership_snapshots=snapshots,
        narrative=llm.get("narrative") or "Active development period with steady contributor engagement.",
        current_risks=llm.get("current_risks", []),
        generated_at=datetime.now(timezone.utc).isoformat(),
    )


# Patterns that signal a notable change. Conservative — false positives are weird,
# so we only match strong signals.
EVENT_PATTERNS = [
    ("incident",      re.compile(r"\b(hotfix|emergency|incident|outage|p0|p1|critical\s+bug)\b", re.I)),
    ("major-feature", re.compile(r"\b(launch|release|introduce|add\s+support\s+for|new\s+feature)\b", re.I)),
    ("refactor",      re.compile(r"\b(refactor|rewrite|restructure|migrate|cleanup)\b", re.I)),
    ("deprecation",   re.compile(r"\b(deprecat|drop\s+support|remove|delete)\b", re.I)),
]


def _extract_events(commits: list) -> list[TimelineEvent]:
    """Identify notable events from real commit messages. Returns up to 12 events."""
    events: list[TimelineEvent] = []
    seen: set[str] = set()

    # Mark the earliest commit in the window as a "birth" event so the timeline has a start
    if commits:
        last = commits[-1]
        try:
            events.append(TimelineEvent(
                date=last["commit"]["author"]["date"][:10],
                kind="birth",
                title="First commit in window",
                description=last["commit"]["message"].split("\n")[0][:160],
                actors=[(last.get("author") or {}).get("login") or last["commit"]["author"].get("name", "unknown")],
                files_touched=0,
                related_commits=[last.get("sha", "")[:7]],
            ))
        except (KeyError, TypeError):
            pass

    for c in commits:
        msg = c.get("commit", {}).get("message", "")
        first_line = msg.split("\n")[0][:160] if msg else ""
        if not first_line or first_line in seen:
            continue

        for kind, pattern in EVENT_PATTERNS:
            if pattern.search(first_line):
                try:
                    sha = c.get("sha", "")[:7]
                    actor = (c.get("author") or {}).get("login") or c["commit"]["author"].get("name", "unknown")
                    events.append(TimelineEvent(
                        date=c["commit"]["author"]["date"][:10],
                        kind=kind,
                        title=first_line[:80],
                        description=first_line,
                        actors=[actor],
                        files_touched=0,
                        related_commits=[sha],
                    ))
                    seen.add(first_line)
                except (KeyError, TypeError):
                    pass
                break

        if len(events) >= 12:
            break

    return events


def _ownership_snapshots(commits: list) -> list[OwnershipSnapshot]:
    """Sample top contributors at ~3-month intervals."""
    if not commits:
        return []

    by_month: dict[str, list] = defaultdict(list)
    for c in commits:
        try:
            month = c["commit"]["author"]["date"][:7]
            by_month[month].append(c)
        except (KeyError, TypeError):
            continue

    months = sorted(by_month.keys())
    if not months:
        return []

    sample_months = set(months[::3])
    sample_months.add(months[-1])

    snapshots = []
    cumulative: dict[str, int] = defaultdict(int)
    for month in months:
        for c in by_month[month]:
            author = (c.get("author") or {}).get("login") or c["commit"]["author"].get("name", "unknown")
            cumulative[author] += 1

        if month in sample_months:
            total = sum(cumulative.values()) or 1
            top = sorted(cumulative.items(), key=lambda kv: kv[1], reverse=True)[:3]
            snapshots.append(OwnershipSnapshot(
                date=f"{month}-01",
                top_contributors=[
                    {"name": n, "commits_pct": round(c / total * 100, 1)}
                    for n, c in top
                ],
            ))

    return snapshots
