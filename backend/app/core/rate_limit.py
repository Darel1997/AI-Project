"""
Rate limiter — FastAPI dependency that throttles requests per identity.

Identity preference:
  1. Authenticated user_id (best — survives IP rotation, ties limits to plan)
  2. X-Forwarded-For client IP (when behind a proxy / load balancer)
  3. Direct peer IP (last resort)

The limiter is a sliding-window counter in Redis with a configurable
window. If Redis is unreachable we **fail open** — better to serve a few
extra requests during a Redis outage than to take the whole API down.

Usage:
    from app.core.rate_limit import rate_limit
    @router.post("/expensive", dependencies=[Depends(rate_limit("ai", limit=20, window=60))])
    async def expensive_thing(...):
        ...

Limits are best-effort. They won't replace a real edge-layer WAF — but
they'll stop a single rogue API token from spinning up 1000 audits per
minute and racking up the AI bill.
"""

from __future__ import annotations
import logging
from typing import Optional

from fastapi import HTTPException, Request, status

from app.core.redis import get_redis

logger = logging.getLogger("repoinsight.ratelimit")


def _identifier(request: Request) -> str:
    """Pick the most stable identity available for this request."""
    # If the auth dependency has already populated request.state.user, prefer that.
    user = getattr(request.state, "user", None)
    if user is not None and hasattr(user, "id"):
        return f"user:{user.id}"

    # Fall back to the first IP in X-Forwarded-For (load-balancer prepends client IP).
    xff = request.headers.get("x-forwarded-for", "")
    if xff:
        client_ip = xff.split(",")[0].strip()
        if client_ip:
            return f"ip:{client_ip}"

    # Last resort: direct peer.
    if request.client:
        return f"ip:{request.client.host}"
    return "ip:unknown"


def rate_limit(bucket: str, *, limit: int, window: int = 60):
    """
    Returns a FastAPI dependency that enforces `limit` requests per `window`
    seconds for the given `bucket`. Each (identity, bucket) gets its own
    counter so the limits on the AI bucket are independent of the auth bucket.
    """

    async def _check(request: Request) -> None:
        identity = _identifier(request)
        key = f"ratelimit:{bucket}:{identity}"
        try:
            redis = await get_redis()
            current: Optional[int] = await redis.incr(key)
            if current == 1:
                # New window — set expiry.
                await redis.expire(key, window)
            if current is not None and current > limit:
                # Provide Retry-After so clients can back off cleanly.
                ttl = await redis.ttl(key)
                retry_after = max(1, int(ttl)) if ttl and ttl > 0 else window
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail=(
                        f"Rate limit exceeded for this {bucket} action. "
                        f"Try again in {retry_after}s."
                    ),
                    headers={"Retry-After": str(retry_after)},
                )
        except HTTPException:
            raise
        except Exception as e:
            # Redis hiccup — fail open. We log so it's visible in Sentry/CloudWatch.
            logger.warning("rate limiter fail-open for %s: %s", key, e)

    return _check
