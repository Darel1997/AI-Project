"""
Repository management endpoints.

Import repos from GitHub, list them, check indexing status,
and trigger the background indexing pipeline.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.user import User
from app.models.repository import Repository
from app.schemas.repo import RepoImportRequest, RepoResponse, RepoListResponse
from app.services.github_service import GitHubService
from app.workers.tasks import index_repository

router = APIRouter()


@router.get("/", response_model=RepoListResponse)
async def list_repos(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Repository)
        .where(Repository.user_id == user.id)
        .order_by(Repository.created_at.desc())
    )
    repos = result.scalars().all()
    return RepoListResponse(
        repos=[RepoResponse.model_validate(r) for r in repos],
        total=len(repos),
    )


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

    # parse the URL
    try:
        owner, name = GitHubService.parse_repo_url(body.github_repo_url)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid GitHub repository URL")

    # Try to fetch — if user has a token, use it (works for private repos too)
    # If not, try anonymous (works for public repos only, lower rate limit)
    access_token = user.github_access_token or ""
    gh = GitHubService(access_token=access_token)
    try:
        gh_repo = await gh.get_repo(owner, name)
    except Exception:
        if not user.github_access_token:
            raise HTTPException(
                status_code=404,
                detail="Repository not found. If this is a private repo, connect your GitHub account first.",
            )
        raise HTTPException(status_code=404, detail="Repository not found on GitHub")

    # check if already imported
    existing = await db.execute(
        select(Repository).where(
            Repository.user_id == user.id,
            Repository.github_repo_id == gh_repo["id"],
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Repository already imported")

    # create the repo record
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

    # kick off background indexing (worker handles missing token gracefully for public repos)
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
    access_token = user.github_access_token or ""
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

    # clean up vector store
    from app.services.embedding_service import EmbeddingService
    EmbeddingService().delete_collection(repo.id)

    await db.delete(repo)
