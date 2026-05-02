"""
Organization models — enables multi-tenant workspaces with role-based access.

Design:
  - Every User has a personal "org" auto-created on signup (1:1 mapping)
    so existing code can treat everything as belonging to an org going forward.
  - Users can create additional orgs and invite teammates.
  - Repositories optionally belong to an Organization via organization_id.
    When null, the repo is personal (owned only by the user).
  - Roles: owner (billing + delete), admin (manage members), member (use repos).
"""

from datetime import datetime, timezone
import enum
from sqlalchemy import (
    Column, Integer, String, Boolean, DateTime, Text, ForeignKey, Enum, UniqueConstraint,
)
from sqlalchemy.orm import relationship
from app.core.database import Base


class OrgRole(str, enum.Enum):
    owner = "owner"
    admin = "admin"
    member = "member"


class Organization(Base):
    __tablename__ = "organizations"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    slug = Column(String(50), unique=True, nullable=False, index=True)  # url-safe handle
    description = Column(Text, nullable=True)
    avatar_url = Column(Text, nullable=True)

    # True for the auto-created personal org. Users can't delete or rename personal orgs.
    is_personal = Column(Boolean, default=False, nullable=False)

    # Plan / billing — free tier is the default until upgraded
    plan = Column(String(30), default="free", nullable=False)  # free | pro | team
    seats = Column(Integer, default=1, nullable=False)

    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    memberships = relationship("Membership", back_populates="organization", cascade="all, delete-orphan")
    invitations = relationship("Invitation", back_populates="organization", cascade="all, delete-orphan")


class Membership(Base):
    """
    Join-table between User and Organization with a role.
    A user has exactly one membership per organization.
    """
    __tablename__ = "memberships"
    __table_args__ = (
        UniqueConstraint("user_id", "organization_id", name="uq_user_org"),
    )

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    organization_id = Column(Integer, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    role = Column(Enum(OrgRole), nullable=False, default=OrgRole.member)

    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    organization = relationship("Organization", back_populates="memberships")


class Invitation(Base):
    """
    Pending invitation to join an organization.
    Accepts create a Membership, decline deletes the Invitation row.
    """
    __tablename__ = "invitations"
    __table_args__ = (
        UniqueConstraint("organization_id", "email", name="uq_org_email"),
    )

    id = Column(Integer, primary_key=True, index=True)
    organization_id = Column(Integer, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    email = Column(String(255), nullable=False, index=True)
    role = Column(Enum(OrgRole), nullable=False, default=OrgRole.member)
    invited_by_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    # Opaque token used in the accept URL. Random, single-use.
    token = Column(String(128), unique=True, nullable=False, index=True)
    expires_at = Column(DateTime(timezone=True), nullable=False)

    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    organization = relationship("Organization", back_populates="invitations")
