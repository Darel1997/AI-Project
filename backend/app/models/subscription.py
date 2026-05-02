"""
Subscription model — tracks Stripe subscription state per user.

One-to-one with User. Free users also get a row (tier=FREE, status=ACTIVE, no Stripe IDs)
so we can always query subscription info without a NULL check.

Note: we store tier/status as VARCHAR rather than Postgres ENUM so SQLAlchemy's
create_all() doesn't conflict with schema.sql's raw CREATE TYPE statements.
Python-side we still use enums for type safety via validators.
"""
from __future__ import annotations
import enum
from datetime import datetime
from sqlalchemy import Column, Integer, String, DateTime, Boolean, ForeignKey, UniqueConstraint
from sqlalchemy.orm import relationship, validates
from sqlalchemy.sql import func

from app.core.database import Base


class PlanTier(str, enum.Enum):
    FREE = "free"
    PRO = "pro"
    TEAM = "team"
    BUSINESS = "business"
    ENTERPRISE = "enterprise"


class SubscriptionStatus(str, enum.Enum):
    ACTIVE = "active"
    TRIALING = "trialing"
    PAST_DUE = "past_due"
    CANCELED = "canceled"
    UNPAID = "unpaid"
    INCOMPLETE = "incomplete"
    PAUSED = "paused"


class Subscription(Base):
    __tablename__ = "subscriptions"
    __table_args__ = (UniqueConstraint("user_id", name="uq_subscription_user"),)

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)

    # Stored as plain VARCHAR — Python-side enums enforce the allowed set via validators below.
    # Keeping these as strings avoids a Postgres ENUM type conflict with schema.sql.
    tier = Column(String(32), nullable=False, default=PlanTier.FREE.value, server_default="free")
    status = Column(String(32), nullable=False, default=SubscriptionStatus.ACTIVE.value, server_default="active")

    # Stripe IDs — null on free tier
    stripe_customer_id = Column(String(100), unique=True, nullable=True, index=True)
    stripe_subscription_id = Column(String(100), unique=True, nullable=True)

    billing_cycle = Column(String(16), nullable=True)  # "monthly" | "annual"
    seats = Column(Integer, nullable=False, default=1, server_default="1")

    current_period_end = Column(DateTime(timezone=True), nullable=True)
    cancel_at_period_end = Column(Boolean, nullable=False, default=False, server_default="false")

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    user = relationship("User", backref="subscription", uselist=False)

    @validates("tier")
    def _validate_tier(self, key, value):
        if isinstance(value, PlanTier):
            return value.value
        # Accept raw strings but reject unknown ones
        if value not in {t.value for t in PlanTier}:
            raise ValueError(f"Invalid tier: {value}")
        return value

    @validates("status")
    def _validate_status(self, key, value):
        if isinstance(value, SubscriptionStatus):
            return value.value
        if value not in {s.value for s in SubscriptionStatus}:
            raise ValueError(f"Invalid status: {value}")
        return value
