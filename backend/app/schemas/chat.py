"""Schemas for chat, AI, and task-generation endpoints."""

from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime


# ── Chat ──────────────────────────────────────────────────────────

class ChatRequest(BaseModel):
    repository_id: int
    message: str


class ChatSource(BaseModel):
    file_path: str
    snippet: str
    relevance: float


class ChatResponse(BaseModel):
    answer: str
    sources: List[ChatSource]
    message_id: int


class ChatHistoryItem(BaseModel):
    id: int
    role: str
    content: str
    sources: Optional[List[dict]]
    created_at: datetime

    class Config:
        from_attributes = True


# ── AI Services ───────────────────────────────────────────────────

class ExplainFileRequest(BaseModel):
    repository_id: int
    file_path: str


class ExplainFileResponse(BaseModel):
    file_path: str
    explanation: str
    language: Optional[str]
    line_count: int


class GenerateDocsRequest(BaseModel):
    repository_id: int
    scope: str = "overview"  # overview | file | module


class GenerateDocsResponse(BaseModel):
    documentation: str
    files_analyzed: int


class TechDebtRequest(BaseModel):
    repository_id: int


class TechDebtItem(BaseModel):
    file_path: str
    issue: str
    severity: str       # low | medium | high | critical
    category: str       # complexity | duplication | naming | testing | dependency
    suggestion: str


class TechDebtResponse(BaseModel):
    items: List[TechDebtItem]
    summary: str
    overall_score: float  # 0-100, higher = healthier


# ── Tasks ─────────────────────────────────────────────────────────

class GenerateTasksRequest(BaseModel):
    repository_id: int
    focus_area: Optional[str] = None  # e.g. "testing", "performance", "security"
    count: int = 5


class TaskResponse(BaseModel):
    id: int
    title: str
    description: str
    priority: str
    difficulty: str
    task_type: str
    suggested_files: Optional[List[str]]
    status: str
    created_at: datetime

    class Config:
        from_attributes = True


# ── Analytics ─────────────────────────────────────────────────────

class CommitActivity(BaseModel):
    date: str
    count: int


class ContributorStat(BaseModel):
    username: str
    avatar_url: Optional[str]
    commits: int
    additions: int
    deletions: int


class AnalyticsResponse(BaseModel):
    health_score: float
    total_commits: int
    total_contributors: int
    total_lines: int
    language_breakdown: dict
    commit_activity: List[CommitActivity]
    top_contributors: List[ContributorStat]
