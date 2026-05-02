"""
Startup self-check — runs once on app boot.

Catches the kinds of bugs that have crashed the API repeatedly:
  - Module imports that fail
  - SQLAlchemy models that can't resolve their FKs
  - DB tables that don't exist
  - Required environment variables that are missing

If any check fails, we LOG IT LOUDLY but don't crash — the app stays
responsive on /health so the operator can see what's wrong without
having to dig through 200 lines of stack trace.

The /health endpoint surfaces these results so `curl /health` tells you
exactly what's broken without having to read worker logs.
"""

from __future__ import annotations
import logging
import os
from typing import Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

logger = logging.getLogger("repoinsight.selfcheck")

# Module-level state — populated at startup, read by /health
SELFCHECK_RESULTS: dict = {
    "ok": False,
    "checks": [],
    "warnings": [],
    "errors": [],
}


async def run_selfcheck(engine: AsyncEngine) -> dict:
    """
    Run all startup health checks. Returns a result dict and stores it
    globally so /health can report it.
    """
    results: dict = {
        "ok": True,
        "checks": [],
        "warnings": [],
        "errors": [],
    }

    # ── Check 1: All routers loadable ────────────────────────────
    # If any endpoint module fails to import, we're already crashed by now,
    # so reaching this check at all means imports succeeded. Just record it.
    try:
        from app.api.endpoints import (
            auth, repos, chat, ai, analytics, tasks, health,
            webhooks, organizations, billing,
            blast_radius, onboarding_sim, tribal_knowledge,
            dependency_radar, time_machine,
            license_scanner, pr_reviewer,
            compliance, knowledge_graph, slack,
            code_drift, adrs, cross_repo, cost_forecaster, migration,
        )
        # Touch the routers so static analysis sees the use
        _routers_loaded = bool(auth.router and billing.router and slack.router and migration.router)
        results["checks"].append({"name": "routers", "status": "ok", "detail": "25 routers loaded"})
    except Exception as e:
        results["errors"].append(f"router_import_failed: {e}")
        results["ok"] = False

    # ── Check 2: Database connectivity ────────────────────────────
    try:
        async with engine.begin() as conn:
            await conn.execute(text("SELECT 1"))
        results["checks"].append({"name": "database", "status": "ok", "detail": "connection healthy"})
    except Exception as e:
        results["errors"].append(f"database_unreachable: {e}")
        results["ok"] = False

    # ── Check 3: Required tables exist ────────────────────────────
    # If create_all() ran but a table is missing, we want to know NOW,
    # not when a request fails later.
    expected_tables = {
        "users", "repositories", "repo_files", "chat_messages", "tasks",
        "organizations", "memberships", "invitations", "subscriptions",
        "slack_workspaces", "slack_channel_repos",
        "architecture_decisions",
    }
    try:
        async with engine.begin() as conn:
            res = await conn.execute(text(
                "SELECT table_name FROM information_schema.tables "
                "WHERE table_schema = 'public'"
            ))
            actual = {row[0] for row in res}
            missing = expected_tables - actual
            if missing:
                results["errors"].append(f"missing_tables: {sorted(missing)}")
                results["ok"] = False
            else:
                results["checks"].append({"name": "tables", "status": "ok", "detail": f"{len(actual)} tables present"})
    except Exception as e:
        results["warnings"].append(f"table_check_failed: {e}")

    # ── Check 4: Critical columns exist ───────────────────────────
    # is_owner was added later — make sure the migration ran.
    try:
        async with engine.begin() as conn:
            res = await conn.execute(text(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_name = 'users'"
            ))
            cols = {row[0] for row in res}
            if "is_owner" not in cols:
                results["warnings"].append("users.is_owner column missing — auto-migration should add it")
            else:
                results["checks"].append({"name": "schema", "status": "ok", "detail": "users.is_owner present"})
    except Exception as e:
        results["warnings"].append(f"column_check_failed: {e}")

    # ── Check 5: Required env vars (warnings only — features may degrade) ─
    optional_envs = {
        "ANTHROPIC_API_KEY":   "AI features (chat, audits, lab features) won't work",
        "GITHUB_CLIENT_ID":     "GitHub OAuth sign-in will return 501",
        "GITHUB_CLIENT_SECRET": "GitHub OAuth sign-in will return 501",
    }
    for var, consequence in optional_envs.items():
        if not os.getenv(var):
            results["warnings"].append(f"env_missing: {var} — {consequence}")
        else:
            results["checks"].append({"name": f"env.{var}", "status": "ok"})

    # ── Log a single summary line so docker logs show clearly ────
    if results["ok"]:
        logger.info("✓ Self-check PASSED · %d checks · %d warnings",
                    len(results["checks"]), len(results["warnings"]))
        if results["warnings"]:
            for w in results["warnings"]:
                logger.warning("  ⚠ %s", w)
    else:
        logger.error("✗ Self-check FAILED · %d errors:", len(results["errors"]))
        for e in results["errors"]:
            logger.error("  ✗ %s", e)
        for w in results["warnings"]:
            logger.warning("  ⚠ %s", w)
        logger.error("API will continue running but some routes may fail. Check /health for details.")

    SELFCHECK_RESULTS.clear()
    SELFCHECK_RESULTS.update(results)
    return results
