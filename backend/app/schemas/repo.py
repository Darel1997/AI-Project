"""Request and response schemas for repository endpoints."""

from pydantic import BaseModel
from typing import Optional, Dict, List
from datetime import datetime


class RepoImportRequest(BaseModel):
    github_repo_url: str   # e.g. "https://github.com/owner/repo"


class RepoResponse(BaseModel):
    id: int
    full_name: str
    name: str
    description: Optional[str]
    language: Optional[str]
    stars: int
    forks: int
    is_indexed: bool
    index_status: str
    total_files: int
    indexed_files: int
    health_score: Optional[float]
    language_breakdown: Optional[Dict[str, float]]
    total_commits: int
    total_contributors: int
    total_lines: int
    created_at: datetime

    class Config:
        from_attributes = True


class RepoFileResponse(BaseModel):
    id: int
    path: str
    filename: str
    language: Optional[str]
    size_bytes: int
    line_count: int

    class Config:
        from_attributes = True


class RepoListResponse(BaseModel):
    repos: List[RepoResponse]
    total: int
