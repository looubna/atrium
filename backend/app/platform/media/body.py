"""Body-language findings from the per-second numbers the device records (face metrics, version 3).

The device runs the face and pose trackers and sends, for each second, a few numbers: head angles,
the shoulder line's tilt, shoulder and face width, how high the head sits above the shoulders,
and, at the pose rate, the shoulder midpoint and both wrists relative to it. Nothing here sees an
image. This module turns that timeline into timestamped findings:

- measured: a geometric fact (the shoulder line tilted 11° for 14 s; looked away for 8 s while
  answering; most hand movement came while the other person was speaking);
- heuristic: a pattern read from those facts (turned away, head lower, repeated gesture, sway).

Every check is judged against the person's own first seconds, not a universal ideal; needs a
minimum duration; and reports itself unsupported, with the reason, when the camera did not show
enough. Nothing here infers confidence, nerves, honesty or emotion. The thresholds are starting
values to calibrate against annotated recordings, not validated figures.

The findings are deterministic: a model may read them as context but never writes or changes them.
"""

from __future__ import annotations

import math
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from typing import Any, Literal

import numpy as np
from numpy.typing import NDArray

from app.platform.media.body_exercises import EXERCISE_FOR_CHECK
from app.platform.transcripts.model import Segment

REPORT_VERSION = 1

Check = Literal["posture_tilt", "turned_away", "head_lower", "repeated_gesture", "gesture_timing", "look_away", "sway"]
CHECKS: tuple[Check, ...] = (
    "posture_tilt", "turned_away", "head_lower", "repeated_gesture", "gesture_timing", "look_away", "sway",
)
Framing = Literal["none", "face_only", "upper_body", "full_body"]
Confidence = Literal["high", "medium", "low"]
Setting = Literal["online", "in_person"]

#: A second counts when at least this share of its samples saw the thing (as in `visual.py`).
SEEN = 0.5
#: ... and when at least this share of it was bright enough to judge.
CLEAR = 0.5
#: The person's own reference: the first tracked seconds of the session.
BASELINE_SECONDS = 20
#: Posture checks need the baseline and at least as long again to compare it with.
MIN_TRACKED_SECONDS = 40
#: Gaps of up to this many seconds (a missed sample, a passing hand) don't break an episode.
MAX_GAP_S = 2
MAX_FINDINGS_PER_CHECK = 5

TILT_DEGREES = 8.0
TILT_MIN_S = 10
#: Shoulder width relative to face width: turning the torso narrows the shoulders, not the face.
TURNED_RATIO = 0.75
TURNED_MIN_S = 8
HEAD_LOWER_RATIO = 0.8
HEAD_LOWER_MIN_S = 15

#: Looking away while speaking, after the first seconds of an answer (looking away to think is normal).
LOOK_AWAY_EYE = 0.3
LOOK_AWAY_MIN_S = 5
THINKING_GRACE_S = 3
LOOK_AWAY_YAW = 10.0
MIN_JUDGED_SPEAKING_S = 20

#: A second with hand movement: both wrists' path, in shoulder widths.
MOVING_PATH = 0.3
HANDS_SEEN_PCT = 50
LISTENING_SHARE = 0.6
LISTENING_MIN_S = 20

#: Oscillation analysis, on the pose-rate series.
WINDOW_STEP_S = 2
FILLED = 0.8
GESTURE_WINDOW_S = 10
GESTURE_PERIOD_S = (1.0, 4.0)
GESTURE_AMPLITUDE = 0.08
GESTURE_CORRELATION = 0.6
GESTURE_SPEAKING = 0.7
SWAY_WINDOW_S = 12
SWAY_PERIOD_S = (1.0, 6.0)
SWAY_AMPLITUDE = (0.15, 1.5)
SWAY_CORRELATION = 0.5

Point = tuple[float, float]


