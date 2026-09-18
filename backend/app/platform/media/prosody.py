"""Measured voice delivery from the candidate's recorded audio.

A model can judge whether someone sounds confident; these numbers show what it
heard, per answer: how much the pitch moves (a flat voice sounds monotone) and
whether the voice fades at the end of an answer. Only relative measures are
kept — never the speaker's typical pitch, which says more about who they are
than about how they present.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
from numpy.typing import NDArray

from app.platform.transcripts.model import Segment

SAMPLE_RATE = 16_000
FRAME = 640  # 40 ms
HOP = 320  # 20 ms
MIN_F0_HZ, MAX_F0_HZ = 70.0, 400.0
#: How periodic a frame must be to count as voiced (normalized autocorrelation peak).
VOICED_PEAK = 0.5
SILENCE_DBFS = -50.0
MIN_ANSWER_MS = 3_000
#: Below this spread of pitch an answer sounds flat.
MONOTONE_SEMITONES = 2.0
EXPRESSIVE_SEMITONES = 3.0
#: An answer "trails off" when its last fifth is this much quieter than its middle.
TRAIL_OFF_DB = 6.0


@dataclass(frozen=True)
class AnswerVoice:
    segment_id: str
    start_ms: int
    end_ms: int
    pitch_variation_st: float | None
    trail_off_db: float | None


@dataclass
class VoiceMetrics:
    answers: list[AnswerVoice] = field(default_factory=list)
    #: Median across answers of how much the pitch moves, in semitones.
    pitch_variation_st: float | None = None

    @property
    def flat_answers(self) -> list[AnswerVoice]:
        return [
            a for a in self.answers if a.pitch_variation_st is not None and a.pitch_variation_st < MONOTONE_SEMITONES
        ]

    @property
    def trailing_answers(self) -> list[AnswerVoice]:
        return [a for a in self.answers if a.trail_off_db is not None and a.trail_off_db >= TRAIL_OFF_DB]

    def summary(self) -> dict[str, object]:
        """Model-facing summary with segment references."""
        return {
            "pitchVariationSemitones": None if self.pitch_variation_st is None else round(self.pitch_variation_st, 1),
            "measuredAnswers": len(self.answers),
            "flatAnswers": [
                {"segmentId": a.segment_id, "semitones": round(a.pitch_variation_st or 0.0, 1)}
                for a in self.flat_answers[:8]
            ],
            "trailingOffAnswers": [
                {"segmentId": a.segment_id, "quieterByDb": round(a.trail_off_db or 0.0, 1)}
                for a in self.trailing_answers[:8]
            ],
        }

    def measurements(self) -> dict[str, dict[str, object]]:
        """Measured facts shown next to the intonation and projection scores."""
        out: dict[str, dict[str, object]] = {}
        if self.pitch_variation_st is not None:
            value = round(self.pitch_variation_st, 1)
            out["comm.intonation"] = {
                "label": "Pitch movement", "value": value, "unit": "semitones", "target": "3 or more",
                "verdict": "Monotone" if value < MONOTONE_SEMITONES
                else "A little flat" if value < EXPRESSIVE_SEMITONES else "Expressive",
                "details": f"{len(self.flat_answers)} of {len(self.answers)} answers sounded flat",
            }
        if self.answers:
            share = round(100 * len(self.trailing_answers) / len(self.answers))
            out["comm.projection"] = {
                "label": "Answers that fade at the end", "value": share, "unit": "%", "target": "under 20%",
                "verdict": "Often" if share > 40 else "Sometimes" if share > 20 else "Rarely",
                "details": f"{len(self.trailing_answers)} of {len(self.answers)} answers got much quieter at the end",
            }
        return out


def _frames(samples: NDArray[np.float32]) -> NDArray[np.float32]:
    if len(samples) < FRAME:
        return np.empty((0, FRAME), dtype=np.float32)
    return np.lib.stride_tricks.sliding_window_view(samples, FRAME)[::HOP]


def _frame_levels_dbfs(frames: NDArray[np.float32]) -> NDArray[np.float64]:
    rms = np.sqrt(np.mean(np.square(frames, dtype=np.float64), axis=1))
    return 20 * np.log10(np.maximum(rms, 1e-9))


def _frame_pitch_hz(frames: NDArray[np.float32]) -> NDArray[np.float64]:
    """Pitch per frame by normalized autocorrelation; NaN where the frame isn't clearly voiced."""
    windowed = (frames - frames.mean(axis=1, keepdims=True)) * np.hanning(FRAME)
    power = np.abs(np.fft.rfft(windowed, n=2 * FRAME, axis=1)) ** 2
    autocorr = np.fft.irfft(power, axis=1)[:, :FRAME]
    energy = autocorr[:, :1]
    normalized = np.divide(autocorr, energy, out=np.zeros_like(autocorr), where=energy > 0)
    low, high = int(SAMPLE_RATE / MAX_F0_HZ), int(SAMPLE_RATE / MIN_F0_HZ)
    lags = normalized[:, low : high + 1]
    best = np.argmax(lags, axis=1)
    peaks = lags[np.arange(len(lags)), best]
    pitch = SAMPLE_RATE / (best + low).astype(np.float64)
    return np.where(peaks >= VOICED_PEAK, pitch, np.nan)


def measure_answer(pcm: NDArray[np.float32], segment: Segment) -> AnswerVoice | None:
    start = max(0, segment.start_ms * SAMPLE_RATE // 1000)
    end = min(len(pcm), segment.end_ms * SAMPLE_RATE // 1000)
    if (end - start) * 1000 // SAMPLE_RATE < MIN_ANSWER_MS:
        return None
    frames = _frames(pcm[start:end])
    levels = _frame_levels_dbfs(frames)
    speaking = levels > SILENCE_DBFS
    if speaking.sum() < 10:
        return None

    pitch = _frame_pitch_hz(frames)
    voiced = pitch[speaking & ~np.isnan(pitch)]
    variation: float | None = None
    if len(voiced) >= 20:
        semitones = 12 * np.log2(voiced / np.median(voiced))
        semitones = semitones[np.abs(semitones) <= 12]  # octave jumps are estimation errors
        variation = float(np.std(semitones)) if len(semitones) >= 20 else None

    loud = levels[speaking]
    tail = max(1, len(loud) // 5)
    trail_off: float | None = None
    if len(loud) >= 25:
        middle = loud[tail : len(loud) - tail]
        trail_off = float(np.mean(middle) - np.mean(loud[-tail:]))
    return AnswerVoice(segment.id, segment.start_ms, segment.end_ms, variation, trail_off)


def measure_voice(pcm16: bytes, candidate_segments: list[Segment]) -> VoiceMetrics:
    """Voice measurements for each candidate answer; `pcm16` is the candidate track (16 kHz mono)."""
    samples = np.frombuffer(pcm16[: len(pcm16) // 2 * 2], dtype="<i2").astype(np.float32) / 32768.0
    answers = [a for s in candidate_segments if (a := measure_answer(samples, s)) is not None]
    variations = [a.pitch_variation_st for a in answers if a.pitch_variation_st is not None]
    return VoiceMetrics(answers=answers, pitch_variation_st=float(np.median(variations)) if variations else None)
