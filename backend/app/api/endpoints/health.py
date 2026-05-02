"""
Health check endpoint.

GET /health        — quick liveness check (always returns 200 if process is alive)
GET /health/detail — full diagnostics including selfcheck results

The detailed endpoint is intentionally unauthenticated so operators can hit it
during deploys to verify everything came up correctly. It only exposes structural
info (is the DB reachable, are tables present, are env vars set), not secrets.
"""
from fastapi import APIRouter

from app.core.selfcheck import SELFCHECK_RESULTS

router = APIRouter()


@router.get("/health")
async def health_check():
    """Quick liveness probe — returns 200 if the API process is responding."""
    return {"status": "healthy", "service": "repoinsight-api"}


@router.get("/health/detail")
async def health_detail():
    """
    Full diagnostics. Returns the result of the startup self-check so operators can
    immediately see what (if anything) is wrong without needing to read worker logs.
    """
    results = SELFCHECK_RESULTS or {"ok": False, "checks": [], "warnings": [], "errors": ["selfcheck not yet run"]}
    return {
        "status": "ok" if results.get("ok") else "degraded",
        "checks_passed": len(results.get("checks", [])),
        "warnings": results.get("warnings", []),
        "errors": results.get("errors", []),
        "checks": results.get("checks", []),
    }