@dataclass(frozen=True)
class BodySecond:
    t: int
    present: float
    eye: float
    clear: float | None = None
    body: float | None = None
    hands: float | None = None
    full: float | None = None
    yaw: float | None = None
    pitch: float | None = None
    tilt: float | None = None
    shoulder_w: float | None = None
    face_w: float | None = None
    neck: float | None = None
    hand_path: float | None = None
    #: Share of the second in which the background moved: the camera itself was moving (held in a hand).
    cam_move: float | None = None
    #: At the pose rate: shoulder midpoint x (image-height units) and wrists relative to it (shoulder widths).
    sx: tuple[float | None, ...] = ()
    lw: tuple[Point | None, ...] = ()
    rw: tuple[Point | None, ...] = ()


@dataclass(frozen=True)
class BodyFinding:
    id: str
    check: Check
    kind: Literal["measured", "heuristic"]
    start_ms: int
    end_ms: int
    observation: str
    measurements: dict[str, float]
    confidence: Confidence
    exercise_id: str
    scenario: str
    #: The AI's look at this moment of the video (`body_review.py`): verdict, what it saw, how to fix it.
    #: None when there was no video to review. It never changes the measurement above.
    review: dict[str, str] | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id, "check": self.check, "kind": self.kind, "startMs": self.start_ms, "endMs": self.end_ms,
            "observation": self.observation, "measurements": self.measurements, "confidence": self.confidence,
            "exerciseId": self.exercise_id, "scenario": self.scenario,
            **({"review": self.review} if self.review is not None else {}),
        }

    def shown(self) -> bool:
        """Whether to show it: an AI review that could not see the behaviour in the video withdraws it."""
        return (self.review or {}).get("verdict") != "not_seen"


@dataclass
class BodyReport:
    framing: Framing
    tracked_seconds: int
    body_visible_pct: int
    hands_visible_pct: int
    clear_pct: int
    pose_hz: int
    checks: dict[str, dict[str, str]] = field(default_factory=dict)
    metrics: dict[str, float] = field(default_factory=dict)
    findings: list[BodyFinding] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "version": REPORT_VERSION,
            "quality": {
                "trackedSeconds": self.tracked_seconds, "bodyVisiblePct": self.body_visible_pct,
                "handsVisiblePct": self.hands_visible_pct, "clearPct": self.clear_pct, "framing": self.framing,
                "poseHz": self.pose_hz,
            },
            "checks": self.checks,
            "metrics": self.metrics,
            "findings": [f.to_dict() for f in self.findings],
        }

    def summary(self) -> dict[str, Any]:
        """What the session document and the progress history keep: numbers only, no text."""
        return {"version": REPORT_VERSION, "framing": self.framing, "trackedSeconds": self.tracked_seconds,
                "findingCount": sum(1 for f in self.findings if f.shown()), "metrics": self.metrics}


# -- parsing ----------------------------------------------------------------------


def _num(item: dict[str, Any], key: str) -> float | None:
    value = item.get(key)
    if isinstance(value, bool) or not isinstance(value, int | float) or not math.isfinite(value):
        return None
    return float(value)


def _nums(value: Any) -> tuple[float | None, ...]:
    if not isinstance(value, list):
        return ()
    return tuple(float(v) if isinstance(v, int | float) and not isinstance(v, bool) and math.isfinite(v) else None
                 for v in value)


def _points(value: Any) -> tuple[Point | None, ...]:
    if not isinstance(value, list):
        return ()
    out: list[Point | None] = []
    for v in value:
        pair = _nums(v)
        out.append((pair[0], pair[1]) if len(pair) == 2 and pair[0] is not None and pair[1] is not None else None)
    return tuple(out)


def parse_body_seconds(data: Any) -> tuple[list[BodySecond], int]:
    """The stored face-metrics timeline as body seconds, and its pose rate. Lenient, like `parse_face_seconds`."""
    items = data.get("seconds") if isinstance(data, dict) else None
    hz = data.get("poseHz") if isinstance(data, dict) else None
    pose_hz = hz if isinstance(hz, int) and not isinstance(hz, bool) and 1 <= hz <= 8 else 2
    out: list[BodySecond] = []
    for item in items if isinstance(items, list) else []:
        if not isinstance(item, dict):
            continue
        t, present, eye = item.get("t"), _num(item, "present"), _num(item, "eye")
        if not isinstance(t, int) or isinstance(t, bool) or present is None or eye is None:
            continue
        out.append(BodySecond(
            t=t, present=present, eye=eye, clear=_num(item, "clear"), body=_num(item, "body"),
            hands=_num(item, "hands"), full=_num(item, "full"), yaw=_num(item, "yaw"), pitch=_num(item, "pitch"),
            tilt=_num(item, "tilt"), shoulder_w=_num(item, "shoulderW"), face_w=_num(item, "faceW"),
            neck=_num(item, "neck"), hand_path=_num(item, "handPath"), cam_move=_num(item, "camMove"),
            sx=_nums(item.get("sx")), lw=_points(item.get("lw")), rw=_points(item.get("rw")),
        ))
    out.sort(key=lambda s: s.t)
    return out, pose_hz


