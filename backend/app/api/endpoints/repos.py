"""
Repository management endpoints.

Import repos from GitHub, list them, check indexing status,
and trigger the background indexing pipeline.
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import load_only
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.crypto import get_github_token
from app.core.database import get_db
from app.core.security import get_current_user
from app.models.user import User
from app.models.repository import Repository
from app.schemas.repo import RepoImportRequest, RepoResponse, RepoListResponse
from app.services.github_service import GitHubService
from app.workers.tasks import index_repository

router = APIRouter()


# Columns the list view actually needs — by selecting only these, we skip
# the heavy `cached_docs` / `cached_audit` / `cached_security` /
# `cached_onboarding` / `cached_architecture` blobs that can be 10–50 KB
# each. For a dashboard polled every 4 seconds while indexing, this cuts
# response size from hundreds of KB to a few KB.
_LIST_COLUMNS = (
    Repository.id,
    Repository.user_id,
    Repository.organization_id,
    Repository.github_repo_id,
    Repository.full_name,
    Repository.name,
    Repository.description,
    Repository.default_branch,
    Repository.language,
    Repository.stars,
    Repository.forks,
    Repository.open_issues,
    Repository.is_indexed,
    Repository.index_status,
    Repository.total_files,
    Repository.indexed_files,
    Repository.health_score,
    Repository.language_breakdown,
    Repository.total_commits,
    Repository.total_contributors,
    Repository.total_lines,
    Repository.created_at,
    Repository.updated_at,
)


@router.get("/", response_model=RepoListResponse)
async def list_repos(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Repository)
        .options(load_only(*_LIST_COLUMNS))
        .where(Repository.user_id == user.id)
        .order_by(Repository.created_at.desc())
    )
    repos = result.scalars().all()
    return RepoListResponse(
        repos=[RepoResponse.model_validate(r) for r in repos],
        total=len(repos),
    )


class RepoProgress(BaseModel):
    """Tiny response shape used by the dashboard's indexing-progress poll."""
    id: int
    index_status: str
    indexed_files: int
    total_files: int


@router.get("/progress", response_model=list[RepoProgress])
async def list_progress(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Lightweight endpoint for the dashboard's 4-second poll while repos are
    indexing. Returns only the progress columns for repos that are NOT
    already done, so an idle dashboard sees an empty array and can stop
    polling entirely. ~50 bytes per row vs ~10 KB on the full /repos/ endpoint.
    """
    result = await db.execute(
        select(
            Repository.id,
            Repository.index_status,
            Repository.indexed_files,
            Repository.total_files,
        )
        .where(
            Repository.user_id == user.id,
            Repository.index_status.in_(("pending", "indexing")),
        )
    )
    return [
        RepoProgress(
            id=row.id,
            index_status=row.index_status,
            indexed_files=row.indexed_files or 0,
            total_files=row.total_files or 0,
        )
        for row in result.all()
    ]


@router.post("/import", response_model=RepoResponse, status_code=201)
async def import_repo(
    body: RepoImportRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Imports a GitHub repo and kicks off background indexing.

    Public repos: work with no GitHub auth (uses anonymous GitHub API, rate-limited).
    Private repos: require GitHub OAuth to be connected.
    """

    # Parse the URL up front — cheap check, lets us fail fast.
    try:
        owner, name = GitHubService.parse_repo_url(body.github_repo_url)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid GitHub repository URL")

    # Decrypt the user's GitHub token once for both the metadata fetch and
    # the dispatch to the Celery worker (which needs the plaintext form).
    access_token = get_github_token(user) or ""

    # Try to fetch — if user has a token, use it (works for private repos too).
    # If not, try anonymous (works for public repos only, lower rate limit).
    gh = GitHubService(access_token=access_token)
    try:
        gh_repo = await gh.get_repo(owner, name)
    except Exception:
        if not access_token:
            raise HTTPException(
                status_code=404,
                detail="Repository not found. If this is a private repo, connect your GitHub account first.",
            )
        raise HTTPException(status_code=404, detail="Repository not found on GitHub")

    # Check if already imported (we keep this check AFTER the GitHub fetch
    # because we need github_repo_id to identify the row uniquely — the
    # raw URL alone could match multiple internal records due to URL form
    # variation like .git suffixes, www., etc.).
    existing = await db.execute(
        select(Repository).where(
            Repository.user_id == user.id,
            Repository.github_repo_id == gh_repo["id"],
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Repository already imported")

    # Create the repo record
    repo = Repository(
        user_id=user.id,
        github_repo_id=gh_repo["id"],
        full_name=gh_repo["full_name"],
        name=gh_repo["name"],
        description=gh_repo.get("description"),
        default_branch=gh_repo.get("default_branch", "main"),
        language=gh_repo.get("language"),
        stars=gh_repo.get("stargazers_count", 0),
        forks=gh_repo.get("forks_count", 0),
        open_issues=gh_repo.get("open_issues_count", 0),
        index_status="pending",
    )
    db.add(repo)
    await db.flush()
    await db.refresh(repo)

    # Kick off background indexing (worker handles missing token gracefully for public repos)
    index_repository.delay(repo.id, access_token)

    return RepoResponse.model_validate(repo)


@router.get("/{repo_id}", response_model=RepoResponse)
async def get_repo(
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
    return RepoResponse.model_validate(repo)


@router.post("/{repo_id}/reindex", response_model=dict)
async def reindex_repo(
    repo_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Re-triggers the indexing pipeline for a repo."""
    result = await db.execute(
        select(Repository).where(
            Repository.id == repo_id,
            Repository.user_id == user.id,
        )
    )
    repo = result.scalar_one_or_none()
    if not repo:
        raise HTTPException(status_code=404, detail="Repository not found")

    repo.index_status = "pending"
    repo.indexed_files = 0
    await db.flush()

    # Works for both authenticated (private repos) and anonymous (public repos)
    access_token = get_github_token(user) or ""
    index_repository.delay(repo.id, access_token)
    return {"message": "Re-indexing started", "repo_id": repo.id}


@router.delete("/{repo_id}", status_code=204)
async def delete_repo(
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

    # Clean up vector store
    from app.services.embedding_service import EmbeddingService
    EmbeddingService().delete_collection(repo.id)

    await db.delete(repo)
