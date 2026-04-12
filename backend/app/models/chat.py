"""
Chat and Task models.

ChatMessages store the conversation history for each repo.
Tasks are AI-generated Jira-style engineering tickets.
"""

from datetime import datetime, timezone
from sqlalchemy import (
    Column, Integer, String, DateTime, Text, ForeignKey, JSON,
)
from app.core.database import Base


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    repository_id = Column(Integer, ForeignKey("repositories.id", ondelete="CASCADE"), nullable=False, index=True)

    role = Column(String(20), nullable=False)  # "user" or "assistant"
    content = Column(Text, nullable=False)
    sources = Column(JSON, nullable=True)       # file paths cited in the answer

    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class Task(Base):
    __tablename__ = "tasks"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    repository_id = Column(Integer, ForeignKey("repositories.id", ondelete="CASCADE"), nullable=False, index=True)

    title = Column(String(500), nullable=False)
    description = Column(Text, nullable=False)
    priority = Column(String(20), nullable=False)   # critical | high | medium | low
    difficulty = Column(String(20), nullable=False)  # easy | medium | hard | complex
    task_type = Column(String(50), nullable=False)   # bug | feature | refactor | docs | test
    suggested_files = Column(JSON, nullable=True)    # ["src/auth.py", "tests/test_auth.py"]
    status = Column(String(20), default="open")      # open | in_progress | done

    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