# -- helpers ------------------------------------------------------------------------


def _clear(s: BodySecond) -> bool:
    return s.clear is None or s.clear >= CLEAR


def _pose_ok(s: BodySecond) -> bool:
    """The shoulders were seen this second, in light good enough to trust the landmarks."""
    return s.body is not None and s.body >= SEEN and bool(s.shoulder_w) and _clear(s)


def _steady(s: BodySecond) -> bool:
    """The camera stood still this second. A moving camera moves the whole picture, which reads as the
    body swaying or tilting; positions relative to the body (wrists, head height) are not affected."""
    return s.cam_move is None or s.cam_move < SEEN


def _face_ok(s: BodySecond) -> bool:
    return s.present >= SEEN and _clear(s)


def _pct(part: int, whole: int) -> int:
    return round(100 * part / whole) if whole else 0


def _episodes(flagged: Iterable[int], min_s: int, max_gap: int = MAX_GAP_S) -> list[tuple[int, int]]:
    """Runs of flagged seconds (inclusive bounds), bridging short gaps, at least `min_s` long."""
    runs: list[tuple[int, int]] = []
    for t in sorted(set(flagged)):
        if runs and t - runs[-1][1] <= max_gap + 1:
            runs[-1] = (runs[-1][0], t)
        else:
            runs.append((t, t))
    return [(a, b) for a, b in runs if b - a + 1 >= min_s]


