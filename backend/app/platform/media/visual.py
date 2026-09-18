"""Body-language measurements from the per-second face numbers the app records on the device.

The app never uploads images for these: it sends, for each second, how often a
face was visible, looking at the camera, smiling and moving restlessly. This
module turns that timeline into whole-interview figures and flags answers where
eye contact dropped, for the evaluator and for the numbers shown next to scores.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

from app.platform.transcripts.model import Segment

PRESENT = 0.5
SMILING = 0.35
RESTLESS = 0.3
MIN_ON_CAMERA_SECONDS = 20
MIN_ANSWER_SECONDS = 4
LOW_EYE_CONTACT = 0.4


@dataclass(frozen=True)
class FaceSecond:
    t: int
    present: float
    eye: float
    smile: float
    move: float
    # In-person panels: share of the second spent turned toward whoever was speaking.
    to_speaker: float | None = None


Setting = Literal["online", "in_person"]


@dataclass(frozen=True)
class AnswerLook:
    segment_id: str
    start_ms: int
    end_ms: int
    eye_contact: float


@dataclass
class VisualMetrics:
    on_camera_seconds: int
    off_camera_pct: int
    eye_contact_pct: int
    smile_pct: int
    restless_pct: int
    low_eye_contact_answers: list[AnswerLook] = field(default_factory=list)
    setting: Setting = "online"
    #: In-person panels only: how often the candidate turned toward whoever was asking.
    to_speaker_pct: int | None = None

    def summary(self) -> dict[str, object]:
        """Model-facing summary with segment references."""
        return {
            "setting": self.setting,
            **({"lookingAtSpeakerPercent": self.to_speaker_pct} if self.to_speaker_pct is not None else {}),
            "secondsOnCamera": self.on_camera_seconds,
            "lookingAtCameraPercent": self.eye_contact_pct,
            "smilingPercent": self.smile_pct,
            "restlessMovementPercent": self.restless_pct,
            "outOfFramePercent": self.off_camera_pct,
            "lowEyeContactAnswers": [
                {"segmentId": a.segment_id, "lookingAtCameraPercent": round(a.eye_contact * 100)}
                for a in self.low_eye_contact_answers[:8]
            ],
        }

    def measurements(self) -> dict[str, dict[str, object]]:
        """Measured facts shown next to the eye contact, expression and composure scores."""
        eye, smile, restless = self.eye_contact_pct, self.smile_pct, self.restless_pct
        in_person = self.setting == "in_person"
        details = f"{len(self.low_eye_contact_answers)} answers with little eye contact"
        if self.to_speaker_pct is not None:
            details += f"; turned toward whoever was asking {self.to_speaker_pct}% of the time"
        return {
            "comm.eye_contact": {
                "label": "Looking at the interviewers" if in_person else "Looking at the camera",
                "value": eye, "unit": "% of the time", "target": "60% or more",
                "verdict": "Often looks away" if eye < 40 else "Sometimes looks away" if eye < 60 else "Good",
                "details": details,
            },
            "comm.facial_expression": {
                "label": "Smiling", "value": smile, "unit": "% of the time", "target": "10-40%",
                "verdict": "Rarely smiles" if smile < 5 else "A little reserved" if smile < 10
                else "Warm" if smile <= 40 else "Very smiley",
                "details": "Measured on your device from facial movement",
            },
            "comm.composure": {
                "label": "Restless head movement", "value": restless, "unit": "% of the time", "target": "under 15%",
                "verdict": "Restless" if restless > 30 else "Some fidgeting" if restless > 15 else "Calm",
                "details": f"Out of frame {self.off_camera_pct}% of the time",
            },
        }


def parse_face_seconds(data: Any) -> list[FaceSecond]:
    items = data.get("seconds") if isinstance(data, dict) else None
    out: list[FaceSecond] = []
    for item in items if isinstance(items, list) else []:
        try:
            to_speaker = item.get("toSpeaker")
            out.append(FaceSecond(int(item["t"]), float(item["present"]), float(item["eye"]),
                                  float(item["smile"]), float(item["move"]),
                                  None if to_speaker is None else float(to_speaker)))
        except (AttributeError, KeyError, TypeError, ValueError):
            continue
    return out


def measure_visual(
    seconds: list[FaceSecond], candidate_segments: list[Segment], setting: Setting = "online"
) -> VisualMetrics | None:
    """Whole-interview body-language figures; None when the camera was on too briefly to judge."""
    visible = [s for s in seconds if s.present >= PRESENT]
    if len(visible) < MIN_ON_CAMERA_SECONDS:
        return None

    def pct(values: list[bool]) -> int:
        return round(100 * sum(values) / len(values)) if values else 0

    by_second = {s.t: s for s in visible}
    low: list[AnswerLook] = []
    for segment in candidate_segments:
        window = [by_second[t] for t in range(segment.start_ms // 1000, segment.end_ms // 1000 + 1) if t in by_second]
        if len(window) >= MIN_ANSWER_SECONDS:
            eye = sum(s.eye for s in window) / len(window)
            if eye < LOW_EYE_CONTACT:
                low.append(AnswerLook(segment.id, segment.start_ms, segment.end_ms, eye))

    return VisualMetrics(
        on_camera_seconds=len(visible),
        off_camera_pct=pct([s.present < PRESENT for s in seconds]),
        eye_contact_pct=round(100 * sum(s.eye for s in visible) / len(visible)),
        smile_pct=pct([s.smile >= SMILING for s in visible]),
        restless_pct=pct([s.move >= RESTLESS for s in visible]),
        low_eye_contact_answers=low,
        setting=setting,
        to_speaker_pct=(
            round(100 * sum(turned) / len(turned))
            if (turned := [s.to_speaker for s in visible if s.to_speaker is not None])
            and setting == "in_person"
            else None
        ),
    )
