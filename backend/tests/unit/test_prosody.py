from __future__ import annotations

import numpy as np

from app.platform.media.prosody import SAMPLE_RATE, measure_voice
from app.platform.transcripts.model import Segment


def pcm(signal: np.ndarray) -> bytes:
    return (np.clip(signal, -1, 1) * 32767).astype("<i2").tobytes()


def tone(hz: np.ndarray | float, seconds: float, amplitude: float = 0.3) -> np.ndarray:
    n = int(seconds * SAMPLE_RATE)
    freq = np.full(n, hz) if np.isscalar(hz) else np.asarray(hz)
    phase = 2 * np.pi * np.cumsum(freq) / SAMPLE_RATE
    # A few harmonics, like a voice, rather than a pure sine.
    return amplitude * (np.sin(phase) + 0.4 * np.sin(2 * phase) + 0.2 * np.sin(3 * phase)) / 1.6


def answer(segment_id: str, start_s: float, end_s: float) -> Segment:
    return Segment(id=segment_id, speaker="candidate", start_ms=int(start_s * 1000), end_ms=int(end_s * 1000), text="")


def test_flat_voice_is_measured_as_monotone() -> None:
    metrics = measure_voice(pcm(tone(150.0, 4)), [answer("s0001", 0, 4)])
    assert metrics.pitch_variation_st is not None and metrics.pitch_variation_st < 0.5
    assert [a.segment_id for a in metrics.flat_answers] == ["s0001"]
    assert metrics.measurements()["comm.intonation"]["verdict"] == "Monotone"


def test_moving_pitch_is_expressive() -> None:
    seconds = 4
    # Up an octave and back down, like an emphatic sentence.
    t = np.linspace(0, 1, int(seconds * SAMPLE_RATE))
    sweep = 120 * 2 ** (np.sin(np.pi * t))
    metrics = measure_voice(pcm(tone(sweep, seconds)), [answer("s0001", 0, seconds)])
    assert metrics.pitch_variation_st is not None and metrics.pitch_variation_st >= 3
    assert metrics.measurements()["comm.intonation"]["verdict"] == "Expressive"


def test_answer_that_fades_at_the_end_is_trailing_off() -> None:
    steady = tone(160.0, 4)
    fading = steady.copy()
    fading[int(len(fading) * 0.8) :] *= 0.25  # about 12 dB quieter for the last fifth
    audio = np.concatenate([steady, np.zeros(SAMPLE_RATE), fading])
    metrics = measure_voice(pcm(audio), [answer("s0001", 0, 4), answer("s0002", 5, 9)])
    assert [a.segment_id for a in metrics.trailing_answers] == ["s0002"]
    projection = metrics.measurements()["comm.projection"]
    assert projection["value"] == 50 and projection["verdict"] == "Often"


def test_silence_and_short_answers_are_not_measured() -> None:
    audio = np.zeros(6 * SAMPLE_RATE)
    metrics = measure_voice(pcm(audio), [answer("s0001", 0, 5), answer("s0002", 5, 6)])
    assert metrics.answers == [] and metrics.pitch_variation_st is None
    assert metrics.measurements() == {}


def test_summary_never_exposes_typical_pitch() -> None:
    summary = measure_voice(pcm(tone(150.0, 4)), [answer("s0001", 0, 4)]).summary()
    assert set(summary) == {"pitchVariationSemitones", "measuredAnswers", "flatAnswers", "trailingOffAnswers"}
