"""Body-language checks on synthetic timelines: each finds its pattern, and leaves normal behaviour alone."""

from __future__ import annotations

import math
from dataclasses import replace
from typing import Any

from app.platform.media.body import CHECKS, BodySecond, analyse_body, parse_body_seconds
from app.platform.media.body_exercises import EXERCISE_FOR_CHECK, EXERCISES
from app.platform.transcripts.model import Segment

HZ = 4


def still(count: int, start: int = 0, **overrides: Any) -> list[BodySecond]:
    """A person sitting still, looking at the camera, shoulders and hands in frame."""
    base = BodySecond(
        t=0, present=1.0, eye=0.9, clear=1.0, body=1.0, hands=1.0, full=0.0, yaw=0.0, pitch=0.0, tilt=0.0,
        shoulder_w=0.5, face_w=0.25, neck=0.8, hand_path=0.0,
        sx=(0.9,) * HZ, lw=((0.3, 1.0),) * HZ, rw=((-0.3, 1.0),) * HZ,
    )
    return [replace(base, t=start + i, **overrides) for i in range(count)]


def answer(start_s: int, end_s: int, sid: str = "s1") -> Segment:
    return Segment(id=sid, speaker="candidate", start_ms=start_s * 1000, end_ms=end_s * 1000, text="")


def findings(report: Any, check: str) -> list[Any]:
    return [f for f in report.findings if f.check == check]


def test_a_still_person_gets_no_findings_and_every_check_runs() -> None:
    report = analyse_body(still(120), [answer(10, 60), answer(70, 110, "s2")], pose_hz=HZ)
    assert report.findings == []
    assert report.framing == "upper_body"
    assert all(report.checks[c]["status"] == "measured" for c in CHECKS)
    assert report.metrics["tiltPct"] == 0


def test_shoulder_tilt_held_long_enough_is_found_and_brief_shifts_are_not() -> None:
    timeline = (
        still(40) + still(15, start=40, tilt=12.0) + still(20, start=55)
        + still(5, start=75, tilt=12.0) + still(20, start=80)
    )
    report = analyse_body(timeline, [], pose_hz=HZ)
    tilt = findings(report, "posture_tilt")
    assert [(f.start_ms, f.end_ms) for f in tilt] == [(40_000, 55_000)]
    assert tilt[0].kind == "measured"
    assert "left shoulder lower" in tilt[0].observation
    assert tilt[0].exercise_id == "level-shoulders"


def test_baseline_is_the_person_not_an_ideal() -> None:
    # Someone who sits slightly tilted all along is not told about it.
    report = analyse_body(still(100, tilt=-10.0), [], pose_hz=HZ)
    assert findings(report, "posture_tilt") == []


def test_turning_away_while_speaking_is_a_heuristic_finding_but_not_on_a_panel() -> None:
    timeline = still(40) + still(20, start=40, shoulder_w=0.3) + still(30, start=60)
    speaking = [answer(40, 60)]
    report = analyse_body(timeline, speaking, pose_hz=HZ)
    turned = findings(report, "turned_away")
    assert len(turned) == 1 and turned[0].kind == "heuristic"
    assert turned[0].confidence != "high"

    panel = analyse_body(timeline, speaking, pose_hz=HZ, setting="in_person")
    assert findings(panel, "turned_away") == []
    assert panel.checks["turned_away"]["status"] == "unsupported"


def test_moving_further_from_the_camera_is_not_turning_away() -> None:
    # Shoulders and face both shrink: the ratio holds.
    timeline = still(40) + still(30, start=40, shoulder_w=0.3, face_w=0.15)
    assert findings(analyse_body(timeline, [answer(40, 70)], pose_hz=HZ), "turned_away") == []


def test_head_lower_than_at_the_start() -> None:
    timeline = still(40) + still(20, start=40, neck=0.5) + still(20, start=60)
    report = analyse_body(timeline, [], pose_hz=HZ)
    assert [f.start_ms for f in findings(report, "head_lower")] == [40_000]


