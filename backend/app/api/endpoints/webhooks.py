"""
GitHub webhook handlers — receives push events and triggers automatic
re-indexing of the linked repository. All requests are verified against
the webhook_secret column using HMAC-SHA256.

Security notes:
  - HMAC signatures must match before we do anything else
  - Delivery IDs are cached per-repo to prevent replay attacks
  - Branch filter: only the default_branch triggers reindex by default
  - No user auth context — the webhook_secret *is* the authentication
"""

import hmac
import hashlib
import secrets
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Header, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.user import User
from app.models.repository import Repository
from app.workers.tasks import index_repository

router = APIRouter()


# ─────────────────────────────────────────────────────────────────────
#  Helpers
# ─────────────────────────────────────────────────────────────────────

def _verify_signature(secret: str, body: bytes, received_sig: str) -> bool:
    """
    Constant-time verification of GitHub's X-Hub-Signature-256 header.
    Format: 'sha256=<hex digest>'
    """
    if not received_sig or not received_sig.startswith("sha256="):
        return False
    expected = "sha256=" + hmac.new(
        secret.encode("utf-8"),
        msg=body,
        digestmod=hashlib.sha256,
    ).hexdigest()
    return hmac.compare_digest(expected, received_sig)


def _generate_secret() -> str:
    """Cryptographically strong random secret for webhook HMAC."""
    return secrets.token_urlsafe(32)


# ─────────────────────────────────────────────────────────────────────
#  Owner-facing endpoints (require auth)
# ─────────────────────────────────────────────────────────────────────

