"""Per-user usage metering and quota reservation.

Counters live in `users/{uid}/usage/m-YYYY-MM` (monthly),
`users/{uid}/usage/d-YYYY-MM-DD` (daily) and `users/{uid}/usage/all` (since the account
was created: the free trial's minutes). `reserve` checks and increments in
one transaction, so concurrent requests cannot both pass the last unit of a
quota.
"""

from __future__ import annotations

import calendar
from datetime import UTC, datetime, timedelta
from enum import StrEnum
from typing import Any

from google.cloud import firestore

from app.core.errors import QuotaExceeded
from app.platform.firestore.paths import UserPaths


class Metric(StrEnum):
    LIVE_SECONDS = "liveSeconds"
    SESSIONS = "sessionsCreated"
    BLUEPRINTS = "blueprintGenerations"
    EVALUATIONS = "evaluations"
    REPROCESS = "reprocess"
    AI_CALLS = "aiCalls"
    PRACTICE_ROUNDS = "practiceRounds"
    ROUND_GUIDES = "roundGuides"
    EXAM_ANALYSES = "examAnalyses"
    DEBATE_PREPS = "debatePreparations"
    AI_TOKENS = "aiTokens"
    EST_COST_MICROS = "estCostMicros"


class Period(StrEnum):
    DAY = "day"
    MONTH = "month"
    #: Never resets: what the account has used in total.
    ALL = "all"


def period_key(period: Period, now: datetime | None = None) -> str:
    now = now or datetime.now(UTC)
    if period is Period.ALL:
        return "all"
    return f"d-{now:%Y-%m-%d}" if period is Period.DAY else f"m-{now:%Y-%m}"


def period_resets_at(period: Period, now: datetime | None = None) -> datetime:
    now = now or datetime.now(UTC)
    if period is Period.ALL:
        return datetime.max.replace(tzinfo=UTC)
    if period is Period.DAY:
        return datetime(now.year, now.month, now.day, tzinfo=UTC) + timedelta(days=1)
    last_day = calendar.monthrange(now.year, now.month)[1]
    return datetime(now.year, now.month, last_day, tzinfo=UTC) + timedelta(days=1)


class UsageService:
    def __init__(self, db: firestore.AsyncClient) -> None:
        self.db = db

    def _ref(self, uid: str, period: Period, now: datetime | None) -> firestore.AsyncDocumentReference:
        return self.db.document(UserPaths(uid).usage(period_key(period, now)))

    async def reserve(
        self,
        uid: str,
        metric: Metric,
        amount: int,
        *,
        limit: int | None,
        period: Period,
        now: datetime | None = None,
    ) -> int:
        """Atomically add `amount` unless it would exceed `limit`. Returns the new total."""
        ref = self._ref(uid, period, now)

        @firestore.async_transactional
        async def txn(transaction: firestore.AsyncTransaction) -> int:
            snap = await ref.get(transaction=transaction)
            current = int((snap.to_dict() or {}).get(metric.value, 0)) if snap.exists else 0
            if limit is not None and current + amount > limit:
                raise QuotaExceeded(
                    extra={
                        "metric": metric.value,
                        "limit": limit,
                        "used": current,
                        "resetsAt": period_resets_at(period, now).isoformat(),
                    }
                )
            transaction.set(
                ref,
                {metric.value: current + amount, "updatedAt": firestore.SERVER_TIMESTAMP},
                merge=True,
            )
            return current + amount

        return await txn(self.db.transaction())

    async def record(
        self, uid: str, values: dict[Metric, int], *, period: Period, now: datetime | None = None
    ) -> None:
        """Unconditionally add usage (e.g. tokens after a model call)."""
        update: dict[str, Any] = {m.value: firestore.Increment(v) for m, v in values.items() if v}
        if not update:
            return
        update["updatedAt"] = firestore.SERVER_TIMESTAMP
        await self._ref(uid, period, now).set(update, merge=True)

    async def totals(self, uid: str, period: Period, now: datetime | None = None) -> dict[str, int]:
        snap = await self._ref(uid, period, now).get()
        data = snap.to_dict() or {}
        return {m.value: int(data.get(m.value, 0)) for m in Metric}