def wave(count: int, start: int, period_s: float, amplitude: float, what: str) -> list[BodySecond]:
    rows = []
    for i in range(count):
        t = start + i
        phase = [2 * math.pi * (t + k / HZ) / period_s for k in range(HZ)]
        if what == "wrist":
            rows.append(replace(still(1, start=t)[0], lw=tuple((0.3, 1.0 + amplitude * math.sin(p)) for p in phase),
                                hand_path=0.5))
        else:
            rows.append(replace(still(1, start=t)[0], sx=tuple(0.9 + amplitude * math.sin(p) for p in phase)))
    return rows


def test_the_same_gesture_over_and_over_while_speaking() -> None:
    timeline = still(30) + wave(30, 30, period_s=2.0, amplitude=0.3, what="wrist") + still(30, start=60)
    report = analyse_body(timeline, [answer(25, 65)], pose_hz=HZ)
    found = findings(report, "repeated_gesture")
    assert len(found) == 1
    assert 30_000 <= found[0].start_ms <= 34_000
    assert abs(found[0].measurements["periodS"] - 2.0) <= 0.25


def test_repeated_movement_while_not_speaking_is_not_a_repeated_gesture() -> None:
    timeline = still(30) + wave(30, 30, period_s=2.0, amplitude=0.3, what="wrist")
    assert findings(analyse_body(timeline, [answer(0, 25)], pose_hz=HZ), "repeated_gesture") == []


def test_steady_side_to_side_sway_is_found() -> None:
    timeline = still(40) + wave(30, 40, period_s=3.0, amplitude=0.1, what="torso") + still(30, start=70)
    report = analyse_body(timeline, [], pose_hz=HZ)
    found = findings(report, "sway")
    assert len(found) == 1 and found[0].kind == "heuristic"
    assert abs(found[0].measurements["periodS"] - 3.0) <= 0.5


def test_one_deliberate_step_is_not_sway() -> None:
    step = still(40) + still(60, start=40, sx=(1.4,) * HZ)
    assert findings(analyse_body(step, [], pose_hz=HZ), "sway") == []


def test_hand_movement_mostly_while_listening() -> None:
    listening = still(40, hand_path=0.6)
    speaking = still(40, start=40, hand_path=0.0)
    report = analyse_body(listening + speaking, [answer(40, 79)], pose_hz=HZ)
    found = findings(report, "gesture_timing")
    assert len(found) == 1
    assert found[0].measurements["listeningShare"] == 1.0
    assert report.metrics["gestureSpeakingPct"] == 0


def test_gesturing_while_speaking_is_never_flagged_and_still_hands_are_fine() -> None:
    moving = still(40) + still(40, start=40, hand_path=0.6)
    assert findings(analyse_body(moving, [answer(40, 79)], pose_hz=HZ), "gesture_timing") == []
    assert findings(analyse_body(still(80), [answer(40, 79)], pose_hz=HZ), "gesture_timing") == []


def test_looking_away_mid_answer_but_not_while_starting_to_think() -> None:
    timeline = (
        still(10) + still(3, start=10, eye=0.0) + still(10, start=13)
        + still(8, start=23, eye=0.0, yaw=20.0) + still(30, start=31)
    )
    report = analyse_body(timeline, [answer(10, 60)], pose_hz=HZ)
    found = findings(report, "look_away")
    assert [f.start_ms for f in found] == [23_000]
    assert "turned to your left" in found[0].observation


def test_dark_seconds_say_nothing_about_gaze() -> None:
    timeline = still(60, eye=0.0, clear=0.1)
    report = analyse_body(timeline, [answer(0, 59)], pose_hz=HZ)
    assert report.checks["look_away"]["status"] == "unsupported"


def test_face_only_framing_marks_body_checks_unsupported() -> None:
    report = analyse_body(still(80, body=0.0, hands=0.0), [answer(0, 79)], pose_hz=HZ)
    assert report.framing == "face_only"
    assert report.checks["sway"] == {
        "status": "unsupported", "reason": "Only your face was in frame, so posture and hands could not be seen.",
    }
    assert report.checks["look_away"]["status"] == "measured"


def test_an_older_timeline_without_body_numbers() -> None:
    data = {"seconds": [{"t": i, "present": 1, "eye": 0.9, "smile": 0, "move": 0} for i in range(60)]}
    seconds, hz = parse_body_seconds(data)
    report = analyse_body(seconds, [answer(0, 59)], pose_hz=hz)
    assert hz == 2
    assert report.checks["sway"]["reason"] == "Body tracking did not run on this device."
    assert report.findings == []


