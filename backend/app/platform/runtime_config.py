"""Runtime switches stored in `config/runtime` (server-only).

`aiEnabled` is the cost kill switch: the budget alert handler turns it off and
new AI work (live sessions, generations, evaluations) is refused until an
operator turns it back on.
"""

from __future__ import annotations

import logging
import time
from typing import Any

from google.cloud import firestore

from app.platform.clients import clients
from app.platform.firestore.paths import RUNTIME_CONFIG_PATH

log = logging.getLogger(__name__)

_CACHE_SECONDS = 15.0
_cache: tuple[float, dict[str, Any]] | None = None


async def runtime_config(*, fresh: bool = False) -> dict[str, Any]:
    global _cache
    now = time.monotonic()
    if not fresh and _cache is not None and now - _cache[0] < _CACHE_SECONDS:
        return _cache[1]
    try:
        snap = await clients.firestore().document(RUNTIME_CONFIG_PATH).get()
        data = snap.to_dict() or {}
    except Exception:
        # Availability over spend protection during a Firestore blip; budgets still alert.
        log.warning("runtime config unavailable; using last known values", exc_info=True)
        return _cache[1] if _cache else {}
    _cache = (now, data)
    return data


async def ai_enabled() -> bool:
    return bool((await runtime_config()).get("aiEnabled", True))


async def set_ai_enabled(enabled: bool, reason: str) -> None:
    global _cache
    await clients.firestore().document(RUNTIME_CONFIG_PATH).set(
        {"aiEnabled": enabled, "aiReason": reason[:200], "aiChangedAt": firestore.SERVER_TIMESTAMP},
        merge=True,
    )
    _cache = None


def reset_cache() -> None:
    global _cache
    _cache = None
