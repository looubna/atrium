from __future__ import annotations

from app.platform.ai.tts import too_long

HELLO = "Hi, I'm Daniel, I lead the team you'd be joining. Nice to meet you."


def seconds(n: float, rate: int = 24_000) -> bytes:
    return b"\x00\x00" * int(rate * n)


def test_a_line_said_once_is_kept() -> None:
    assert not too_long(seconds(4.8), HELLO, 24_000)
    assert not too_long(seconds(7.0), HELLO, 24_000)  # a slow, thoughtful read


def test_a_line_said_twice_is_caught() -> None:
    # Measured 2026-10-01: Gemini-TTS read this hello twice, 9 s of speech for a 4.8 s line.
    assert too_long(seconds(9.0), HELLO, 24_000)
