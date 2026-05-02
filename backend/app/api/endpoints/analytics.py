"""
Analytics endpoints — dashboard data for a repository.

Combines stored metadata with live GitHub API calls to
produce the charts and health metrics.
"""

import json
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import get_current_user
from app.core.redis import cache_get, cache_set
from app.models.user import User
from app.models.repository import Repository
from app.schemas.chat import AnalyticsResponse, CommitActivity, ContributorStat
from app.services.github_service import GitHubService
from app.services.analytics_service import AnalyticsService

router = APIRouter()


@router.get("/{repo_id}", response_model=AnalyticsResponse)
async def get_analytics(
    repo_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Repository).where(
            Repository.id == repo_id,
            Repository.user_id == user.id,
        )
    )
    repo = result.scalar_one_or_none()
    if not repo:
        raise HTTPException(status_code=404, detail="Repository not found")

    # try the cache first (analytics are expensive, cache for 10 min)
    cache_key = f"analytics:{repo_id}"
    cached = await cache_get(cache_key)
    if cached:
        return AnalyticsResponse(**json.loads(cached))

    if not user.github_access_token:
        raise HTTPException(status_code=400, detail="GitHub token required")

    owner, name = repo.full_name.split("/")
    gh = GitHubService(access_token=user.github_access_token)

    # fetch all analytics in parallel-ish (sequential here for simplicity)
    commit_activity = await AnalyticsService.get_commit_activity(gh, owner, name)
    contributors = await AnalyticsService.get_contributor_stats(gh, owner, name)
    languages = await AnalyticsService.get_language_breakdown(gh, owner, name)
    total_lines = await AnalyticsService.count_total_lines(db, repo_id)

    # update repo metadata (freshly pulled from GitHub)
    repo.total_commits = sum(c["count"] for c in commit_activity)
    repo.total_contributors = len(contributors)
    repo.total_lines = total_lines
    repo.language_breakdown = languages

    # Recompute quality score using the SAME formula as the indexer.
    # This replaces the previous bug where analytics used its own scoring
    # and the dashboard/analytics pages disagreed on the number.
    from app.services.quality_score import compute_quality_score
    from app.models.repository import RepoFile
    files_result = await db.execute(
        select(RepoFile).where(RepoFile.repository_id == repo_id)
    )
    files = files_result.scalars().all()
    health = compute_quality_score(repo, files=list(files))
    repo.health_score = health

    response = AnalyticsResponse(
        health_score=health,
        total_commits=repo.total_commits,
        total_contributors=repo.total_contributors,
        total_lines=total_lines,
        language_breakdown=languages,
        commit_activity=[CommitActivity(**c) for c in commit_activity],
        top_contributors=[ContributorStat(**c) for c in contributors],
    )

    # cache the result
    await cache_set(cache_key, response.model_dump_json(), ttl_seconds=600)

    return response
