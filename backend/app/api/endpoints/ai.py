"""
AI intelligence endpoints.

Each endpoint wraps a specific AI capability:
file explanation, documentation generation, and tech debt detection.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.user import User
from app.models.repository import Repository, RepoFile
from app.schemas.chat import (
    ExplainFileRequest, ExplainFileResponse,
    GenerateDocsRequest, GenerateDocsResponse,
    TechDebtRequest, TechDebtResponse, TechDebtItem,
)
from app.services.ai_service import AIService

router = APIRouter()


@router.post("/explain", response_model=ExplainFileResponse)
async def explain_file(
    body: ExplainFileRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Uses AI to explain what a specific file does."""
    # verify ownership
    result = await db.execute(
        select(Repository).where(
            Repository.id == body.repository_id,
            Repository.user_id == user.id,
        )
    )
    repo = result.scalar_one_or_none()
    if not repo:
        raise HTTPException(status_code=404, detail="Repository not found")

    # find the file
    file_result = await db.execute(
        select(RepoFile).where(
            RepoFile.repository_id == body.repository_id,
            RepoFile.path == body.file_path,
        )
    )
    repo_file = file_result.scalar_one_or_none()
    if not repo_file or not repo_file.content:
        raise HTTPException(status_code=404, detail="File not found or not indexed")

    ai = AIService()
    explanation = ai.explain_file(repo_file.content, repo_file.path)

    return ExplainFileResponse(
        file_path=repo_file.path,
        explanation=explanation,
        language=repo_file.language,
        line_count=repo_file.line_count,
    )


@router.post("/docs", response_model=GenerateDocsResponse)
async def generate_docs(
    body: GenerateDocsRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Generates documentation for the repository."""
    result = await db.execute(
        select(Repository).where(
            Repository.id == body.repository_id,
            Repository.user_id == user.id,
        )
    )
    repo = result.scalar_one_or_none()
    if not repo:
        raise HTTPException(status_code=404, detail="Repository not found")

    # grab file summaries
    files_result = await db.execute(
        select(RepoFile)
        .where(RepoFile.repository_id == body.repository_id)
        .order_by(RepoFile.path)
    )
    files = files_result.scalars().all()
    file_summaries = [
        {"path": f.path, "summary": f"{f.language or 'unknown'} — {f.line_count} lines"}
        for f in files
    ]

    ai = AIService()
    documentation = ai.generate_documentation(repo.id, file_summaries)

    return GenerateDocsResponse(
        documentation=documentation,
        files_analyzed=len(file_summaries),
    )


@router.post("/tech-debt", response_model=TechDebtResponse)
async def detect_tech_debt(
    body: TechDebtRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Scans the codebase for technical debt and code smells."""
    result = await db.execute(
        select(Repository).where(
            Repository.id == body.repository_id,
            Repository.user_id == user.id,
        )
    )
    repo = result.scalar_one_or_none()
    if not repo:
        raise HTTPException(status_code=404, detail="Repository not found")

    # sample files for analysis (the largest ones tend to have the most issues)
    files_result = await db.execute(
        select(RepoFile)
        .where(
            RepoFile.repository_id == body.repository_id,
            RepoFile.content.isnot(None),
        )
        .order_by(RepoFile.line_count.desc())
        .limit(15)
    )
    files = files_result.scalars().all()
    sample_files = [{"path": f.path, "content": f.content} for f in files]

    ai = AIService()
    debt_data = ai.detect_tech_debt(repo.id, sample_files)

    return TechDebtResponse(
        items=[TechDebtItem(**item) for item in debt_data.get("items", [])],
        summary=debt_data.get("summary", ""),
        overall_score=debt_data.get("overall_score", 50.0),
    )