def test_parsing_is_lenient() -> None:
    data = {
        "poseHz": 4,
        "seconds": [
            {"t": 0, "present": 1, "eye": 1, "shoulderW": 0.5,
             "sx": [0.1, None, "x", 0.2], "lw": [[0.1, 0.2], None, [1], "x"]},
            {"t": "bad"}, "junk", {"t": 1, "present": float("nan"), "eye": 1},
        ],
    }
    seconds, hz = parse_body_seconds(data)
    assert hz == 4 and len(seconds) == 1
    assert seconds[0].sx == (0.1, None, None, 0.2)
    assert seconds[0].lw == ((0.1, 0.2), None, None, None)
    assert parse_body_seconds(None) == ([], 2)


def test_report_shape_and_summary_hold_numbers_only() -> None:
    report = analyse_body(still(40) + still(15, start=40, tilt=12.0), [], pose_hz=HZ, scenario="interview")
    data = report.to_dict()
    assert data["version"] == 1 and set(data["checks"]) == set(CHECKS)
    finding = data["findings"][0]
    assert finding["scenario"] == "interview" and finding["exerciseId"] in EXERCISES
    assert set(report.summary()) == {"version", "framing", "trackedSeconds", "findingCount", "metrics"}


def test_every_check_has_an_exercise() -> None:
    assert set(EXERCISE_FOR_CHECK) == set(CHECKS)
    assert all(e in EXERCISES for e in EXERCISE_FOR_CHECK.values())


def test_tracker_jitter_and_a_slow_lean_are_not_sway_or_gestures() -> None:
    import random

    rng = random.Random(7)  # noqa: S311 - test noise, not security
    jitter = [
        replace(s, sx=tuple(0.9 + rng.gauss(0, 0.01) for _ in range(HZ)),
                lw=tuple((0.3 + rng.gauss(0, 0.02), 1.0 + rng.gauss(0, 0.02)) for _ in range(HZ)))
        for s in still(120)
    ]
    lean = [replace(s, sx=tuple(0.9 + 0.004 * (s.t + k / HZ) for k in range(HZ))) for s in still(120)]
    for timeline in (jitter, lean):
        report = analyse_body(timeline, [answer(0, 119)], pose_hz=HZ)
        assert findings(report, "sway") == [] and findings(report, "repeated_gesture") == []


def test_two_samples_a_second_still_finds_a_slow_sway() -> None:
    rows = [
        replace(s, sx=tuple(0.9 + 0.1 * math.sin(2 * math.pi * (s.t + k / 2) / 4.0) for k in range(2)),
                lw=((0.3, 1.0),) * 2, rw=((-0.3, 1.0),) * 2)
        for s in still(60)
    ]
    report = analyse_body(still(40, sx=(0.9,) * 2, lw=((0.3, 1.0),) * 2, rw=((-0.3, 1.0),) * 2)
                          + [replace(r, t=r.t + 40) for r in rows], [], pose_hz=2)
    assert len(findings(report, "sway")) == 1


def test_a_moving_camera_is_not_sway_and_says_why() -> None:
    # A handheld phone: the whole picture, background included, moves side to side.
    moving = [replace(r, cam_move=1.0) for r in wave(60, 40, period_s=3.0, amplitude=0.1, what="torso")]
    report = analyse_body([replace(s, cam_move=1.0) for s in still(40)] + moving, [], pose_hz=HZ)
    assert findings(report, "sway") == []
    assert report.checks["sway"]["reason"] == "The camera was moving (held in a hand?), so this could not be measured."
    # Positions relative to the body still count.
    assert report.checks["head_lower"]["status"] == "measured"


def test_pauses_inside_an_answer_do_not_restart_the_thinking_allowance() -> None:
    timeline = still(20) + still(10, start=20, eye=0.0, yaw=30.0) + still(30, start=30)
    pieces = [answer(10, 21, "a"), answer(22, 24, "b"), answer(25, 27, "c"), answer(28, 50, "d")]
    found = findings(analyse_body(timeline, pieces, pose_hz=HZ), "look_away")
    assert [(f.start_ms, f.end_ms) for f in found] == [(20_000, 30_000)]
