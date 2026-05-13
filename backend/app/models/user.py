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
    # Encrypted at rest via app.core.crypto. Always go through
    # encrypt_token() / decrypt_token() when writing or reading this column —
    # never assign a plaintext token directly. Legacy rows containing
    # plaintext are read back unchanged until a future OAuth refresh
    # re-saves them encrypted (or the migrate_encrypt_tokens script runs).
    github_access_token = Column(Text, nullable=True)

    is_active = Column(Boolean, default=True)
    # Owner flag — overrides every tier gate. Set manually via SQL for your own account:
    #   UPDATE users SET is_owner = TRUE WHERE email = 'you@example.com';
    is_owner = Column(Boolean, default=False, nullable=False, server_default="false")
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )
