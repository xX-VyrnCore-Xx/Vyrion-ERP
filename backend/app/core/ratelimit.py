"""Fixed-window rate limiting on Redis.

If Redis is unreachable the limiter *fails open* (and logs an error): the database-backed
account lockout still protects every account, and a Redis outage must not lock everyone out
of the company system. The outage itself is visible on the readiness endpoint.
"""

import logging
from dataclasses import dataclass

from redis.asyncio import Redis
from redis.exceptions import RedisError

logger = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class Hit:
    count: int
    retry_after: int  # seconds until the window resets

    def exceeds(self, limit: int) -> bool:
        return self.count > limit


class RateLimiter:
    def __init__(self, redis: Redis, *, prefix: str) -> None:
        self._redis = redis
        self._prefix = prefix

    def _key(self, name: str) -> str:
        return f"{self._prefix}:rl:{name}"

    async def hit(self, name: str, *, window: int) -> Hit:
        """Count one event in the current window. ``EXPIRE NX`` runs in the same
        transaction as ``INCR``, so a key can never be left without an expiry."""
        key = self._key(name)
        try:
            pipe = self._redis.pipeline(transaction=True)
            pipe.incr(key)
            pipe.expire(key, window, nx=True)
            pipe.ttl(key)
            count, _, ttl = await pipe.execute()
        except RedisError:
            logger.error("rate limiter unavailable, failing open", exc_info=True)
            return Hit(count=0, retry_after=0)
        return Hit(count=int(count), retry_after=max(int(ttl), 1))

    async def peek(self, name: str) -> Hit:
        key = self._key(name)
        try:
            pipe = self._redis.pipeline(transaction=True)
            pipe.get(key)
            pipe.ttl(key)
            value, ttl = await pipe.execute()
        except RedisError:
            logger.error("rate limiter unavailable, failing open", exc_info=True)
            return Hit(count=0, retry_after=0)
        return Hit(count=int(value or 0), retry_after=max(int(ttl), 0))

    async def reset(self, name: str) -> None:
        try:
            await self._redis.delete(self._key(name))
        except RedisError:
            logger.error("rate limiter unavailable while resetting", exc_info=True)
