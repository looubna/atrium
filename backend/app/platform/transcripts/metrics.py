"""Deterministic delivery measurements from word timestamps.

Pace, fillers, pauses and repetition are measured, not guessed by a model. The
evaluator receives these numbers and the segments they refer to, and can only
cite moments that the measurements or the transcript actually contain.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field
from itertools import pairwise
from typing import TYPE_CHECKING

from app.platform.transcripts.model import Segment, normalize

if TYPE_CHECKING:
    from app.platform.media.prosody import VoiceMetrics

HARD_FILLERS = frozenset({"um", "uh", "erm", "er", "uhm", "hmm", "mm", "ah"})
SOFT_FILLERS = frozenset({"basically", "literally", "actually"})
FILLER_PHRASES = frozenset({("you", "know"), ("i", "mean"), ("sort", "of"), ("kind", "of")})
# "like" only counts as a filler after words that rarely precede its real uses.
LIKE_FILLER_AFTER = frozenset({"and", "so", "just", "was", "it's"})
REPEAT_ALLOWED = frozenset({"very", "no", "yes", "that", "bye"})

FAST_WPM = 185
SLOW_WPM = 100
#: Comfortable interview speaking rate, and the filler rate most listeners stop noticing below.
PACE_TARGET_WPM = (130, 160)
FILLER_TARGET_PER_MINUTE = 2.0
MIN_SEGMENT_MS_FOR_PACE = 8_000
LONG_PAUSE_MS = 2_500


@dataclass(frozen=True)
class SegmentPace:
    segment_id: str
    start_ms: int
    end_ms: int
    wpm: int


@dataclass(frozen=True)
class Moment:
    segment_id: str
    start_ms: int
    end_ms: int
    detail: str


@dataclass
class DeliveryMetrics:
    speaking_ms: int = 0
    word_count: int = 0
    wpm: int = 0
    filler_count: int = 0
    fillers_per_minute: float = 0.0
    mean_confidence: float | None = None
    pace: list[SegmentPace] = field(default_factory=list)
    fast_segments: list[SegmentPace] = field(default_factory=list)
    slow_segments: list[SegmentPace] = field(default_factory=list)
    fillers: list[Moment] = field(default_factory=list)
    long_pauses: list[Moment] = field(default_factory=list)
    repetitions: list[Moment] = field(default_factory=list)

    def summary(self) -> dict[str, object]:
        """Compact, model-facing summary with segment references."""
        return {
            "speakingSeconds": round(self.speaking_ms / 1000),
            "words": self.word_count,
            "wordsPerMinute": self.wpm,
            "fillerCount": self.filler_count,
            "fillersPerMinute": round(self.fillers_per_minute, 1),
            "fastSegments": [{"segmentId": p.segment_id, "wpm": p.wpm} for p in self.fast_segments[:8]],
            "slowSegments": [{"segmentId": p.segment_id, "wpm": p.wpm} for p in self.slow_segments[:8]],
            "fillerMoments": [
                {"segmentId": m.segment_id, "atMs": m.start_ms, "word": m.detail} for m in self.fillers[:12]
            ],
            "longPauses": [
                {"segmentId": m.segment_id, "startMs": m.start_ms, "endMs": m.end_ms} for m in self.long_pauses[:8]
            ],
            "repetitions": [
                {"segmentId": m.segment_id, "atMs": m.start_ms, "phrase": m.detail} for m in self.repetitions[:8]
            ],
        }


def competency_measurements(
    metrics: DeliveryMetrics, voice: VoiceMetrics | None = None
) -> dict[str, dict[str, object]]:
    """Measured facts shown next to delivery scores: the value, its target and a plain verdict."""
    if not metrics.speaking_ms or not metrics.word_count:
        return {}
    minutes = metrics.speaking_ms / 60_000
    low, high = PACE_TARGET_WPM
    fillers = round(metrics.fillers_per_minute, 1)
    pauses = round(len(metrics.long_pauses) / minutes, 1)
    repeats = len(metrics.repetitions)
    common_fillers = Counter(m.detail for m in metrics.fillers).most_common(3)
    repeated = list(dict.fromkeys(m.detail for m in metrics.repetitions))[:3]
    measured: dict[str, dict[str, object]] = {
        "comm.pace": {
            "label": "Speaking rate", "value": metrics.wpm, "unit": "words/min", "target": f"{low}-{high}",
            "verdict": "Too fast" if metrics.wpm > high + 10 else "Too slow" if metrics.wpm < low - 10 else "In range",
            "details": f"{len(metrics.fast_segments)} answers too fast, {len(metrics.slow_segments)} too slow",
        },
        "comm.filler_words": {
            "label": "Filler words", "value": fillers, "unit": "per minute", "target": "under 2",
            "verdict": "Frequent" if fillers > 4 else "Noticeable" if fillers > FILLER_TARGET_PER_MINUTE else "Low",
            "details": ", ".join(f"“{word}” x{count}" for word, count in common_fillers),
        },
        "comm.fluency": {
            "label": "Long pauses", "value": pauses, "unit": "per minute", "target": "under 1",
            "verdict": "Frequent" if pauses > 2 else "Some" if pauses > 1 else "Rare",
            "details": f"{len(metrics.long_pauses)} pauses of 2.5 seconds or more",
        },
        "comm.repetition": {
            "label": "Repeated words", "value": repeats, "unit": "times", "target": "0-1",
            "verdict": "Frequent" if repeats > 4 else "Some" if repeats > 1 else "Rare",
            "details": ", ".join(f"“{phrase}”" for phrase in repeated),
        },
    }
    if voice is not None:
        measured.update(voice.measurements())
    return measured


def _scan_terms(segment: Segment, metrics: DeliveryMetrics) -> None:
    words = segment.words
    terms = [normalize(w.text) for w in words]
    for i, term in enumerate(terms):
        following = terms[i + 1] if i + 1 < len(terms) else ""
        previous = terms[i - 1] if i > 0 else ""
        if term in HARD_FILLERS or term in SOFT_FILLERS:
            metrics.fillers.append(Moment(segment.id, words[i].start_ms, words[i].end_ms, term))
        elif (term, following) in FILLER_PHRASES:
            metrics.fillers.append(Moment(segment.id, words[i].start_ms, words[i + 1].end_ms, f"{term} {following}"))
        elif term == "like" and previous in LIKE_FILLER_AFTER:
            metrics.fillers.append(Moment(segment.id, words[i].start_ms, words[i].end_ms, term))

        if term and term == previous and term not in REPEAT_ALLOWED:
            metrics.repetitions.append(Moment(segment.id, words[i - 1].start_ms, words[i].end_ms, f"{term} {term}"))


def compute_delivery_metrics(candidate: list[Segment]) -> DeliveryMetrics:
    metrics = DeliveryMetrics()
    confidences: list[float] = []

    for segment in candidate:
        words = segment.words
        if not words:
            continue
        duration = max(1, segment.end_ms - segment.start_ms)
        metrics.speaking_ms += duration
        metrics.word_count += len(words)
        confidences.extend(w.confidence for w in words if w.confidence is not None)

        if duration >= MIN_SEGMENT_MS_FOR_PACE:
            pace = SegmentPace(segment.id, segment.start_ms, segment.end_ms, round(len(words) * 60_000 / duration))
            metrics.pace.append(pace)
            if pace.wpm > FAST_WPM:
                metrics.fast_segments.append(pace)
            elif pace.wpm < SLOW_WPM:
                metrics.slow_segments.append(pace)

        _scan_terms(segment, metrics)

        for prev, word in pairwise(words):
            if word.start_ms - prev.end_ms >= LONG_PAUSE_MS:
                metrics.long_pauses.append(Moment(segment.id, prev.end_ms, word.start_ms, "pause"))

    metrics.filler_count = len(metrics.fillers)
    if metrics.speaking_ms:
        minutes = metrics.speaking_ms / 60_000
        metrics.wpm = round(metrics.word_count / minutes)
        metrics.fillers_per_minute = metrics.filler_count / minutes
    if confidences:
        metrics.mean_confidence = sum(confidences) / len(confidences)
    return metrics
