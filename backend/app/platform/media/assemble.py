"""Rebuilding continuous audio from the recorded track segments.

Candidate records are placed at their capture time; duplicates re-sent after a
reconnect are dropped by frame sequence number, and gaps become silence.
Interviewer records are placed at the playback time the app reported for their
turn, and cut where playback was stopped (for example by an interruption).
The result is raw PCM16 mono ready for ffmpeg.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass

from app.platform.media.tracks import SAMPLE_RATES, TrackRecord, decode_segment
from app.platform.storage.paths import Track

BYTES_PER_SAMPLE = 2


@dataclass(frozen=True)
class Playback:
    start_ms: int
    stop_ms: int | None = None


def _offset(ms: int, rate: int) -> int:
    return (ms * rate // 1000) * BYTES_PER_SAMPLE


def _records(segments: Iterable[bytes], expected: Track) -> list[TrackRecord]:
    out: list[TrackRecord] = []
    for data in segments:
        track, _, records = decode_segment(data)
        if track is not expected:
            raise ValueError(f"segment belongs to {track.value}, expected {expected.value}")
        out.extend(records)
    return out


def assemble_candidate(segments: Iterable[bytes], *, max_ms: int) -> bytes:
    rate = SAMPLE_RATES[Track.CANDIDATE]
    seen: set[int] = set()
    placed: list[TrackRecord] = []
    for record in _records(segments, Track.CANDIDATE):
        if record.key in seen:
            continue
        seen.add(record.key)
        placed.append(record)
    return _place(placed, rate, max_ms)


def assemble_interviewer(segments: Iterable[bytes], playback: dict[int, Playback], *, max_ms: int) -> bytes:
    rate = SAMPLE_RATES[Track.INTERVIEWER]
    records = [r for r in _records(segments, Track.INTERVIEWER) if r.key in playback]
    buffer = bytearray()
    limit = _offset(max_ms, rate)
    for record in sorted(records, key=lambda r: (playback[r.key].start_ms, r.position_ms)):
        turn = playback[record.key]
        start = _offset(turn.start_ms + record.position_ms, rate)
        pcm = record.pcm
        if turn.stop_ms is not None:
            stop = _offset(turn.stop_ms, rate)
            pcm = pcm[: max(0, stop - start)]
        _write(buffer, start, pcm, limit)
    return bytes(buffer)


def _place(records: list[TrackRecord], rate: int, max_ms: int) -> bytes:
    buffer = bytearray()
    limit = _offset(max_ms, rate)
    for record in sorted(records, key=lambda r: r.position_ms):
        _write(buffer, _offset(record.position_ms, rate), record.pcm, limit)
    return bytes(buffer)


def _write(buffer: bytearray, start: int, pcm: bytes, limit: int) -> None:
    if start >= limit or not pcm:
        return
    pcm = pcm[: limit - start]
    end = start + len(pcm)
    if len(buffer) < end:
        buffer.extend(b"\x00" * (end - len(buffer)))
    buffer[start:end] = pcm


def pcm_duration_ms(pcm: bytes, rate: int) -> int:
    return (len(pcm) // BYTES_PER_SAMPLE) * 1000 // rate
