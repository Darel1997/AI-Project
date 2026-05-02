"""
AI intelligence endpoints — with persistent caching.

All heavy AI artifacts (docs, code audit, security scan, onboarding,
architecture) are cached on the repository row so they persist across
page reloads and sessions. GET endpoints fetch cached values; POST
endpoints regenerate.
"""

from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel
from typing import Optional, List

from app.core.database import get_db
from app.core.security import get_current_user
from app.services.feature_gate import require_feature
from app.core.rate_limit import rate_limit
from app.models.user import User
from app.models.repository import Repository, RepoFile
from app.schemas.chat import (
    ExplainFileRequest, ExplainFileResponse,
    GenerateDocsRequest, GenerateDocsResponse,
    TechDebtRequest, TechDebtResponse, TechDebtItem,
)
from app.services.ai_service import AIService, AIRequestTimeout

router = APIRouter()


async def _verify_repo(db: AsyncSession, repo_id: int, user_id: int) -> Repository:
    result = await db.execute(
        select(Repository).where(Repository.id == repo_id, Repository.user_id == user_id)
    )
    repo = result.scalar_one_or_none()
    if not repo:
        raise HTTPException(status_code=404, detail="Repository not found")
    return repo


async def _sample_files(db: AsyncSession, repo_id: int, limit: int = 15) -> list:
    files_result = await db.execute(
        select(RepoFile)
        .where(RepoFile.repository_id == repo_id, RepoFile.content.isnot(None))
        .order_by(RepoFile.line_count.desc())
        .limit(limit)
    )
    files = files_result.scalars().all()
    return [{"path": f.path, "content": f.content, "language": f.language} for f in files]


# ── Explain a single file ─────────────────────────────────────────

@router.post("/explain", response_model=ExplainFileResponse)
async def explain_file(
    body: ExplainFileRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _verify_repo(db, body.repository_id, user.id)
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
        file_path=repo_file.path, explanation=explanation,
        language=repo_file.language, line_count=repo_file.line_count,
    )


# ── Documentation (cached) ────────────────────────────────────────

class CachedDocsResponse(BaseModel):
    documentation: Optional[str] = None
    files_analyzed: int = 0
    generated_at: Optional[datetime] = None


@router.get("/docs/{repo_id}", response_model=CachedDocsResponse)
async def get_cached_docs(
    repo_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    repo = await _verify_repo(db, repo_id, user.id)
    return CachedDocsResponse(
        documentation=repo.cached_docs,
        files_analyzed=repo.total_files if repo.cached_docs else 0,
        generated_at=repo.cached_docs_at,
    )


@router.post("/docs", dependencies=[Depends(rate_limit("ai", limit=20, window=60))], response_model=GenerateDocsResponse)
async def generate_docs(
    body: GenerateDocsRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    repo = await _verify_repo(db, body.repository_id, user.id)
    files_result = await db.execute(
        select(RepoFile).where(RepoFile.repository_id == body.repository_id).order_by(RepoFile.path)
    )
    files = files_result.scalars().all()
    file_summaries = [
        {"path": f.path, "summary": f"{f.language or 'unknown'} — {f.line_count} lines"}
        for f in files
    ]

    ai = AIService()
    try:
        documentation = await ai.a_generate_documentation(repo.id, file_summaries)
    except AIRequestTimeout as e:
        raise HTTPException(status_code=504, detail=str(e))

    repo.cached_docs = documentation
    repo.cached_docs_at = datetime.now(timezone.utc)
    await db.flush()

    return GenerateDocsResponse(
        documentation=documentation, files_analyzed=len(file_summaries),
    )


# ── Code Quality Audit (cached) — renamed from tech-debt ──────────

class CachedAuditResponse(BaseModel):
    items: Optional[List[TechDebtItem]] = None
    summary: Optional[str] = None
    overall_score: Optional[float] = None
    generated_at: Optional[datetime] = None


@router.get("/audit/{repo_id}", response_model=CachedAuditResponse)
async def get_cached_audit(
    repo_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    repo = await _verify_repo(db, repo_id, user.id)
    if not repo.cached_audit:
        return CachedAuditResponse()
    return CachedAuditResponse(
        items=[TechDebtItem(**i) for i in repo.cached_audit.get("items", [])],
        summary=repo.cached_audit.get("summary", ""),
        overall_score=repo.cached_audit.get("overall_score", 50.0),
        generated_at=repo.cached_audit_at,
    )


@router.post("/audit", dependencies=[Depends(require_feature("code_quality")), Depends(rate_limit("ai", limit=20, window=60))], response_model=TechDebtResponse)
async def run_audit(
    body: TechDebtRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Scans the codebase for code quality issues (formerly 'tech-debt')."""
    repo = await _verify_repo(db, body.repository_id, user.id)
    # Sample size aligned with FeatureBudget for "code_quality" — see ai_service.
    sample_files = await _sample_files(db, body.repository_id, 8)

    ai = AIService()
    try:
        debt_data = await ai.a_detect_tech_debt(repo.id, sample_files)
    except AIRequestTimeout as e:
        raise HTTPException(status_code=504, detail=str(e))

    repo.cached_audit = debt_data
    repo.cached_audit_at = datetime.now(timezone.utc)
    await db.flush()

    return TechDebtResponse(
        items=[TechDebtItem(**item) for item in debt_data.get("items", [])],
        summary=debt_data.get("summary", ""),
        overall_score=debt_data.get("overall_score", 50.0),
    )


# Backward-compatible alias (old frontend may still call /tech-debt)
@router.post("/tech-debt", dependencies=[Depends(rate_limit("ai", limit=20, window=60))], response_model=TechDebtResponse)
async def detect_tech_debt_legacy(
    body: TechDebtRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await run_audit(body, user, db)


# ── Security Scan (cached, new) ───────────────────────────────────

class SecurityFinding(BaseModel):
    file_path: str
    line_hint: Optional[str] = None
    vulnerability: str
    severity: str
    cwe: Optional[str] = None
    description: str
    remediation: str


class SecurityScanResponse(BaseModel):
    findings: List[SecurityFinding]
    summary: str
    security_score: float
    generated_at: Optional[datetime] = None


class SecurityRequest(BaseModel):
    repository_id: int


@router.get("/security/{repo_id}", response_model=SecurityScanResponse)
async def get_cached_security(
    repo_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    repo = await _verify_repo(db, repo_id, user.id)
    if not repo.cached_security:
        return SecurityScanResponse(findings=[], summary="", security_score=0, generated_at=None)
    return SecurityScanResponse(
        findings=[SecurityFinding(**f) for f in repo.cached_security.get("findings", [])],
        summary=repo.cached_security.get("summary", ""),
        security_score=repo.cached_security.get("security_score", 0),
        generated_at=repo.cached_security_at,
    )


@router.post("/security", dependencies=[Depends(require_feature("security_audit")), Depends(rate_limit("ai", limit=20, window=60))], response_model=SecurityScanResponse)
async def run_security_scan(
    body: SecurityRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Runs an AI-powered security audit — secrets, SQL injection, XSS, and more."""
    repo = await _verify_repo(db, body.repository_id, user.id)
    # Sample size aligned with FeatureBudget for "security_audit".
    sample_files = await _sample_files(db, body.repository_id, 8)

    ai = AIService()
    try:
        scan_data = await ai.a_security_scan(repo.id, sample_files)
    except AIRequestTimeout as e:
        raise HTTPException(status_code=504, detail=str(e))

    repo.cached_security = scan_data
    repo.cached_security_at = datetime.now(timezone.utc)
    await db.flush()

    return SecurityScanResponse(
        findings=[SecurityFinding(**f) for f in scan_data.get("findings", [])],
        summary=scan_data.get("summary", ""),
        security_score=scan_data.get("security_score", 50),
    )


# ── Onboarding Guide (cached, new) ────────────────────────────────

class OnboardingResponse(BaseModel):
    guide: Optional[str] = None
    generated_at: Optional[datetime] = None


class OnboardingRequest(BaseModel):
    repository_id: int


@router.get("/onboarding/{repo_id}", response_model=OnboardingResponse)
async def get_cached_onboarding(
    repo_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    repo = await _verify_repo(db, repo_id, user.id)
    return OnboardingResponse(guide=repo.cached_onboarding, generated_at=repo.cached_onboarding_at)


@router.post("/onboarding", dependencies=[Depends(rate_limit("ai", limit=20, window=60))], response_model=OnboardingResponse)
async def generate_onboarding(
    body: OnboardingRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Generates a 'new developer in 30 minutes' onboarding guide."""
    repo = await _verify_repo(db, body.repository_id, user.id)
    # Grab small/medium files — those are usually the most informative for onboarding
    files_result = await db.execute(
        select(RepoFile)
        .where(RepoFile.repository_id == body.repository_id, RepoFile.content.isnot(None))
        .limit(40)
    )
    files = files_result.scalars().all()
    sample = [{"path": f.path, "language": f.language} for f in files]

    ai = AIService()
    try:
        guide = await ai.a_generate_onboarding_guide(repo.id, repo.full_name, sample)
    except AIRequestTimeout as e:
        raise HTTPException(status_code=504, detail=str(e))

    repo.cached_onboarding = guide
    repo.cached_onboarding_at = datetime.now(timezone.utc)
    await db.flush()

    return OnboardingResponse(guide=guide, generated_at=repo.cached_onboarding_at)


# ── Architecture Diagram (cached, new) ────────────────────────────

class ArchitectureResponse(BaseModel):
    diagram: Optional[str] = None
    generated_at: Optional[datetime] = None


class ArchitectureRequest(BaseModel):
    repository_id: int


@router.get("/architecture/{repo_id}", response_model=ArchitectureResponse)
async def get_cached_architecture(
    repo_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    repo = await _verify_repo(db, repo_id, user.id)
    return ArchitectureResponse(diagram=repo.cached_architecture, generated_at=repo.cached_architecture_at)


@router.post("/architecture", dependencies=[Depends(rate_limit("ai", limit=20, window=60))], response_model=ArchitectureResponse)
async def generate_architecture(
    body: ArchitectureRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Generates a Mermaid architecture diagram of the repository."""
    repo = await _verify_repo(db, body.repository_id, user.id)
    files_result = await db.execute(
        select(RepoFile).where(RepoFile.repository_id == body.repository_id).order_by(RepoFile.path).limit(60)
    )
    files = files_result.scalars().all()
    sample = [{"path": f.path} for f in files]

    ai = AIService()
    try:
        diagram = await ai.a_generate_architecture_diagram(repo.id, sample)
    except AIRequestTimeout as e:
        raise HTTPException(status_code=504, detail=str(e))

    repo.cached_architecture = diagram
    repo.cached_architecture_at = datetime.now(timezone.utc)
    await db.flush()

    return ArchitectureResponse(diagram=diagram, generated_at=repo.cached_architecture_at)
