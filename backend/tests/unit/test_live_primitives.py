from __future__ import annotations

import struct
from pathlib import Path

import pytest

from app.core.errors import NotFound
from app.platform.agents.live_gateway import TranscriptBuffer
from app.platform.agents.live_protocol import (
    ClientEnd,
    CodeSnapshot,
    PlaybackStarted,
    ProtocolError,
    parse_audio_frame,
    parse_auth,
    parse_control,
)
from app.platform.jobs.queue import RecordingQueue, TaskRequest, task_name
from app.platform.media.tracks import (
    TrackFormatError,
    TrackRecord,
    TrackWriter,
    decode_segment,
    encode_segment,
    pcm_duration_ms,
)
from app.platform.storage.objects import LocalObjectStore
from app.platform.storage.paths import StoragePaths, Track


def test_track_segment_roundtrip() -> None:
    records = [TrackRecord(1, 0, b"\x01\x00" * 800), TrackRecord(2, 50, b"\x02\x00" * 800)]
    track, rate, decoded = decode_segment(encode_segment(Track.CANDIDATE, records))
    assert track is Track.CANDIDATE
    assert rate == 16_000
    assert list(decoded) == records


def test_track_segment_rejects_corruption() -> None:
    data = encode_segment(Track.INTERVIEWER, [TrackRecord(1, 0, b"\x00\x00" * 10)])
    with pytest.raises(TrackFormatError):
        decode_segment(b"NOPE" + data[4:])
    _, _, records = decode_segment(data[:-3])
    with pytest.raises(TrackFormatError):
        list(records)


def test_pcm_duration() -> None:
    assert pcm_duration_ms(32_000, 16_000) == 1000
    assert pcm_duration_ms(48_000, 24_000) == 1000


async def test_track_writer_numbers_segments_and_never_overwrites(tmp_path: Path) -> None:
    store = LocalObjectStore("bucket", tmp_path)
    flushed: list[int] = []

    async def on_flush(_track: Track, next_index: int) -> None:
        flushed.append(next_index)

    writer = TrackWriter(store, StoragePaths("alice"), "session0001", Track.CANDIDATE, next_index=3, on_flush=on_flush)
    writer.append(1, 0, b"\x00\x00" * 1600)
    await writer.flush()
    writer.append(2, 100, b"\x00\x00" * 1600)
    await writer.flush()
    assert flushed == [4, 5]
    names = await store.list("users/alice/sessions/session0001/live/")
    assert names == [
        "users/alice/sessions/session0001/live/cand-0003.trk",
        "users/alice/sessions/session0001/live/cand-0004.trk",
    ]
    # A second writer resuming at a stale index (a reconnect racing the old connection) never
    # clobbers an existing segment: it takes the next free number and keeps going.
    stale = TrackWriter(store, StoragePaths("alice"), "session0001", Track.CANDIDATE, next_index=3)
    stale.append(9, 0, b"\x00\x00")
    await stale.flush()
    assert stale.next_index == 6
    names = await store.list("users/alice/sessions/session0001/live/")
    assert names[-1].endswith("cand-0005.trk") and len(names) == 3
    _, _, first = decode_segment(await store.read(names[0]))
    assert [r.key for r in first] == [1]


async def test_track_writer_splits_large_chunks(tmp_path: Path) -> None:
    store = LocalObjectStore("bucket", tmp_path)
    writer = TrackWriter(store, StoragePaths("alice"), "session0001", Track.INTERVIEWER)
    pcm = b"\x01\x00" * 60_000  # 120 kB, above one record's limit
    writer.append(7, 0, pcm)
    await writer.flush()
    data = await store.read("users/alice/sessions/session0001/live/ivr-0000.trk")
    _, _, records = decode_segment(data)
    recs = list(records)
    assert len(recs) == 2
    assert b"".join(r.pcm for r in recs) == pcm
    assert recs[1].position_ms == pcm_duration_ms(len(recs[0].pcm), 24_000)


async def test_local_store_blocks_traversal(tmp_path: Path) -> None:
    store = LocalObjectStore("bucket", tmp_path)
    with pytest.raises(ValueError):
        await store.write("../outside.txt", b"x", "text/plain")
    with pytest.raises(ValueError):
        await store.read("users/../../etc/passwd")


def test_storage_paths_are_scoped_and_validated() -> None:
    paths = StoragePaths("alice")
    assert paths.live_segment("session0001", Track.CANDIDATE, 12).startswith("users/alice/sessions/session0001/live/")
    with pytest.raises(NotFound):
        paths.session_prefix("../bob")
    with pytest.raises(ValueError):
        StoragePaths("../bob")
    with pytest.raises(ValueError):
        paths.session_video("session0001", "upload00001", "exe")


def test_audio_frame_parsing() -> None:
    frame = parse_audio_frame(struct.pack("<II", 7, 1234) + b"\x00\x01" * 800)
    assert (frame.seq, frame.capture_ms, len(frame.pcm)) == (7, 1234, 1600)
    header = struct.pack("<II", 1, 2)
    for bad in (b"", header, header + b"\x00", header + b"\x00" * 9000):
        with pytest.raises(ProtocolError):
            parse_audio_frame(bad)


def test_control_messages() -> None:
    assert isinstance(parse_control('{"type":"end"}'), ClientEnd)
    started = parse_control('{"type":"playback_started","turnSeq":3,"mediaMs":1500}')
    assert isinstance(started, PlaybackStarted) and started.turnSeq == 3
    snapshot = parse_control('{"type":"code_snapshot","mediaMs":10,"language":"python","text":"def f(): pass"}')
    assert isinstance(snapshot, CodeSnapshot)
    for bad in ('{"type":"end","extra":1}', '{"type":"shutdown"}', "not json",
                '{"type":"playback_started","turnSeq":-1,"mediaMs":0}',
                '{"type":"code_snapshot","mediaMs":1,"language":"py thon","text":""}'):
        with pytest.raises(ProtocolError):
            parse_control(bad)
    assert parse_auth('{"type":"auth","idToken":"t"}').idToken == "t"
    with pytest.raises(ProtocolError):
        parse_auth('{"type":"auth"}')


def test_transcript_buffer_prefers_finished_text() -> None:
    buf = TranscriptBuffer()
    buf.add("I led ", False, 100)
    buf.add("the migration", False, 900)
    buf.add("I led the migration.", True, 1200)
    assert buf.take() == ("I led the migration.", 100)
    assert buf.take() == ("", None)


async def test_task_names_and_recording_queue_dedupe() -> None:
    name = task_name("sess-abc", "run/1", "prepare", "1")
    assert "/" not in name and len(name.split("-", 1)[0]) == 4
    queue = RecordingQueue()
    request = TaskRequest(queue="processing", path="/internal/tasks/x", payload={}, name=name)
    assert await queue.enqueue(request) is True
    assert await queue.enqueue(request) is False


def test_the_opening_can_be_held_until_the_candidate_sits_down() -> None:
    from app.platform.agents.live_protocol import Begin, parse_auth, parse_control

    held = parse_auth('{"type": "auth", "idToken": "t", "holdOpening": true}')
    assert held.holdOpening is True
    # Clients that don't ask get the interviewer straight away, as before.
    assert parse_auth('{"type": "auth", "idToken": "t"}').holdOpening is False
    assert isinstance(parse_control('{"type": "begin"}'), Begin)
