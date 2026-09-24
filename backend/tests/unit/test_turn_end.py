from __future__ import annotations

import struct

from app.platform.agents.panel import TURN_END_SILENCE_MS, TurnEndWatch

SPEECH = struct.pack("<1600h", *([3000, -3000] * 800))
QUIET = bytes(3200)
#: Quiet frames comfortably past the threshold, so these read the constant rather than a
#: number that has to be chased every time the backstop moves.
PAST_THRESHOLD = TURN_END_SILENCE_MS // 100 + 10


def feed(watch: TurnEndWatch, start_ms: int, pcm: bytes, frames: int) -> list[bool]:
    return [watch.feed(start_ms + i * 100, pcm) for i in range(frames)]


def test_a_finished_answer_is_noticed_once_after_the_silence() -> None:
    watch = TurnEndWatch()
    assert not any(feed(watch, 0, SPEECH, 20))  # two seconds of answer
    fired = feed(watch, 2_000, QUIET, PAST_THRESHOLD)
    assert fired.count(True) == 1
    # It fires once the silence reaches the threshold, not before.
    assert fired.index(True) == TURN_END_SILENCE_MS // 100 - 1


def test_a_thinking_pause_shorter_than_the_threshold_does_not_fire() -> None:
    watch = TurnEndWatch()
    feed(watch, 0, SPEECH, 20)
    assert not any(feed(watch, 2_000, QUIET, 15))  # 1.5 s pause
    assert not any(feed(watch, 3_500, SPEECH, 10))  # carries on talking
    assert any(feed(watch, 4_500, QUIET, PAST_THRESHOLD))


def test_silence_or_a_cough_alone_is_not_an_answer() -> None:
    watch = TurnEndWatch()
    assert not any(feed(watch, 0, QUIET, 60))
    feed(watch, 6_000, SPEECH, 3)  # 0.3 s
    assert not any(feed(watch, 6_300, QUIET, PAST_THRESHOLD))


def test_it_listens_again_once_the_interviewer_has_spoken() -> None:
    watch = TurnEndWatch()
    feed(watch, 0, SPEECH, 20)
    assert any(feed(watch, 2_000, QUIET, PAST_THRESHOLD))
    watch.reset()
    feed(watch, 10_000, SPEECH, 20)
    assert any(feed(watch, 12_000, QUIET, PAST_THRESHOLD))


def test_a_model_already_replying_needs_no_note() -> None:
    """The backstop stands down as soon as the model says anything, however long the silence."""
    watch = TurnEndWatch()
    feed(watch, 0, SPEECH, 20)
    watch.settle()
    assert not any(feed(watch, 2_000, QUIET, PAST_THRESHOLD))


def test_the_handover_may_use_a_shorter_silence() -> None:
    """A panel handover says nothing to the model, so it need not wait out the backstop."""
    watch = TurnEndWatch()
    feed(watch, 0, SPEECH, 20)
    fired = [watch.feed(2_000 + i * 100, QUIET, silence_ms=1_200) for i in range(PAST_THRESHOLD)]
    assert fired.index(True) == 11  # 1.2 s, not the backstop's window
