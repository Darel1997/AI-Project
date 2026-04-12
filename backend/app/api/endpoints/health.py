"""Health check endpoint — used by load balancers and Docker healthchecks."""

from fastapi import APIRouter

router = APIRouter()


@router.get("/health")
async def health_check():
    return {"status": "healthy", "service": "repoinsight-api"}
