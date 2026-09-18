from __future__ import annotations

from app.platform.media.visual import FaceSecond, measure_visual, parse_face_seconds
from app.platform.transcripts.model import Segment


def seconds(count: int, *, eye: float, smile: float = 0.0, move: float = 0.0, start: int = 0) -> list[FaceSecond]:
    return [FaceSecond(t=start + i, present=1.0, eye=eye, smile=smile, move=move) for i in range(count)]


def test_body_language_measurements_and_low_eye_contact_answers() -> None:
    timeline = seconds(30, eye=0.9, smile=0.5) + seconds(30, eye=0.2, move=0.5, start=30)
    answers = [
        Segment(id="s0002", speaker="candidate", start_ms=2_000, end_ms=20_000, text=""),
        Segment(id="s0004", speaker="candidate", start_ms=35_000, end_ms=55_000, text=""),
    ]
    visual = measure_visual(timeline, answers)
    assert visual is not None
    assert (visual.eye_contact_pct, visual.smile_pct, visual.restless_pct) == (55, 50, 50)
    assert [a.segment_id for a in visual.low_eye_contact_answers] == ["s0004"]

    measured = visual.measurements()
    assert measured["comm.eye_contact"]["verdict"] == "Sometimes looks away"
    assert measured["comm.facial_expression"]["verdict"] == "Very smiley"
    assert measured["comm.composure"]["verdict"] == "Restless"
    assert visual.summary()["lowEyeContactAnswers"] == [{"segmentId": "s0004", "lookingAtCameraPercent": 20}]


def test_too_little_time_on_camera_is_not_judged() -> None:
    brief = seconds(10, eye=1.0) + [FaceSecond(t=10 + i, present=0.0, eye=0, smile=0, move=0) for i in range(60)]
    assert measure_visual(brief, []) is None


def test_stored_timeline_is_parsed_leniently() -> None:
    data = {"seconds": [{"t": 1, "present": 1, "eye": 0.5, "smile": 0, "move": 0}, {"t": "bad"}, "junk"]}
    assert parse_face_seconds(data) == [FaceSecond(1, 1.0, 0.5, 0.0, 0.0)]
    assert parse_face_seconds(None) == []


def test_in_person_panels_measure_turning_toward_the_speaker() -> None:
    timeline = [FaceSecond(t=i, present=1.0, eye=0.7, smile=0, move=0, to_speaker=1.0 if i < 30 else 0.0)
                for i in range(40)]
    visual = measure_visual(timeline, [], "in_person")
    assert visual is not None and visual.to_speaker_pct == 75
    measured = visual.measurements()["comm.eye_contact"]
    assert measured["label"] == "Looking at the interviewers"
    assert "turned toward whoever was asking 75%" in str(measured["details"])
    assert visual.summary()["setting"] == "in_person" and visual.summary()["lookingAtSpeakerPercent"] == 75
    online = measure_visual(timeline, [])
    assert online is not None and online.to_speaker_pct is None
    assert online.measurements()["comm.eye_contact"]["label"] == "Looking at the camera"
    stored = {"t": 1, "present": 1, "eye": 1, "smile": 0, "move": 0, "toSpeaker": 0.5}
    parsed = parse_face_seconds({"seconds": [stored]})
    assert parsed[0].to_speaker == 0.5
