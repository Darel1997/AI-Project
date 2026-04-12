"""
User model — supports both email/password and GitHub OAuth accounts.
"""

from datetime import datetime, timezone
from sqlalchemy import (
    Column, Integer, String, Boolean, DateTime, Text,
)
from app.core.database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), unique=True, nullable=False, index=True)
    hashed_password = Column(String(255), nullable=True)  # null for OAuth-only users
    full_name = Column(String(255), nullable=True)
    avatar_url = Column(Text, nullable=True)

    # GitHub OAuth fields
    github_id = Column(Integer, unique=True, nullable=True, index=True)
    github_username = Column(String(100), nullable=True)
    github_access_token = Column(Text, nullable=True)  # encrypted in prod

    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )
