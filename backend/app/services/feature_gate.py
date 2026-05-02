"""
Tier gating & feature catalog.

Single source of truth for which features are available on which tier.
Used both by FastAPI dependencies (to gate endpoints) and exposed via API
so the frontend can render lock icons and upgrade CTAs without duplicating
the logic.

Feature slugs match the frontend's. Add a feature here, gate the endpoint with
require_feature(slug), and the frontend automatically renders it correctly.
"""

from __future__ import annotations
from typing import Literal

from fastapi import Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.user import User
from app.models.subscription import Subscription, PlanTier, SubscriptionStatus


# ─────────────────────────────────────────────────────────────────
# Feature catalog
# ─────────────────────────────────────────────────────────────────

# Tier order — used for "tier >= required" comparisons
TIER_RANK = {
    "free":       0,
    "pro":        1,
    "team":       2,
    "business":   3,
    "enterprise": 4,
    "owner":      5,   # Site operator — bypasses every gate
}

# Feature slug → minimum tier required.
# These slugs are the contract between frontend and backend.
FEATURE_TIERS: dict[str, str] = {
    # Free — every signed-in user gets these
    "chat":              "free",
    "documentation":     "free",
    "architecture":      "free",
    "onboarding_guide":  "free",
    "license_scanner":   "free",   # License compliance — must-have for every team

    # Pro — paid individual
    "security_audit":    "pro",
    "code_quality":      "pro",
    "task_generator":    "pro",
    "dependency_radar":  "pro",
    "time_machine":      "pro",
    "cost_forecaster":   "pro",   # Infra cost forecasting from real IaC parsing

    # Team — paid team
    "onboarding_sim":    "team",
    "blast_radius":      "team",
    "pr_reviewer":       "team",   # Auto PR reviews — replaces SonarQube/CodeClimate
    "knowledge_graph":   "team",   # Real call-graph search
    "code_drift":        "team",   # Convention-violation detection
    "adrs":              "team",   # Living architecture decision records
    "migration_assistant": "team", # File-by-file migration plans

    # Business — paid enterprise
    "tribal_knowledge":  "business",
    "compliance":        "business",  # SOC 2 / GDPR / HIPAA evidence packages
    "cross_repo":        "business",  # Cross-repo intelligence — org-level feature
}


def feature_metadata() -> list[dict]:
    """
    Return the full feature catalog with display info.
    Used by GET /api/billing/features so the frontend renders the right buttons.
    """
    catalog = [
        {"slug": "chat",             "name": "Chat with repo",        "description": "Ask questions, get cited answers from your repository",                "tier": "free"},
        {"slug": "documentation",    "name": "Documentation",         "description": "Auto-generated module-level docs",                                     "tier": "free"},
        {"slug": "architecture",     "name": "Architecture diagram",  "description": "Mermaid diagram of your system structure",                            "tier": "free"},
        {"slug": "onboarding_guide", "name": "Onboarding guide",      "description": "Static onboarding doc generated from the code",                       "tier": "free"},
        {"slug": "license_scanner",  "name": "License scanner",       "description": "Real-time license risk + downloadable SPDX SBOM",                     "tier": "free"},

        {"slug": "security_audit",   "name": "Security audit",        "description": "CWE-classified findings with remediation",                            "tier": "pro"},
        {"slug": "code_quality",     "name": "Code quality audit",    "description": "Code smells, complexity hotspots, missing tests",                     "tier": "pro"},
        {"slug": "task_generator",   "name": "Task generator",        "description": "AI-generated Jira-style tickets from your code",                      "tier": "pro"},
        {"slug": "dependency_radar", "name": "Dependency radar",      "description": "Real maintainer health + alternative libraries",                       "tier": "pro"},
        {"slug": "time_machine",     "name": "Time machine",          "description": "Real commit history evolution timeline",                              "tier": "pro"},
        {"slug": "cost_forecaster",  "name": "Cost forecaster",       "description": "Predict AWS/GCP/Azure cost impact from real IaC parsing",             "tier": "pro"},

        {"slug": "onboarding_sim",   "name": "Onboarding simulator",  "description": "Interactive Day 1 / Week 1 / Month 1 plans with real GitHub issues",  "tier": "team"},
        {"slug": "blast_radius",     "name": "Blast radius",          "description": "Real import-graph analysis of code change ripple effects",            "tier": "team"},
        {"slug": "pr_reviewer",      "name": "AI PR reviewer",        "description": "Auto-comment on every PR with risk + blast radius",                   "tier": "team"},
        {"slug": "knowledge_graph",  "name": "Knowledge graph search","description": "Real call-graph queries: definitions, usages, concept search",        "tier": "team"},
        {"slug": "code_drift",       "name": "Code drift detection",  "description": "Flags PRs that violate established codebase patterns",                "tier": "team"},
        {"slug": "adrs",             "name": "Living ADRs",           "description": "Auto-detect architectural shifts from real git history",              "tier": "team"},
        {"slug": "migration_assistant", "name": "Migration assistant", "description": "File-by-file phased migration plans with real complexity scoring",   "tier": "team"},

        {"slug": "tribal_knowledge", "name": "Tribal knowledge",      "description": "Real git ownership analysis before someone leaves",                   "tier": "business"},
        {"slug": "compliance",       "name": "Compliance reports",    "description": "SOC 2 / GDPR / HIPAA evidence packages from your codebase",           "tier": "business"},
        {"slug": "cross_repo",       "name": "Cross-repo intelligence","description": "Find duplicate logic, shared concerns, and library-extraction opportunities across repos", "tier": "business"},
    ]
    return catalog


# ─────────────────────────────────────────────────────────────────
# FastAPI dependencies
# ─────────────────────────────────────────────────────────────────

async def _user_effective_tier(user: User, db: AsyncSession) -> str:
    """
    Return the user's effective tier. Owner accounts get the special 'owner' tier
    which outranks every paid tier. Inactive subscriptions (canceled, unpaid)
    drop the user back to 'free'.
    """
    if getattr(user, "is_owner", False):
        return "owner"

    res = await db.execute(select(Subscription).where(Subscription.user_id == user.id))
    sub = res.scalar_one_or_none()
    if not sub:
        return "free"

    # Lapsed subscriptions revoke premium features
    if sub.status not in (SubscriptionStatus.ACTIVE.value, SubscriptionStatus.TRIALING.value):
        return "free"

    return sub.tier or "free"


def require_feature(feature_slug: str):
    """
    FastAPI dependency that returns the user only if their tier unlocks the feature.

    Usage:
        @router.post("/scan", dependencies=[Depends(require_feature("dependency_radar"))])
        async def scan(...): ...
    """
    required_tier = FEATURE_TIERS.get(feature_slug)
    if not required_tier:
        raise RuntimeError(f"Unknown feature slug: {feature_slug}")
    required_rank = TIER_RANK[required_tier]

    async def dep(
        user: User = Depends(get_current_user),
        db: AsyncSession = Depends(get_db),
    ) -> User:
        effective = await _user_effective_tier(user, db)
        if TIER_RANK.get(effective, 0) < required_rank:
            raise HTTPException(
                status_code=status.HTTP_402_PAYMENT_REQUIRED,
                detail={
                    "message": f"This feature requires the {required_tier.title()} plan or higher.",
                    "required_tier": required_tier,
                    "current_tier": effective,
                    "feature": feature_slug,
                    "upgrade_url": "/pricing",
                },
            )
        return user

    return dep


async def get_user_features(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """
    Expose the feature catalog with per-feature lock state for the current user.
    Frontend uses this to render the right buttons on each repo.
    """
    effective_tier = await _user_effective_tier(user, db)
    effective_rank = TIER_RANK.get(effective_tier, 0)
    features = []
    for f in feature_metadata():
        required_rank = TIER_RANK[f["tier"]]
        features.append({
            **f,
            "unlocked": effective_rank >= required_rank,
        })
    return {
        "current_tier": effective_tier,
        "is_owner": bool(getattr(user, "is_owner", False)),
        "features": features,
    }
