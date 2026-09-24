from __future__ import annotations

from app.platform.feedback.schemas import CompetencyScore
from app.platform.media.visual import FaceSecond, honest_visual_scores, measure_visual, parse_face_seconds


def _seconds(n: int = 60, **body: float) -> list[FaceSecond]:
    return [FaceSecond(t, 1.0, 0.9, 0.0, 0.0, None, **body) for t in range(n)]


def _composure(score: int = 82) -> CompetencyScore:
    return CompetencyScore(
        competencyId="comm.composure", category="communication", score=score, confidence="high",
        rationale="Calm.", measured="1% restless head movement", toReach100=["Keep it up."],
    )


def test_hands_on_the_head_cap_composure_and_say_why() -> None:
    # The report that prompted this: "Calm", 82, for someone holding their head all interview.
    visual = measure_visual(_seconds(body=1.0, hands=1.0, hands_face=1.0, full=0.0), [])
    assert visual is not None and visual.hands_at_face_pct == 100

    [score] = honest_visual_scores([_composure()], visual)

    assert score.score <= 30
    assert "hands were at your head or face 100%" in score.measured
    assert "Rest your hands" in score.toReach100[0]
    assert visual.measurements()["comm.composure"]["label"] == "Hands at your head or face"


def test_a_body_the_camera_never_showed_is_not_judged_with_confidence() -> None:
    visual = measure_visual(_seconds(body=0.0, hands=0.0, hands_face=0.0, full=0.0), [])
    assert visual is not None and visual.body_seen() is False

    [score] = honest_visual_scores([_composure()], visual)

    assert score.confidence == "low" and score.score <= 60
    assert "shoulders visible 0%" in score.measured
    assert "Sit back" in score.toReach100[0]


def test_a_well_framed_calm_candidate_keeps_their_score() -> None:
    visual = measure_visual(_seconds(body=1.0, hands=1.0, hands_face=0.0, full=0.0), [])

    [score] = honest_visual_scores([_composure(88)], visual)

    assert score.score == 88 and score.confidence == "high"


def test_older_recordings_without_body_tracking_are_left_alone() -> None:
    visual = measure_visual(_seconds(), [])
    assert visual is not None and visual.body_visible_pct is None and visual.body_seen() is None

    [score] = honest_visual_scores([_composure()], visual)

    assert score.score == 82
    assert visual.summary()["bodyLanguageVisible"] is None


def test_body_fields_are_read_from_what_the_app_uploads() -> None:
    [second] = parse_face_seconds(
        {"seconds": [{"t": 3, "present": 1, "eye": 0.5, "smile": 0, "move": 0, "body": 1, "hands": 0.5,
                      "handsFace": 0.25, "full": 0}]}
    )

    assert (second.body, second.hands, second.hands_face, second.full) == (1.0, 0.5, 0.25, 0.0)


def test_other_scores_are_untouched() -> None:
    visual = measure_visual(_seconds(body=0.0, hands=0.0, hands_face=1.0, full=0.0), [])
    eye = _composure().model_copy(update={"competencyId": "comm.eye_contact"})

    assert honest_visual_scores([eye], visual) == [eye]
