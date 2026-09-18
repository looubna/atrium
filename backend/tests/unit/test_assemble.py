from __future__ import annotations

from app.platform.media.assemble import Playback, assemble_candidate, assemble_interviewer, pcm_duration_ms
from app.platform.media.tracks import TrackRecord, encode_segment
from app.platform.storage.paths import Track


def pcm(value: int, samples: int) -> bytes:
    return value.to_bytes(2, "little", signed=True) * samples


def test_candidate_frames_are_placed_by_time_and_duplicates_dropped() -> None:
    first = encode_segment(Track.CANDIDATE, [TrackRecord(0, 0, pcm(1, 1600)), TrackRecord(1, 200, pcm(2, 1600))])
    replay = encode_segment(Track.CANDIDATE, [TrackRecord(1, 200, pcm(9, 1600))])  # re-sent after reconnect
    audio = assemble_candidate([first, replay], max_ms=60_000)
    assert len(audio) == 9600
    assert audio[:3200] == pcm(1, 1600)
    assert audio[3200:6400] == b"\x00" * 3200  # silence for the 100-200 ms gap
    assert audio[6400:] == pcm(2, 1600)
    assert pcm_duration_ms(audio, 16_000) == 300


def test_interviewer_turns_follow_playback_and_stop_when_interrupted() -> None:
    segment = encode_segment(
        Track.INTERVIEWER,
        [TrackRecord(1, 0, pcm(3, 2400)), TrackRecord(1, 100, pcm(4, 2400)), TrackRecord(2, 0, pcm(5, 2400))],
    )
    audio = assemble_interviewer([segment], {1: Playback(start_ms=500, stop_ms=650)}, max_ms=60_000)
    assert len(audio) == 31_200
    assert audio[:24_000] == b"\x00" * 24_000
    assert audio[24_000:28_800] == pcm(3, 2400)
    assert audio[28_800:] == pcm(4, 1200)  # cut at 650 ms; turn 2 never played


def test_output_is_capped_at_max_duration() -> None:
    segment = encode_segment(Track.CANDIDATE, [TrackRecord(0, 0, pcm(1, 1600)), TrackRecord(1, 5000, pcm(1, 1600))])
    audio = assemble_candidate([segment], max_ms=50)
    assert len(audio) == 1600
