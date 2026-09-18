from types import SimpleNamespace

import pytest

from app.platform.ai.pricing import audio_minutes_cost_micros, input_tokens, output_tokens, token_cost_micros


def test_token_cost_uses_separate_input_and_output_rates() -> None:
    # 1M input at $0.75 and 1M output at $3.75
    assert token_cost_micros(1_000_000, 1_000_000, 750_000, 3_750_000) == 4_500_000


def test_token_cost_rounds_up_partial_micros() -> None:
    assert token_cost_micros(1, 0, 750_000, 3_750_000) == 1
    assert token_cost_micros(0, 0, 750_000, 3_750_000) == 0


def test_unconfigured_rate_is_unknown_not_free() -> None:
    assert token_cost_micros(1000, 1000, None, 3_750_000) is None
    assert audio_minutes_cost_micros(60_000, None) is None


def test_negative_counts_are_rejected() -> None:
    with pytest.raises(ValueError):
        token_cost_micros(-1, 0, 1, 1)
    with pytest.raises(ValueError):
        audio_minutes_cost_micros(-1, 16_000)


def test_audio_is_billed_per_started_second() -> None:
    assert audio_minutes_cost_micros(60_000, 16_000) == 16_000
    assert audio_minutes_cost_micros(1, 16_000) == 267  # one second
    assert audio_minutes_cost_micros(90_500, 16_000) == 24_267  # 91 seconds


def test_token_helpers_include_tool_prompts_and_thinking() -> None:
    meta = SimpleNamespace(
        prompt_token_count=100, tool_use_prompt_token_count=40, candidates_token_count=20, thoughts_token_count=30
    )
    assert input_tokens(meta) == 140
    assert output_tokens(meta) == 50
    empty = SimpleNamespace(prompt_token_count=None, candidates_token_count=None)
    assert input_tokens(empty) == 0
    assert output_tokens(empty) == 0
