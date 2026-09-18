"""Estimated cost of AI work, in micro-USD (1 USD = 1,000,000).

Estimates feed `usage.estCostMicros` and the `ai_usage` log so spend can be
watched per user and per purpose. They are not invoices: rates come from
configuration (`Settings.*_micros_per_m`, `speech_micros_per_minute`), Google
Search grounding and discounts are not included, and the billing budget remains
the source of truth.
"""

from __future__ import annotations

from typing import Any

MICROS_PER_TOKEN_UNIT = 1_000_000  # rates are per 1M tokens


def input_tokens(usage_metadata: Any) -> int:
    """Billed input tokens of one model response (prompt plus tool results fed back to the model)."""
    return int(getattr(usage_metadata, "prompt_token_count", 0) or 0) + int(
        getattr(usage_metadata, "tool_use_prompt_token_count", 0) or 0
    )


def output_tokens(usage_metadata: Any) -> int:
    """Billed output tokens of one model response (answer plus thinking)."""
    return int(getattr(usage_metadata, "candidates_token_count", 0) or 0) + int(
        getattr(usage_metadata, "thoughts_token_count", 0) or 0
    )


def _ceil_div(numerator: int, denominator: int) -> int:
    return -(-numerator // denominator)


def token_cost_micros(prompt: int, output: int, input_rate: int | None, output_rate: int | None) -> int | None:
    """Cost of `prompt` input and `output` output tokens at rates in micro-USD per 1M tokens.

    Returns None when a rate is not configured, so an unknown price is never reported as free.
    """
    if input_rate is None or output_rate is None:
        return None
    if prompt < 0 or output < 0:
        raise ValueError("token counts must be non-negative")
    return _ceil_div(prompt * input_rate + output * output_rate, MICROS_PER_TOKEN_UNIT)


def audio_minutes_cost_micros(duration_ms: int, rate_per_minute: int | None) -> int | None:
    """Cost of transcribing `duration_ms` of audio, billed per started second."""
    if rate_per_minute is None:
        return None
    if duration_ms < 0:
        raise ValueError("duration must be non-negative")
    seconds = _ceil_div(duration_ms, 1000)
    return _ceil_div(seconds * rate_per_minute, 60)
