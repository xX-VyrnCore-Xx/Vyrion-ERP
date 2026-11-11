from collections.abc import AsyncIterator

import pytest
from redis.asyncio import Redis

from app.core.ratelimit import RateLimiter
from tests.conftest import integration_settings


@pytest.fixture
async def limiter() -> AsyncIterator[RateLimiter]:
    settings = integration_settings()
    if settings is None:
        pytest.skip("VYRION_DATABASE_URL / VYRION_REDIS_URL not set")
    redis = Redis.from_url(settings.redis_url.unicode_string())
    yield RateLimiter(redis, prefix=settings.redis_key_prefix)
    await redis.aclose()


@pytest.mark.integration
async def test_counts_within_a_window_and_reports_when_it_resets(limiter: RateLimiter) -> None:
    hits = [await limiter.hit("t1", window=60) for _ in range(4)]
    assert [hit.count for hit in hits] == [1, 2, 3, 4]
    assert hits[-1].exceeds(3) and not hits[0].exceeds(3)
    assert 0 < hits[-1].retry_after <= 60
    await limiter.reset("t1")


@pytest.mark.integration
async def test_every_key_gets_an_expiry_and_names_are_independent(limiter: RateLimiter) -> None:
    await limiter.hit("a", window=30)
    other = await limiter.hit("b", window=30)
    assert other.count == 1
    assert 0 < (await limiter.peek("a")).retry_after <= 30  # never left without a TTL
    await limiter.reset("a")
    await limiter.reset("b")


@pytest.mark.integration
async def test_peek_does_not_count_and_reset_clears(limiter: RateLimiter) -> None:
    await limiter.hit("p", window=60)
    assert (await limiter.peek("p")).count == 1
    assert (await limiter.peek("p")).count == 1
    await limiter.reset("p")
    assert (await limiter.peek("p")).count == 0
    assert (await limiter.peek("never-seen")).count == 0


async def test_an_unreachable_redis_fails_open_instead_of_locking_everyone_out() -> None:
    redis = Redis.from_url("redis://127.0.0.1:1/0", socket_connect_timeout=0.2)
    limiter = RateLimiter(redis, prefix="x")
    assert (await limiter.hit("k", window=60)).count == 0
    assert (await limiter.peek("k")).count == 0
    await limiter.reset("k")  # must not raise
    await redis.aclose()