def _speaking_seconds(segments: list[Segment]) -> set[int]:
    return {t for s in segments for t in range(s.start_ms // 1000, s.end_ms // 1000 + 1)}


#: Pieces of speech closer than this are one answer: a transcript splits an answer at its pauses.
ANSWER_GAP_MS = 2_000


def _answer_starts(segments: list[Segment]) -> list[int]:
    """When each answer began, in seconds, with pauses inside an answer bridged."""
    starts: list[int] = []
    last_end: int | None = None
    for segment in sorted(segments, key=lambda s: s.start_ms):
        if last_end is None or segment.start_ms - last_end >= ANSWER_GAP_MS:
            starts.append(segment.start_ms // 1000)
        last_end = max(segment.end_ms, last_end or 0)
    return starts


def _confidence(seen_share: float, margin: float, heuristic: bool) -> Confidence:
    """How far to trust a finding: how much of it the camera saw, and how clearly it passed its threshold."""
    level: Confidence = "high" if seen_share >= 0.9 and margin >= 1.5 else "medium" if seen_share >= 0.75 else "low"
    return "medium" if heuristic and level == "high" else level


def _seen_share(by_t: dict[int, BodySecond], start: int, end: int, ok: Callable[[BodySecond], bool]) -> float:
    span = end - start + 1
    return sum(1 for t in range(start, end + 1) if t in by_t and ok(by_t[t])) / span


def _baseline(values: list[float]) -> float | None:
    return float(np.median(values[:BASELINE_SECONDS])) if len(values) >= BASELINE_SECONDS else None


def _longest(runs: list[tuple[int, int]]) -> list[tuple[int, int]]:
    return sorted(sorted(runs, key=lambda r: r[0] - r[1])[:MAX_FINDINGS_PER_CHECK])


def _side(degrees: float, positive: str, negative: str) -> str:
    return positive if degrees > 0 else negative


def _clock(t: int) -> str:
    return f"{t // 60}:{t % 60:02d}"


# -- oscillation ------------------------------------------------------------------------


def _series(seconds: list[BodySecond], hz: int, pick: Callable[[BodySecond], tuple[Any, ...]]) -> dict[int, list[Any]]:
    """Per-second sample lists at the pose rate; a second with the wrong sample count is left out."""
    return {s.t: list(values) for s in seconds if len(values := pick(s)) == hz}


def _window(series: dict[int, list[Any]], start: int, length: int, hz: int) -> list[Any] | None:
    samples: list[Any] = []
    for t in range(start, start + length):
        samples.extend(series.get(t, [None] * hz))
    present = sum(1 for v in samples if v is not None)
    return samples if present >= FILLED * len(samples) else None


def _filled(values: list[float | None]) -> NDArray[np.float64]:
    """Missing samples linearly interpolated, then the linear trend removed (slow drift is not oscillation)."""
    x = np.array([np.nan if v is None else v for v in values], dtype=np.float64)
    idx = np.arange(len(x))
    ok = ~np.isnan(x)
    x = np.interp(idx, idx[ok], x[ok])
    slope, intercept = np.polyfit(idx, x, 1)
    return np.asarray(x - (slope * idx + intercept), dtype=np.float64)


def _lag_correlation(x: NDArray[np.float64], lag: int) -> float:
    a, b = x[:-lag], x[lag:]
    if lag <= 0 or a.std() < 1e-9 or b.std() < 1e-9:
        return 0.0
    return float(np.corrcoef(a, b)[0, 1])


#: Half a period later, a real back-and-forth is on the other side: it correlates negatively.
ANTI_PHASE = -0.3


def _periodicity(
    x: NDArray[np.float64], hz: int, period_s: tuple[float, float], min_cycles: int
) -> tuple[float, float]:
    """The strongest back-and-forth repeat in the window: (correlation one period later, period in seconds).

    A step, a slow lean or one big move also correlates with itself at every lag, so a repeat counts
    only when the signal is on the other side half a period later and crosses its mean often enough
    for `min_cycles` full cycles. Otherwise (0, 0).
    """
    best, best_lag = 0.0, 0
    low = max(2, math.ceil(period_s[0] * hz))
    high = min(int(period_s[1] * hz), len(x) // 2)
    crossings = int(np.count_nonzero(np.diff(np.signbit(x - x.mean()))))
    for lag in range(low, high + 1):
        r = _lag_correlation(x, lag)
        if r > best and _lag_correlation(x, lag // 2) < ANTI_PHASE:
            best, best_lag = r, lag
    if not best_lag or crossings < 2 * min_cycles:
        return 0.0, 0.0
    return best, best_lag / hz


def _active_seconds(x: NDArray[np.float64], start: int, hz: int, threshold: float) -> list[int]:
    """The seconds of a window in which the signal actually moved away from its centre."""
    return [start + i for i in range(len(x) // hz) if float(np.abs(x[i * hz:(i + 1) * hz]).max()) >= threshold]


def _medians(hits: list[tuple[int, float, float]], start: int, end: int) -> tuple[float, float]:
    """Median period and amplitude of the windows that started inside an episode."""
    inside = [(period, amplitude) for t, period, amplitude in hits if start <= t <= end] or [(0.0, 0.0)]
    return float(np.median([p for p, _ in inside])), float(np.median([a for _, a in inside]))


# -- the checks ----------------------------------------------------------------------------


class _Analysis:
    def __init__(self, seconds: list[BodySecond], segments: list[Segment], hz: int, setting: Setting, scenario: str):
        self.seconds, self.hz, self.setting, self.scenario = seconds, hz, setting, scenario
        self.by_t = {s.t: s for s in seconds}
        self.speaking = _speaking_seconds(segments)
        self.segments = segments
        self.seen = [s for s in seconds if _pose_ok(s)]
        # Tilt and sway are read from the body's place in the picture, so only while the camera was still.
        # Everything else is measured relative to the body itself, which a moving camera does not change.
        self.posed = [s for s in self.seen if _steady(s)]
        self.findings: list[BodyFinding] = []
        self.checks: dict[str, dict[str, str]] = {}
        self.metrics: dict[str, float] = {}

    def add(self, check: Check, kind: Literal["measured", "heuristic"], start: int, end: int, observation: str,
            measurements: dict[str, float], confidence: Confidence) -> None:
        self.findings.append(BodyFinding(
            id=f"{check}-{start}", check=check, kind=kind, start_ms=start * 1000, end_ms=(end + 1) * 1000,
            observation=observation, measurements=measurements, confidence=confidence,
            exercise_id=EXERCISE_FOR_CHECK[check], scenario=self.scenario,
        ))

    def still_reason(self, otherwise: str) -> str:
        """Why a check that needs a still camera could not run."""
        if len(self.seen) >= MIN_TRACKED_SECONDS and len(self.posed) < MIN_TRACKED_SECONDS:
            return "The camera was moving (held in a hand?), so this could not be measured."
        return otherwise

    def unsupported(self, check: Check, reason: str) -> None:
        self.checks[check] = {"status": "unsupported", "reason": reason}

    def measured(self, check: Check) -> None:
        self.checks[check] = {"status": "measured"}

    def share_of_tracked(self, runs: list[tuple[int, int]], steady_only: bool = False) -> float:
        inside = {t for a, b in runs for t in range(a, b + 1)}
        rows = self.posed if steady_only else self.seen
        return float(_pct(sum(1 for s in rows if s.t in inside), len(rows)))

    # 1a ----
    def tilt(self) -> None:
        rows = [s for s in self.posed if s.tilt is not None]
        base = _baseline([s.tilt for s in rows if s.tilt is not None])
        if base is None or len(rows) < MIN_TRACKED_SECONDS:
            reason = self.still_reason("Your shoulders were not in frame long enough to compare.")
            return self.unsupported("posture_tilt", reason)
        self.measured("posture_tilt")
        flagged = [s.t for s in rows if s.tilt is not None and abs(s.tilt - base) > TILT_DEGREES]
        runs = _episodes(flagged, TILT_MIN_S)
        self.metrics["tiltPct"] = self.share_of_tracked(runs, steady_only=True)
        for a, b in _longest(runs):
            values = [self.by_t[t].tilt for t in range(a, b + 1) if t in self.by_t and self.by_t[t].tilt is not None]
            mean = float(np.mean([v for v in values if v is not None]))
            delta = mean - base
            self.add(
                "posture_tilt", "measured", a, b,
                f"From {_clock(a)}, for {b - a + 1} seconds, your shoulder line tilted about {abs(delta):.0f}° "
                f"further than at the start, your {_side(delta, 'left', 'right')} shoulder lower.",
                {"tiltDeg": round(mean, 1), "baselineDeg": round(base, 1), "seconds": b - a + 1},
                _confidence(_seen_share(self.by_t, a, b, _pose_ok), abs(delta) / TILT_DEGREES, heuristic=False),
            )
        return None

    # 1b ----
    def turned(self) -> None:
        if self.setting == "in_person":
            # Turning toward whoever is speaking on a panel is what a candidate should do.
            return self.unsupported("turned_away", "In a panel, turning toward whoever speaks is expected.")
        rows = [s for s in self.seen if s.face_w and s.shoulder_w and s.present >= SEEN]
        ratios = [s.shoulder_w / s.face_w for s in rows if s.shoulder_w and s.face_w]
        base = _baseline(ratios)
        if base is None or len(rows) < MIN_TRACKED_SECONDS:
            return self.unsupported("turned_away", "Your face and shoulders were not in frame together long enough.")
        self.measured("turned_away")
        flagged = [s.t for s, r in zip(rows, ratios, strict=True) if r < TURNED_RATIO * base and s.t in self.speaking]
        runs = _episodes(flagged, TURNED_MIN_S)
        self.metrics["turnedAwayPct"] = self.share_of_tracked(runs)
        for a, b in _longest(runs):
            inside = [r for s, r in zip(rows, ratios, strict=True) if a <= s.t <= b]
            ratio = float(np.mean(inside)) / base
            self.add(
                "turned_away", "heuristic", a, b,
                f"From {_clock(a)}, for {b - a + 1} seconds while you spoke, your shoulders looked about "
                f"{round(100 * (1 - ratio))}% narrower than at the start: your body was probably turned away "
                "from the camera.",
                {"shoulderRatio": round(ratio, 2), "seconds": b - a + 1},
                _confidence(_seen_share(self.by_t, a, b, _pose_ok), (1 - ratio) / (1 - TURNED_RATIO), heuristic=True),
            )
        return None

    # 1c ----
    def head_lower(self) -> None:
        rows = [s for s in self.seen if s.neck is not None and s.present >= SEEN]
        base = _baseline([s.neck for s in rows if s.neck is not None])
        if base is None or base <= 0.2 or len(rows) < MIN_TRACKED_SECONDS:
            return self.unsupported("head_lower", "Your head and shoulders were not in frame together long enough.")
        self.measured("head_lower")
        flagged = [s.t for s in rows if s.neck is not None and s.neck < HEAD_LOWER_RATIO * base]
        runs = _episodes(flagged, HEAD_LOWER_MIN_S)
        self.metrics["headLowerPct"] = self.share_of_tracked(runs)
        for a, b in _longest(runs):
            values = [self.by_t[t].neck for t in range(a, b + 1) if t in self.by_t and self.by_t[t].neck is not None]
            ratio = float(np.mean([v for v in values if v is not None])) / base
            self.add(
                "head_lower", "heuristic", a, b,
                f"From {_clock(a)}, for {b - a + 1} seconds, your head sat about {round(100 * (1 - ratio))}% lower "
                "above your shoulders than at the start, as happens when looking down at notes or sinking "
                "into the chair.",
                {"heightRatio": round(ratio, 2), "seconds": b - a + 1},
                _confidence(_seen_share(self.by_t, a, b, _pose_ok), (1 - ratio) / (1 - HEAD_LOWER_RATIO),
                            heuristic=True),
            )
        return None

    # 2a ----
    def repeated_gesture(self, hands_ok: bool) -> None:
        if not hands_ok:
            return self.unsupported("repeated_gesture", "Your hands were not in frame enough of the time.")
        if not self.speaking:
            return self.unsupported("repeated_gesture", "There were no answers to look at.")
        self.measured("repeated_gesture")
        length, flagged = GESTURE_WINDOW_S, set[int]()
        hits: list[tuple[int, float, float]] = []
        first = self.seconds[0].t if self.seconds else 0
        last = self.seconds[-1].t if self.seconds else -1
        pickers: tuple[Callable[[BodySecond], tuple[Any, ...]], ...] = (lambda s: s.lw, lambda s: s.rw)
        for pick in pickers:
            series = _series(self.seconds, self.hz, pick)
            for start in range(first, last - length + 2, WINDOW_STEP_S):
                span = range(start, start + length)
                if sum(1 for t in span if t in self.speaking) < GESTURE_SPEAKING * length:
                    continue
                samples = _window(series, start, length, self.hz)
                if samples is None:
                    continue
                for axis in (0, 1):
                    x = _filled([None if p is None else p[axis] for p in samples])
                    if x.std() < GESTURE_AMPLITUDE:
                        continue
                    r, period = _periodicity(
                        x, self.hz, (GESTURE_PERIOD_S[0], min(GESTURE_PERIOD_S[1], length / 3)), min_cycles=3
                    )
                    if r > GESTURE_CORRELATION:
                        flagged.update(_active_seconds(x, start, self.hz, GESTURE_AMPLITUDE))
                        hits.append((start, period, float(x.std())))
                        break
        runs = _episodes(flagged, length)
        self.metrics["repeatedGesturePct"] = self.share_of_tracked(runs)
        for a, b in _longest(runs):
            period, amplitude = _medians(hits, a, b)
            self.add(
                "repeated_gesture", "heuristic", a, b,
                f"From {_clock(a)}, for {b - a + 1} seconds while you spoke, one hand repeated the same movement "
                f"about every {period:.1f} seconds.",
                {"periodS": round(period, 1), "amplitude": round(amplitude, 2), "seconds": b - a + 1},
                _confidence(_seen_share(self.by_t, a, b, _pose_ok), 1.0, heuristic=True),
            )
        return None

    # 2b ----
    def gesture_timing(self, hands_ok: bool) -> None:
        if not hands_ok:
            return self.unsupported("gesture_timing", "Your hands were not in frame enough of the time.")
        rows = [s for s in self.seen if s.hand_path is not None and (s.hands or 0) >= SEEN]
        speaking = [s for s in rows if s.t in self.speaking]
        listening = [s for s in rows if s.t not in self.speaking]
        if len(speaking) < MIN_JUDGED_SPEAKING_S or len(listening) < MIN_JUDGED_SPEAKING_S:
            return self.unsupported("gesture_timing", "There was not enough time both speaking and listening.")
        self.measured("gesture_timing")
        moving_speaking = [s.t for s in speaking if (s.hand_path or 0) >= MOVING_PATH]
        moving_listening = [s.t for s in listening if (s.hand_path or 0) >= MOVING_PATH]
        moving = len(moving_speaking) + len(moving_listening)
        self.metrics["gestureSpeakingPct"] = float(_pct(len(moving_speaking), len(speaking)))
        self.metrics["gestureListeningPct"] = float(_pct(len(moving_listening), len(listening)))
        share = len(moving_listening) / moving if moving else 0.0
        if share <= LISTENING_SHARE or len(moving_listening) < LISTENING_MIN_S:
            return None
        runs = _episodes(moving_listening, 1) or [(moving_listening[0], moving_listening[0])]
        a, b = max(runs, key=lambda r: r[1] - r[0])
        self.add(
            "gesture_timing", "measured", a, b,
            f"{round(100 * share)}% of your hand movement came while the other person was speaking "
            f"({len(moving_listening)} seconds in all; the longest stretch starts at {_clock(a)}).",
            {"listeningShare": round(share, 2), "listeningSeconds": len(moving_listening),
             "speakingSeconds": len(moving_speaking)},
            _confidence(_seen_share(self.by_t, a, b, _pose_ok), share / LISTENING_SHARE, heuristic=False),
        )
        return None

    # 3 ----
    def look_away(self) -> None:
        grace = {t for start in _answer_starts(self.segments) for t in range(start, start + THINKING_GRACE_S)}
        judged = [s for s in self.seconds if s.t in self.speaking and s.t not in grace and _face_ok(s)]
        if len(judged) < MIN_JUDGED_SPEAKING_S:
            return self.unsupported("look_away", "Your face was not clearly visible long enough while you spoke.")
        self.measured("look_away")
        away = [s.t for s in judged if s.eye < LOOK_AWAY_EYE]
        self.metrics["lookAwaySpeakingPct"] = float(_pct(len(away), len(judged)))
        target = "the people on screen" if self.setting == "in_person" else "the camera"
        for a, b in _longest(_episodes(away, LOOK_AWAY_MIN_S, max_gap=1)):
            yaws = [self.by_t[t].yaw for t in range(a, b + 1) if t in self.by_t and self.by_t[t].yaw is not None]
            yaw = float(np.mean([y for y in yaws if y is not None])) if yaws else 0.0
            # Positive yaw turns the face toward the right of the camera image: the person's own left.
            where = f", turned to your {_side(yaw, 'left', 'right')}" if abs(yaw) >= LOOK_AWAY_YAW else ""
            eyes = [self.by_t[t].eye for t in range(a, b + 1) if t in self.by_t]
            self.add(
                "look_away", "measured", a, b,
                f"From {_clock(a)}, for {b - a + 1} seconds in the middle of an answer, you looked away from "
                f"{target}{where}.",
                {"lookingPct": round(100 * float(np.mean(eyes))), "yawDeg": round(yaw, 1), "seconds": b - a + 1},
                _confidence(_seen_share(self.by_t, a, b, _face_ok), (b - a + 1) / LOOK_AWAY_MIN_S, heuristic=False),
            )
        return None

    # 4 ----
    def sway(self) -> None:
        if len(self.posed) < MIN_TRACKED_SECONDS:
            return self.unsupported("sway", self.still_reason("Your shoulders were not in frame long enough."))
        self.measured("sway")
        series = _series(self.seconds, self.hz, lambda s: s.sx if _pose_ok(s) and _steady(s) else ())
        length, flagged = SWAY_WINDOW_S, set[int]()
        hits: list[tuple[int, float, float]] = []
        first, last = self.seconds[0].t, self.seconds[-1].t
        for start in range(first, last - length + 2, WINDOW_STEP_S):
            samples = _window(series, start, length, self.hz)
            if samples is None:
                continue
            widths = [w for t in range(start, start + length) if t in self.by_t and (w := self.by_t[t].shoulder_w)]
            if not widths:
                continue
            x = _filled(samples) / float(np.median(widths))
            # Peak to peak of a steady sway, read robustly from its spread.
            amplitude = 2 * math.sqrt(2) * float(x.std())
            if not SWAY_AMPLITUDE[0] <= amplitude <= SWAY_AMPLITUDE[1]:
                continue
            r, period = _periodicity(x, self.hz, (SWAY_PERIOD_S[0], min(SWAY_PERIOD_S[1], length / 2)), min_cycles=2)
            if r > SWAY_CORRELATION:
                flagged.update(_active_seconds(x, start, self.hz, SWAY_AMPLITUDE[0] / 2))
                hits.append((start, period, amplitude))
        runs = _episodes(flagged, length)
        self.metrics["swayPct"] = self.share_of_tracked(runs, steady_only=True)
        for a, b in _longest(runs):
            period, amplitude = _medians(hits, a, b)
            self.add(
                "sway", "heuristic", a, b,
                f"From {_clock(a)}, for {b - a + 1} seconds, your upper body moved side to side in a steady rhythm, "
                f"about every {period:.1f} seconds.",
                {"amplitude": round(amplitude, 2), "periodS": round(period, 1), "seconds": b - a + 1},
                _confidence(_seen_share(self.by_t, a, b, _pose_ok), amplitude / SWAY_AMPLITUDE[0], heuristic=True),
            )
        return None


def _framing(seconds: list[BodySecond]) -> Framing:
    tracked = [s for s in seconds if s.body is not None and s.present >= SEEN]
    if not tracked:
        return "none"
    body = sum(1 for s in tracked if (s.body or 0) >= SEEN) / len(tracked)
    full = sum(1 for s in tracked if (s.full or 0) >= SEEN) / len(tracked)
    return "face_only" if body < 0.5 else "full_body" if full >= 0.5 else "upper_body"


def analyse_body(
    seconds: list[BodySecond],
    candidate_segments: list[Segment],
    *,
    pose_hz: int = 2,
    setting: Setting = "online",
    scenario: str = "",
) -> BodyReport:
    """Timestamped body-language findings, with each check marked measured or unsupported (and why)."""
    analysis = _Analysis(seconds, candidate_segments, pose_hz, setting, scenario)
    framing = _framing(seconds)
    posed = analysis.seen
    with_body = [s for s in seconds if s.body is not None]
    hands_pct = _pct(sum(1 for s in posed if (s.hands or 0) >= SEEN), len(posed))
    report = BodyReport(
        framing=framing,
        tracked_seconds=len(posed),
        body_visible_pct=_pct(sum(1 for s in with_body if (s.body or 0) >= SEEN), len(with_body)),
        hands_visible_pct=hands_pct,
        clear_pct=_pct(sum(1 for s in seconds if _clear(s)), len(seconds)),
        pose_hz=pose_hz,
    )
    # Version 2 timelines, or a device that could not run body tracking: say so, check by check.
    has_v3 = any(s.shoulder_w is not None for s in seconds)
    body_reason = (
        "Body tracking did not run on this device." if not has_v3
        else "Only your face was in frame, so posture and hands could not be seen." if framing == "face_only"
        else None
    )
    analysis.look_away()
    if body_reason:
        for check in CHECKS:
            if check != "look_away":
                analysis.unsupported(check, body_reason)
    else:
        hands_ok = hands_pct >= HANDS_SEEN_PCT
        analysis.tilt()
        analysis.turned()
        analysis.head_lower()
        analysis.repeated_gesture(hands_ok)
        analysis.gesture_timing(hands_ok)
        analysis.sway()
    report.checks = {check: analysis.checks[check] for check in CHECKS}
    report.metrics = analysis.metrics
    report.findings = sorted(analysis.findings, key=lambda f: f.start_ms)
    return report
