from __future__ import annotations

import pytest
from google.genai import errors

from app.core.settings import get_settings
from app.platform.ai.gateway import ModelBusy, Purpose, call_with_busy_retry, fallback_profile, profile_for


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


def test_a_busy_model_falls_back_to_a_widely_available_one() -> None:
    models = {"text_model": "gemini-3.8-flash", "text_fallback_model": "gemini-2.5-flash"}
    settings = get_settings().model_copy(update=models)
    coach = profile_for(Purpose.PRACTICE_COACH, settings)
    fallback = fallback_profile(coach, settings)
    assert fallback is not None and fallback.model == "gemini-2.5-flash"
    # The same work (limits, timeout), without the Gemini 3 thinking level the older model doesn't take.
    assert fallback.max_output_tokens == coach.max_output_tokens and fallback.timeout_s == coach.timeout_s
    assert fallback.thinking_level is None
    assert fallback_profile(coach, settings.model_copy(update={"text_fallback_model": ""})) is None
    assert fallback_profile(coach, settings.model_copy(update={"text_fallback_model": "gemini-3.8-flash"})) is None