@router.post("/repos/{repo_id}/webhook/enable")
async def enable_webhook(
    repo_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Turn on auto-reindex-on-push for this repo. Returns the webhook URL
    and secret the user needs to paste into GitHub's webhook settings.
    """
    result = await db.execute(
        select(Repository).where(
            Repository.id == repo_id,
            Repository.user_id == user.id,
        )
    )
    repo = result.scalar_one_or_none()
    if not repo:
        raise HTTPException(status_code=404, detail="Repository not found")

    # Generate a fresh secret if enabling for the first time or if user asks to rotate
    if not repo.webhook_secret:
        repo.webhook_secret = _generate_secret()

    repo.webhook_enabled = True
    await db.commit()
    await db.refresh(repo)

    return {
        "enabled": True,
        "webhook_url": f"/api/webhooks/github/{repo.id}",
        "secret": repo.webhook_secret,
        "content_type": "application/json",
        "events": ["push"],
        "instructions": (
            "In your GitHub repo, go to Settings → Webhooks → Add webhook. "
            "Paste the webhook URL, paste the secret, set content type to "
            "application/json, and select 'Just the push event'."
        ),
    }


@router.post("/repos/{repo_id}/webhook/disable")
async def disable_webhook(
    repo_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Disable auto-reindex. Does NOT invalidate the secret —
    in case the user re-enables, the URL in GitHub stays valid."""
    result = await db.execute(
        select(Repository).where(
            Repository.id == repo_id,
            Repository.user_id == user.id,
        )
    )
    repo = result.scalar_one_or_none()
    if not repo:
        raise HTTPException(status_code=404, detail="Repository not found")

    repo.webhook_enabled = False
    await db.commit()
    return {"enabled": False}


@router.post("/repos/{repo_id}/webhook/rotate-secret")
async def rotate_webhook_secret(
    repo_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Generate a new secret. User must update it in GitHub's webhook settings
    or future deliveries will fail signature verification."""
    result = await db.execute(
        select(Repository).where(
            Repository.id == repo_id,
            Repository.user_id == user.id,
        )
    )
    repo = result.scalar_one_or_none()
    if not repo:
        raise HTTPException(status_code=404, detail="Repository not found")

    repo.webhook_secret = _generate_secret()
    await db.commit()
    await db.refresh(repo)
    return {"secret": repo.webhook_secret}


@router.get("/repos/{repo_id}/webhook/status")
async def webhook_status(
    repo_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return the webhook's current state — whether it's enabled, when it was
    last triggered, how many total reindexes it has caused."""
    result = await db.execute(
        select(Repository).where(
            Repository.id == repo_id,
            Repository.user_id == user.id,
        )
    )
    repo = result.scalar_one_or_none()
    if not repo:
        raise HTTPException(status_code=404, detail="Repository not found")

    return {
        "enabled": repo.webhook_enabled,
        "has_secret": bool(repo.webhook_secret),
        "webhook_url": f"/api/webhooks/github/{repo.id}" if repo.webhook_enabled else None,
        "last_triggered_at": repo.webhook_last_triggered_at.isoformat() if repo.webhook_last_triggered_at else None,
        "reindex_count": repo.webhook_reindex_count or 0,
    }


# ─────────────────────────────────────────────────────────────────────
#  GitHub → server endpoint (NO auth; HMAC-authenticated)
# ─────────────────────────────────────────────────────────────────────

@router.post("/webhooks/github/{repo_id}")
async def github_webhook(
    repo_id: int,
    request: Request,
    x_github_event: Optional[str] = Header(None, alias="X-GitHub-Event"),
    x_hub_signature_256: Optional[str] = Header(None, alias="X-Hub-Signature-256"),
    x_github_delivery: Optional[str] = Header(None, alias="X-GitHub-Delivery"),
    db: AsyncSession = Depends(get_db),
):
    """
    Receives GitHub webhook events. Verifies signature, then triggers
    reindex if this is a push to the default branch.

    This endpoint is intentionally public — the webhook_secret
    provides authentication via HMAC signing.
    """
    # 1. Look up repo (we need the secret to verify)
    result = await db.execute(select(Repository).where(Repository.id == repo_id))
    repo = result.scalar_one_or_none()
    if not repo or not repo.webhook_secret or not repo.webhook_enabled:
        # Don't leak info — return 404 for all of these cases
        raise HTTPException(status_code=404, detail="Webhook not found")

    # 2. Read raw body — NEED raw bytes for signature verification
    body = await request.body()

    # 3. Verify signature BEFORE doing anything else
    if not _verify_signature(repo.webhook_secret, body, x_hub_signature_256 or ""):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid signature")

    # 4. Idempotency: skip if we've already processed this delivery
    if x_github_delivery and x_github_delivery == repo.webhook_last_delivery_id:
        return {"status": "duplicate", "delivery": x_github_delivery}

    # 5. Handle ping event (GitHub sends this when webhook is first set up)
    if x_github_event == "ping":
        if x_github_delivery:
            repo.webhook_last_delivery_id = x_github_delivery
            await db.commit()
        return {"status": "pong", "repo": repo.full_name}

    # 6. Only care about push events
    if x_github_event != "push":
        return {"status": "ignored", "event": x_github_event}

    # 7. Parse JSON — only after signature + delivery-id checks
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON")

    # 8. Only reindex if push is to the default branch
    pushed_ref = payload.get("ref", "")  # refs/heads/main
    pushed_branch = pushed_ref.replace("refs/heads/", "")
    if pushed_branch != (repo.default_branch or "main"):
        return {"status": "ignored", "reason": f"push to {pushed_branch}, not default branch"}

    # 9. Don't re-trigger if we're already mid-index
    if repo.index_status in ("pending", "indexing"):
        return {"status": "skipped", "reason": "indexing already in progress"}

    # 10. Update bookkeeping + kick off reindex
    repo.webhook_last_triggered_at = datetime.now(timezone.utc)
    repo.webhook_last_delivery_id = x_github_delivery
    repo.webhook_reindex_count = (repo.webhook_reindex_count or 0) + 1
    repo.index_status = "pending"
    repo.indexed_files = 0
    await db.commit()

    # Fire background task — Celery handles the actual work
    index_repository.delay(repo.id)

    return {
        "status": "queued",
        "repo": repo.full_name,
        "branch": pushed_branch,
        "delivery": x_github_delivery,
    }
