"""
Repository-related models.

A Repository belongs to a User and contains many RepoFiles.
RepoFiles store the raw content + metadata needed for embedding.
"""

from datetime import datetime, timezone
from sqlalchemy import (
    Column, Integer, String, Boolean, DateTime, Text, ForeignKey, Float, JSON,
)
from sqlalchemy.orm import relationship
from app.core.database import Base


class Repository(Base):
    __tablename__ = "repositories"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)

    github_repo_id = Column(Integer, nullable=False)
    full_name = Column(String(255), nullable=False)      # e.g. "octocat/hello-world"
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    default_branch = Column(String(100), default="main")
    language = Column(String(100), nullable=True)
    stars = Column(Integer, default=0)
    forks = Column(Integer, default=0)
    open_issues = Column(Integer, default=0)

    # indexing state
    is_indexed = Column(Boolean, default=False)
    index_status = Column(String(50), default="pending")  # pending | indexing | done | failed
    total_files = Column(Integer, default=0)
    indexed_files = Column(Integer, default=0)

    # analytics cache (refreshed periodically)
    health_score = Column(Float, nullable=True)
    language_breakdown = Column(JSON, nullable=True)      # {"Python": 60, "JS": 30, ...}
    total_commits = Column(Integer, default=0)
    total_contributors = Column(Integer, default=0)
    total_lines = Column(Integer, default=0)

    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    files = relationship("RepoFile", back_populates="repository", cascade="all, delete-orphan")


class RepoFile(Base):
    __tablename__ = "repo_files"

    id = Column(Integer, primary_key=True, index=True)
    repository_id = Column(Integer, ForeignKey("repositories.id", ondelete="CASCADE"), nullable=False, index=True)

    path = Column(String(1000), nullable=False)
    filename = Column(String(255), nullable=False)
    language = Column(String(100), nullable=True)
    size_bytes = Column(Integer, default=0)
    line_count = Column(Integer, default=0)
    content = Column(Text, nullable=True)
    sha = Column(String(64), nullable=True)

    is_embedded = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    repository = relationship("Repository", back_populates="files")
