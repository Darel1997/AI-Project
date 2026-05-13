"""
Rate limiter — FastAPI dependency that throttles requests per identity.

Identity preference:
  1. Authenticated user_id (best — survives IP rotation, ties limits to plan)
  2. X-Forwarded-For client IP, BUT ONLY if the immediate peer is a trusted
     proxy. Without this check, an attacker can rotate XFF values per
     request and defeat the rate limit entirely.
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
import ipaddress
import logging
from typing import Optional

from fastapi import HTTPException, Request, status

from app.core.config import settings
from app.core.redis import get_redis

logger = logging.getLogger("repoinsight.ratelimit")


def _is_trusted_proxy(peer_ip: Optional[str]) -> bool:
    """
    Check whether the immediate TCP peer is a known reverse proxy.

    Only when this is True will we honor the X-Forwarded-For header —
    otherwise the client could just send whatever XFF they want.

    The trusted set is parsed from the TRUSTED_PROXIES setting (comma-
    separated). In production this should typically be your load balancer's
    address(es): "127.0.0.1" if Nginx is on the same host, or the LB's
    private CIDR if it's separate.

    If TRUSTED_PROXIES is empty (default), no XFF is trusted — safer
    default. Explicitly opt in once you know what's in front of you.
    """
    if not peer_ip:
        return False
    raw = getattr(settings, "TRUSTED_PROXIES", "") or ""
    if not raw:
        return False
    try:
        peer = ipaddress.ip_address(peer_ip)
    except ValueError:
        return False
    for chunk in raw.split(","):
        chunk = chunk.strip()
        if not chunk:
            continue
        try:
            # Accept both single IPs ("127.0.0.1") and CIDR ("10.0.0.0/8")
            net = ipaddress.ip_network(chunk, strict=False)
            if peer in net:
                return True
        except ValueError:
            continue
    return False


def _identifier(request: Request) -> str:
    """Pick the most stable identity available for this request."""
    # If the auth dependency has already populated request.state.user, prefer that.
    user = getattr(request.state, "user", None)
    if user is not None and hasattr(user, "id"):
        return f"user:{user.id}"

    # Honor X-Forwarded-For ONLY if our peer is a trusted reverse proxy.
    # Otherwise the client controls XFF and the rate limit becomes a joke.
    peer_ip = request.client.host if request.client else None
    if _is_trusted_proxy(peer_ip):
        xff = request.headers.get("x-forwarded-for", "")
        if xff:
            # Leftmost entry is the original client per LB convention.
            client_ip = xff.split(",")[0].strip()
            if client_ip:
                return f"ip:{client_ip}"

    # Last resort: direct peer.
    if peer_ip:
        return f"ip:{peer_ip}"
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
            # Redis blip — fail open. Log so it shows up in monitoring.
            logger.warning("rate_limit fail-open (Redis error): %s", e)
            return

    return _check
