"""
Redis client for caching and rate limiting.

Wraps aioredis with convenience methods. Falls back gracefully
if Redis isn't available (logs a warning, returns None).
"""

import logging
from typing import Optional

import redis.asyncio as aioredis

from app.core.config import settings

logger = logging.getLogger("repoinsight.redis")

_redis: Optional[aioredis.Redis] = None


async def get_redis() -> aioredis.Redis:
    global _redis
    if _redis is None:
        _redis = aioredis.from_url(
            settings.REDIS_URL,
            encoding="utf-8",
            decode_responses=True,
        )
    return _redis


async def cache_get(key: str) -> Optional[str]:
    try:
        r = await get_redis()
        return await r.get(key)
    except Exception as e:
        logger.warning(f"Redis GET failed for {key}: {e}")
        return None


async def cache_set(key: str, value: str, ttl_seconds: int = 3600):
    try:
        r = await get_redis()
        await r.set(key, value, ex=ttl_seconds)
    except Exception as e:
        logger.warning(f"Redis SET failed for {key}: {e}")


async def check_rate_limit(identifier: str, limit: int = 60, window: int = 60) -> bool:
    """
    Simple sliding-window rate limiter.
    Returns True if the request is allowed, False if over limit.
    """
    try:
        r = await get_redis()
        key = f"ratelimit:{identifier}"
        current = await r.incr(key)
        if current == 1:
            await r.expire(key, window)
        return current <= limit
    except Exception:
        return True  # fail open if Redis is down
