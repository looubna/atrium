from __future__ import annotations

import asyncio
from datetime import UTC, datetime

import pytest
from google.cloud import firestore

from app.core.errors import QuotaExceeded, RateLimited
from app.platform.ratelimit import RateLimiter
from app.platform.usage import Metric, Period, UsageService

NOW = datetime(2026, 9, 15, 12, 0, tzinfo=UTC)


async def test_reserve_enforces_limit(db: firestore.AsyncClient) -> None:
    usage = UsageService(db)
    for expected in (1, 2, 3):
        assert await usage.reserve("alice", Metric.SESSIONS, 1, limit=3, period=Period.DAY, now=NOW) == expected
    with pytest.raises(QuotaExceeded) as exc:
        await usage.reserve("alice", Metric.SESSIONS, 1, limit=3, period=Period.DAY, now=NOW)
    assert exc.value.extra["resetsAt"] == "2026-09-16T00:00:00+00:00"
    # Another user and another day are unaffected.
    assert await usage.reserve("bob", Metric.SESSIONS, 1, limit=3, period=Period.DAY, now=NOW) == 1
    tomorrow = datetime(2026, 9, 16, 1, 0, tzinfo=UTC)
    assert await usage.reserve("alice", Metric.SESSIONS, 1, limit=3, period=Period.DAY, now=tomorrow) == 1


async def test_concurrent_reservations_never_exceed_limit(db: firestore.AsyncClient) -> None:
    usage = UsageService(db)

    async def attempt() -> bool:
        try:
            await usage.reserve("alice", Metric.BLUEPRINTS, 1, limit=5, period=Period.DAY, now=NOW)
        except QuotaExceeded:
            return False
        except ValueError:
            # Transaction gave up after contention; the reservation did not happen.
            return False
        return True

    results = await asyncio.gather(*(attempt() for _ in range(12)))
    totals = await usage.totals("alice", Period.DAY, now=NOW)
    assert totals[Metric.BLUEPRINTS.value] == sum(results)
    assert totals[Metric.BLUEPRINTS.value] <= 5


async def test_record_accumulates(db: firestore.AsyncClient) -> None:
    usage = UsageService(db)
    await usage.record("alice", {Metric.AI_TOKENS: 1200, Metric.AI_CALLS: 1}, period=Period.MONTH, now=NOW)
    await usage.record("alice", {Metric.AI_TOKENS: 800, Metric.AI_CALLS: 1}, period=Period.MONTH, now=NOW)
    totals = await usage.totals("alice", Period.MONTH, now=NOW)
    assert totals["aiTokens"] == 2000
    assert totals["aiCalls"] == 2


async def test_rate_limiter_windows(db: firestore.AsyncClient) -> None:
    limiter = RateLimiter(db)
    t0 = 1_800_000_000.0
    for _ in range(3):
        await limiter.hit("alice", "blueprints", limit=3, window_seconds=60, now=t0)
    with pytest.raises(RateLimited) as exc:
        await limiter.hit("alice", "blueprints", limit=3, window_seconds=60, now=t0 + 10)
    assert 1 <= exc.value.extra["retryAfter"] <= 60
    await limiter.hit("bob", "blueprints", limit=3, window_seconds=60, now=t0 + 10)
    await limiter.hit("alice", "uploads", limit=3, window_seconds=60, now=t0 + 10)
    await limiter.hit("alice", "blueprints", limit=3, window_seconds=60, now=t0 + 60)


async def test_rate_limit_documents_do_not_contain_uid(db: firestore.AsyncClient) -> None:
    await RateLimiter(db).hit("alice-uid-secret", "sessions", limit=5, window_seconds=60)
    docs = [d async for d in db.collection("rateLimits").stream()]
    assert docs
    for d in docs:
        assert "alice-uid-secret" not in d.id
        assert "alice-uid-secret" not in str(d.to_dict())
        assert "expireAt" in (d.to_dict() or {})
