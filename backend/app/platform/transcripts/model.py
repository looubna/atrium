"""Transcript data model on the session's media clock.

Candidate words come from Speech-to-Text on the server-recorded candidate
track, so their timestamps are exact. Interviewer segments come from the live
turn log (what the interviewer said and when the app played it). All times are
milliseconds since the start of the recording.
"""

from __future__ import annotations

import re
from typing import Literal

from pydantic import BaseModel, Field

Speaker = Literal["candidate", "interviewer"]

# A new candidate segment starts after a pause this long, or after sentence-ending
# punctuation followed by a shorter pause, and never runs longer than the cap.
SEGMENT_GAP_MS = 1200
SENTENCE_GAP_MS = 500
SEGMENT_MAX_MS = 25_000


class Word(BaseModel):
    text: str
    start_ms: int = Field(ge=0)
    end_ms: int = Field(ge=0)
    confidence: float | None = None


class Segment(BaseModel):
    id: str
    speaker: Speaker
    start_ms: int = Field(ge=0)
    end_ms: int = Field(ge=0)
    text: str
    words: list[Word] = Field(default_factory=list)


class Transcript(BaseModel):
    version: int = 1
    duration_ms: int = Field(ge=0)
    language: str = "en-US"
    segments: list[Segment] = Field(default_factory=list)

    def segment_map(self) -> dict[str, Segment]:
        return {s.id: s for s in self.segments}

    def candidate_segments(self) -> list[Segment]:
        return [s for s in self.segments if s.speaker == "candidate"]


def normalize(text: str) -> str:
    """Lower-case, strip punctuation, collapse whitespace: for quote matching."""
    return " ".join(re.sub(r"[^\w\s']", " ", text.lower()).split())


def build_candidate_segments(words: list[Word]) -> list[Segment]:
    segments: list[Segment] = []
    current: list[Word] = []

    def close() -> None:
        if current:
            segments.append(
                Segment(
                    id="",
                    speaker="candidate",
                    start_ms=current[0].start_ms,
                    end_ms=current[-1].end_ms,
                    text=" ".join(w.text for w in current),
                    words=list(current),
                )
            )
            current.clear()

    for word in sorted(words, key=lambda w: w.start_ms):
        if current:
            gap = word.start_ms - current[-1].end_ms
            sentence_end = current[-1].text.endswith((".", "?", "!"))
            too_long = word.end_ms - current[0].start_ms > SEGMENT_MAX_MS
            if gap >= SEGMENT_GAP_MS or (sentence_end and gap >= SENTENCE_GAP_MS) or too_long:
                close()
        current.append(word)
    close()
    return segments


def drop_echo(words: list[Word], interviewer: list[Segment], *, pad_ms: int = 250) -> list[Word]:
    """Remove candidate words that are the interviewer's voice leaking into the mic.

    A word is echo when it falls inside an interviewer playback window and also
    appears in what the interviewer said in that window.
    """
    windows = [(s.start_ms - pad_ms, s.end_ms + pad_ms, set(normalize(s.text).split())) for s in interviewer]
    kept: list[Word] = []
    for word in words:
        token = normalize(word.text)
        echo = any(start <= word.start_ms <= end and token and token in vocab for start, end, vocab in windows)
        if not echo:
            kept.append(word)
    return kept


def assemble_transcript(
    candidate_words: list[Word], interviewer_turns: list[Segment], duration_ms: int, language: str = "en-US"
) -> Transcript:
    words = drop_echo(candidate_words, interviewer_turns)
    candidate = build_candidate_segments(words)
    merged = sorted([*candidate, *interviewer_turns], key=lambda s: (s.start_ms, s.speaker != "interviewer"))
    for index, segment in enumerate(merged, start=1):
        segment.id = f"s{index:04d}"
    return Transcript(duration_ms=duration_ms, language=language, segments=merged)
