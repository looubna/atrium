"""Server-side capture of the live conversation as two tracks.

The gateway already relays every candidate microphone frame and every
interviewer audio chunk, so it records both without relying on the phone's
upload. Records carry their position on the session's media clock (ms since
the client started capturing), which lets the pipeline rebuild aligned audio
and drop frames re-sent after a reconnect.

Segment object layout (little-endian):
    header : b"ATRK" | version u8 | track u8 | sample_rate u32 | reserved u16
    record : key u32 | position_ms u32 | length u16 | pcm16 bytes

Candidate records: key = client frame seq, position = capture time.
Interviewer records: key = interviewer turn seq, position = offset within the turn.
"""

from __future__ import annotations

import struct
from collections.abc import Awaitable, Callable, Iterator
from dataclasses import dataclass, field

from app.platform.storage.objects import ObjectExists, ObjectStore
from app.platform.storage.paths import StoragePaths, Track

MAGIC = b"ATRK"
VERSION = 1
HEADER = struct.Struct("<4sBBIH")
RECORD = struct.Struct("<IIH")
MAX_RECORD_BYTES = 0xFFFF

SAMPLE_RATES = {Track.CANDIDATE: 16_000, Track.INTERVIEWER: 24_000}
TRACK_CODES = {Track.CANDIDATE: 1, Track.INTERVIEWER: 2}
CODE_TRACKS = {v: k for k, v in TRACK_CODES.items()}

# Flush roughly every 30 s of audio: bounded loss if an instance dies, few objects per session.
FLUSH_AUDIO_SECONDS = 30


class TrackFormatError(ValueError):
    pass


@dataclass(frozen=True, slots=True)
class TrackRecord:
    key: int
    position_ms: int
    pcm: bytes


def pcm_duration_ms(nbytes: int, sample_rate: int) -> int:
    return (nbytes // 2) * 1000 // sample_rate


def encode_segment(track: Track, records: list[TrackRecord]) -> bytes:
    parts = [HEADER.pack(MAGIC, VERSION, TRACK_CODES[track], SAMPLE_RATES[track], 0)]
    for rec in records:
        if len(rec.pcm) > MAX_RECORD_BYTES or len(rec.pcm) % 2:
            raise TrackFormatError("invalid pcm chunk")
        parts.append(RECORD.pack(rec.key, rec.position_ms, len(rec.pcm)))
        parts.append(rec.pcm)
    return b"".join(parts)


def decode_segment(data: bytes) -> tuple[Track, int, Iterator[TrackRecord]]:
    if len(data) < HEADER.size:
        raise TrackFormatError("segment too short")
    magic, version, code, sample_rate, _ = HEADER.unpack_from(data, 0)
    if magic != MAGIC or version != VERSION or code not in CODE_TRACKS:
        raise TrackFormatError("not a track segment")

    def records() -> Iterator[TrackRecord]:
        offset = HEADER.size
        while offset < len(data):
            if offset + RECORD.size > len(data):
                raise TrackFormatError("truncated record header")
            key, position, length = RECORD.unpack_from(data, offset)
            offset += RECORD.size
            if offset + length > len(data):
                raise TrackFormatError("truncated record body")
            yield TrackRecord(key, position, data[offset : offset + length])
            offset += length

    return CODE_TRACKS[code], int(sample_rate), records()


#: How many taken segment numbers a flush skips before giving up.
MAX_INDEX_SKIPS = 64


@dataclass
class TrackWriter:
    """Buffers records for one track and writes numbered segments.

    `next_index` is persisted by the caller (via `on_flush`) so a reconnect on
    another instance continues numbering without overwriting earlier segments.
    """

    store: ObjectStore
    paths: StoragePaths
    session_id: str
    track: Track
    next_index: int = 0
    on_flush: Callable[[Track, int], Awaitable[None]] | None = None
    _buffer: list[TrackRecord] = field(default_factory=list)
    _buffered_bytes: int = 0

    def append(self, key: int, position_ms: int, pcm: bytes) -> None:
        for start in range(0, len(pcm), MAX_RECORD_BYTES - 1):
            chunk = pcm[start : start + MAX_RECORD_BYTES - 1]
            chunk = chunk[: len(chunk) - (len(chunk) % 2)]
            if chunk:
                offset_ms = pcm_duration_ms(start, SAMPLE_RATES[self.track])
                self._buffer.append(TrackRecord(key, position_ms + offset_ms, chunk))
                self._buffered_bytes += len(chunk)

    @property
    def should_flush(self) -> bool:
        return pcm_duration_ms(self._buffered_bytes, SAMPLE_RATES[self.track]) >= FLUSH_AUDIO_SECONDS * 1000

    async def flush(self) -> None:
        if not self._buffer:
            return
        records, self._buffer, self._buffered_bytes = self._buffer, [], 0
        data = encode_segment(self.track, records)
        index = self.next_index
        # Another connection for the same session (a reconnect racing the old one's last flush)
        # may already have used this number: take the next free one. Assembly orders records by
        # position and drops duplicates, so the numbering only has to be unique.
        for _ in range(MAX_INDEX_SKIPS):
            name = self.paths.live_segment(self.session_id, self.track, index)
            try:
                await self.store.write(name, data, "application/octet-stream", create_only=True)
                break
            except ObjectExists:
                index += 1
        else:
            raise ObjectExists(self.paths.live_segment(self.session_id, self.track, index))
        self.next_index = index + 1
        if self.on_flush is not None:
            await self.on_flush(self.track, self.next_index)
