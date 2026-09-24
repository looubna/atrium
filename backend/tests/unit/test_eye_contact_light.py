from __future__ import annotations

from app.platform.feedback.schemas import Category, CompetencyScore, Confidence
from app.platform.media.visual import FaceSecond, honest_visual_scores, measure_visual


def _seconds(n: int, *, present: float, eye: float, clear: float | None) -> list[FaceSecond]:
    return [FaceSecond(t, present, eye, 0.1, 0.0, clear=clear) for t in range(n)]


def _eye_score(score: int = 72) -> CompetencyScore:
    return CompetencyScore(
        competencyId="comm.eye_contact", category=Category.COMMUNICATION, score=score, confidence=Confidence.HIGH,
        rationale="", measured="You looked at the camera most of the time.", meaning="Good.",
        toReach100=["Keep it up."],
    )


def test_a_dark_room_is_not_good_eye_contact() -> None:
    # The face is found now and then in the dark, and its eyes "look at the camera" when they can't be read.
    dark = _seconds(40, present=1.0, eye=0.0, clear=0.1) + _seconds(25, present=1.0, eye=0.9, clear=0.9)
    visual = measure_visual(dark, [])
    assert visual is not None and not visual.eye_measured() and visual.too_dark_pct == 62
    assert visual.measurements()["comm.eye_contact"]["verdict"] == "Not measurable"
    (score,) = honest_visual_scores([_eye_score()], visual)
    assert score.score <= 40 and score.confidence is Confidence.LOW and "too dark" in score.measured
    assert score.toReach100[0].startswith("Sit facing a window or a lamp")


def test_a_face_out_of_frame_counts_as_no_eye_contact() -> None:
    # Lit room: 30 seconds looking at the camera, 30 seconds with no face in the frame at all.
    seconds = _seconds(30, present=1.0, eye=1.0, clear=1.0) + _seconds(30, present=0.0, eye=0.0, clear=1.0)
    visual = measure_visual(seconds, [])
    assert visual is not None and visual.eye_contact_pct == 50  # not 100: the missing half is not dropped
    assert not visual.eye_measured()  # half the time out of view is not enough to judge


def test_a_well_lit_session_is_measured_as_before() -> None:
    seconds = _seconds(60, present=1.0, eye=0.8, clear=1.0)
    visual = measure_visual(seconds, [])
    assert visual is not None and visual.eye_measured() and visual.eye_contact_pct == 80
    (score,) = honest_visual_scores([_eye_score()], visual)
    assert score.score == 72 and score.confidence is Confidence.HIGH
    # Recordings from before brightness was measured are judged on the face alone.
    old = measure_visual(_seconds(60, present=1.0, eye=0.8, clear=None), [])
    assert old is not None and old.eye_measured() and old.too_dark_pct is None
