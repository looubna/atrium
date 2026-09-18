"""Rate limiting that holds across Cloud Run instances.

Fixed windows counted in Firestore (`rateLimits/{hash}` with a TTL on
`expireAt`) for expensive routes, where correctness matters more than a few
milliseconds. Keys are hashed so documents never contain the uid.
"""

from __future__ import annotations

import hashlib
import math
import time
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import Annotated

from fastapi import Depends
from google.cloud import firestore

from app.core.errors import RateLimited
from app.platform.auth.dependencies import AuthUser, _current_user
from app.platform.clients import clients
from app.platform.firestore.paths import rate_limit_path


class RateLimiter:
    def __init__(self, db: firestore.AsyncClient) -> None:
        self.db = db

    async def hit(
        self, subject: str, bucket: str, *, limit: int, window_seconds: int, now: float | None = None
    ) -> None:
        now = time.time() if now is None else now
        window = math.floor(now / window_seconds)
        window_end = (window + 1) * window_seconds
        key = hashlib.sha256(f"{bucket}:{subject}:{window_seconds}:{window}".encode()).hexdigest()[:48]
        ref = self.db.document(rate_limit_path(key))

        @firestore.async_transactional
        async def txn(transaction: firestore.AsyncTransaction) -> None:
            snap = await ref.get(transaction=transaction)
            count = int((snap.to_dict() or {}).get("count", 0)) if snap.exists else 0
            if count >= limit:
                raise RateLimited(extra={"retryAfter": max(1, math.ceil(window_end - now))})
            transaction.set(
                ref,
                {
                    "count": count + 1,
                    "bucket": bucket,
                    "expireAt": datetime.fromtimestamp(window_end + window_seconds, UTC),
                },
            )

        await txn(self.db.transaction())


def rate_limit(bucket: str, *, limit: int, window_seconds: int) -> Callable[..., Awaitable[AuthUser]]:
    """Route dependency: authenticates the caller and counts the request against their bucket."""

    async def dependency(user: Annotated[AuthUser, Depends(_current_user)]) -> AuthUser:
        await RateLimiter(clients.firestore()).hit(
            user.uid, bucket, limit=limit, window_seconds=window_seconds
        )
        return user

    return dependency
