from __future__ import annotations

import pytest
from google.genai import errors

from app.platform.ai.gateway import ModelBusy, call_with_busy_retry


def api_error(code: int, status: str) -> errors.ClientError:
    return errors.ClientError(code, {"error": {"code": code, "message": status.lower(), "status": status}})


async def no_sleep(_: float) -> None:
    return None


async def test_busy_model_is_retried_and_each_wait_is_reported() -> None:
    outcomes: list[object] = [api_error(429, "RESOURCE_EXHAUSTED"), api_error(429, "RESOURCE_EXHAUSTED"), "done"]
    waits: list[tuple[int, float]] = []

    async def run() -> str:
        outcome = outcomes.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return str(outcome)

    async def on_wait(attempt: int, delay: float) -> None:
        waits.append((attempt, delay))

    assert await call_with_busy_retry(run, delays=(1.0, 2.0, 4.0), on_wait=on_wait, sleep=no_sleep) == "done"
    assert waits == [(1, 1.0), (2, 2.0)]


async def test_gives_up_with_model_busy_after_the_last_wait() -> None:
    calls = 0

    async def run() -> str:
        nonlocal calls
        calls += 1
        raise api_error(429, "RESOURCE_EXHAUSTED")

    with pytest.raises(ModelBusy):
        await call_with_busy_retry(run, delays=(1.0, 2.0), sleep=no_sleep)
    assert calls == 3


async def test_other_errors_are_not_retried() -> None:
    calls = 0

    async def run() -> str:
        nonlocal calls
        calls += 1
        raise api_error(400, "INVALID_ARGUMENT")

    with pytest.raises(errors.ClientError):
        await call_with_busy_retry(run, delays=(1.0,), sleep=no_sleep)
    assert calls == 1
