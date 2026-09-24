"""Body-language measurements from the per-second numbers the app records on the device.

The app never uploads images for these: it sends, for each second, how often a
face was visible, looking at the camera, smiling and moving restlessly — and, where
the device can run body tracking, whether the shoulders, the hands and the whole
body were in frame and whether the hands were up at the head or face. This module
turns that timeline into whole-interview figures and flags answers where eye
contact dropped, for the evaluator and for the numbers shown next to scores.

A face tracker alone cannot see hands on a head or arms folded, so a composure
score built only from head movement is a guess about the rest of the body.
`honest_visual_scores` makes the report say so rather than hand out a confident
"calm" to someone who spent the interview holding their head.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

from app.platform.feedback.schemas import Confidence
from app.platform.transcripts.model import Segment

PRESENT = 0.5
SMILING = 0.35
RESTLESS = 0.3
MIN_ON_CAMERA_SECONDS = 20
MIN_ANSWER_SECONDS = 4
LOW_EYE_CONTACT = 0.4
#: Below this share of on-camera time with the shoulders in frame, body language was not seen.
BODY_SEEN = 50
#: Hands at the head or face for this share of the time is a habit a panel notices.
HANDS_AT_FACE = 10
#: A score about something the camera barely showed cannot claim more than this.
UNSEEN_CAP = 60
#: A second counts as clear enough to judge the eyes when at least this share of it was bright enough.
CLEAR = 0.5
#: When less than this share of the camera time was clear, eye contact could not be measured.
MEASURABLE = 60
#: Eye contact that could not be measured (too dark, face not found) claims no more than this.
UNMEASURED_EYE_CAP = 40


@dataclass(frozen=True)
class FaceSecond:
    t: int
    present: float
    eye: float
    smile: float
    move: float
    # In-person panels: share of the second spent turned toward whoever was speaking.
    to_speaker: float | None = None
    # Body tracking, when the device could run it: shoulders in frame, hands in frame, hands up at
    # the head or face, and the whole body (hips to feet) in frame. None when it did not run.
    body: float | None = None
    hands: float | None = None
    hands_face: float | None = None
    full: float | None = None
    #: Share of the second bright enough to judge (the face, or the frame when no face was found).
    #: None for recordings made before it was measured.
    clear: float | None = None


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
    #: Body tracking, as shares of on-camera time; all None when the device could not run it.
    body_visible_pct: int | None = None
    hands_visible_pct: int | None = None
    hands_at_face_pct: int | None = None
    full_body_pct: int | None = None
    #: Share of the camera time too dark to judge the eyes, when the device measured it.
    too_dark_pct: int | None = None
    #: Share of the camera time clear enough to judge eye contact (face found or not).
    measurable_pct: int = 100

    def eye_measured(self) -> bool:
        """Whether eye contact was actually seen: enough of the time bright enough, with a face in it."""
        return self.measurable_pct >= MEASURABLE

    def body_seen(self) -> bool | None:
        """Whether the camera showed enough of the body to judge it; None when nobody measured."""
        return None if self.body_visible_pct is None else self.body_visible_pct >= BODY_SEEN

    def summary(self) -> dict[str, object]:
        """Model-facing summary with segment references."""
        return {
            "setting": self.setting,
            **({"lookingAtSpeakerPercent": self.to_speaker_pct} if self.to_speaker_pct is not None else {}),
            "secondsOnCamera": self.on_camera_seconds,
            "lookingAtCameraPercent": self.eye_contact_pct,
            # False when the room was too dark (or the face was missing) to see the eyes: the eye
            # contact figure is then no evidence of good eye contact.
            "eyeContactMeasurable": self.eye_measured(),
            **({"tooDarkPercent": self.too_dark_pct} if self.too_dark_pct is not None else {}),
            "smilingPercent": self.smile_pct,
            "restlessMovementPercent": self.restless_pct,
            "outOfFramePercent": self.off_camera_pct,
            **(
                {
                    "shouldersInFramePercent": self.body_visible_pct,
                    "handsInFramePercent": self.hands_visible_pct,
                    "handsAtHeadOrFacePercent": self.hands_at_face_pct,
                    "wholeBodyInFramePercent": self.full_body_pct,
                    "bodyLanguageVisible": self.body_seen(),
                }
                if self.body_visible_pct is not None else {"bodyLanguageVisible": None}
            ),
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
        if not self.eye_measured():
            details = (
                f"Too dark to see your eyes {self.too_dark_pct}% of the time"
                if self.too_dark_pct else "Your face was out of view much of the time"
            ) + "; eye contact could not be measured properly"
        return {
            "comm.eye_contact": {
                "label": "Looking at the interviewers" if in_person else "Looking at the camera",
                "value": eye, "unit": "% of the time", "target": "60% or more",
                "verdict": (
                    "Not measurable" if not self.eye_measured()
                    else "Often looks away" if eye < 40 else "Sometimes looks away" if eye < 60 else "Good"
                ),
                "details": details,
            },
            "comm.facial_expression": {
                "label": "Smiling", "value": smile, "unit": "% of the time", "target": "10-40%",
                "verdict": "Rarely smiles" if smile < 5 else "A little reserved" if smile < 10
                else "Warm" if smile <= 40 else "Very smiley",
                "details": "Measured on your device from facial movement",
            },
            "comm.composure": self._composure(restless),
        }


    def _composure(self, restless: int) -> dict[str, object]:
        hands = self.hands_at_face_pct
        if hands is not None and hands >= HANDS_AT_FACE:
            return {
                "label": "Hands at your head or face", "value": hands, "unit": "% of the time", "target": "under 10%",
                "verdict": "Often" if hands >= 25 else "Sometimes",
                "details": f"Restless head movement {restless}% of the time; out of frame {self.off_camera_pct}%",
            }
        details = f"Out of frame {self.off_camera_pct}% of the time"
        if self.body_seen() is False:
            details += f"; shoulders in frame only {self.body_visible_pct}% of the time, so body language was not seen"
        return {
            "label": "Restless head movement", "value": restless, "unit": "% of the time", "target": "under 15%",
            "verdict": "Restless" if restless > 30 else "Some fidgeting" if restless > 15 else "Calm",
            "details": details,
        }


def _optional(item: dict[str, Any], key: str) -> float | None:
    value = item.get(key)
    return None if value is None else float(value)


def parse_face_seconds(data: Any) -> list[FaceSecond]:
    items = data.get("seconds") if isinstance(data, dict) else None
    out: list[FaceSecond] = []
    for item in items if isinstance(items, list) else []:
        try:
            out.append(FaceSecond(int(item["t"]), float(item["present"]), float(item["eye"]),
                                  float(item["smile"]), float(item["move"]), _optional(item, "toSpeaker"),
                                  _optional(item, "body"), _optional(item, "hands"), _optional(item, "handsFace"),
                                  _optional(item, "full"), _optional(item, "clear")))
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

    # Eye contact over all the time the camera could judge it: a second with no face in a lit room is
    # a second of no eye contact, not a second left out. Too-dark seconds prove nothing either way.
    judged = [s for s in seconds if s.clear is None or s.clear >= CLEAR]
    eye_seconds = [s.eye if s.present >= PRESENT else 0.0 for s in judged]
    measured = [s for s in judged if s.present >= PRESENT]
    has_light = any(s.clear is not None for s in seconds)

    return VisualMetrics(
        on_camera_seconds=len(visible),
        off_camera_pct=pct([s.present < PRESENT for s in seconds]),
        eye_contact_pct=round(100 * sum(eye_seconds) / len(eye_seconds)) if eye_seconds else 0,
        too_dark_pct=pct([s.clear is not None and s.clear < CLEAR for s in seconds]) if has_light else None,
        measurable_pct=pct([s in measured for s in seconds]) if seconds else 0,
        smile_pct=pct([s.smile >= SMILING for s in visible]),
        restless_pct=pct([s.move >= RESTLESS for s in visible]),
        low_eye_contact_answers=low,
        setting=setting,
        **_body_figures(visible),
        to_speaker_pct=(
            round(100 * sum(turned) / len(turned))
            if (turned := [s.to_speaker for s in visible if s.to_speaker is not None])
            and setting == "in_person"
            else None
        ),
    )


def _body_figures(visible: list[FaceSecond]) -> dict[str, int | None]:
    tracked = [s for s in visible if s.body is not None]
    if len(tracked) < MIN_ON_CAMERA_SECONDS:
        return {}

    def share(values: list[float | None]) -> int:
        return round(100 * sum(1 for v in values if (v or 0) >= 0.5) / len(values))

    return {
        "body_visible_pct": share([s.body for s in tracked]),
        "hands_visible_pct": share([s.hands for s in tracked]),
        "hands_at_face_pct": share([s.hands_face for s in tracked]),
        "full_body_pct": share([s.full for s in tracked]),
    }


def honest_visual_scores(scores: list[Any], visual: VisualMetrics | None) -> list[Any]:
    """Body-language scores held to what the camera actually showed.

    Applied to every report after the model has written it, because a model given "1% restless
    head movement" will call someone calm whatever their hands were doing. Two rules:

    - hands at the head or face for a noticeable share of the time caps composure, and says why;
    - when the shoulders were out of frame most of the time, composure is a guess about a body the
      camera never showed: it is capped, marked low confidence, and the candidate is told to sit
      back so it can be judged.
    """
    if visual is None:
        return scores
    out: list[Any] = []
    for score in scores:
        if score.competencyId == "comm.eye_contact":
            out.append(_honest_eye_contact(score, visual))
            continue
        if score.competencyId != "comm.composure":
            out.append(score)
            continue
        update: dict[str, Any] = {}
        hands = visual.hands_at_face_pct
        if hands is not None and hands >= HANDS_AT_FACE:
            cap = max(25, 70 - hands)
            if score.score > cap:
                update["score"] = cap
            update["measured"] = (
                f"Your hands were at your head or face {hands}% of the time. " + score.measured
            ).strip()
            update["toReach100"] = [
                "Rest your hands on the desk or in your lap, and use them only for the occasional gesture.",
                *score.toReach100,
            ][:3]
        if visual.body_seen() is False:
            update["score"] = min(update.get("score", score.score), UNSEEN_CAP)
            # The enum, not its text: the scores are stored with `confidence.value` after this.
            update["confidence"] = Confidence.LOW
            update["measured"] = (
                f"Only your face was in frame most of the time (shoulders visible {visual.body_visible_pct}%), so "
                "posture and hands could not be judged. " + update.get("measured", score.measured)
            ).strip()
            update["toReach100"] = [
                "Sit back so your head, shoulders and hands are all in the frame, for an accurate analysis.",
                *update.get("toReach100", score.toReach100),
            ][:3]
        out.append(score.model_copy(update=update) if update else score)
    return out


def _honest_eye_contact(score: Any, visual: VisualMetrics) -> Any:
    """Eye contact the camera could not see is not good eye contact.

    In a dark room the face tracker still finds a dim face but cannot read its eyes, and a face
    that is mostly out of view says nothing about where the eyes were. A score then is a guess: it
    is capped, marked low confidence, and says why and what to change.
    """
    if visual.eye_measured():
        return score
    why = (
        f"The room was too dark to see your eyes {visual.too_dark_pct}% of the time"
        if visual.too_dark_pct
        else f"Your face was out of view much of the time (out of frame {visual.off_camera_pct}%)"
    )
    return score.model_copy(update={
        "score": min(score.score, UNMEASURED_EYE_CAP),
        "confidence": Confidence.LOW,
        "measured": f"{why}, so eye contact could not be measured properly.",
        "meaning": "Eye contact could not be judged from this recording.",
        "toReach100": [
            "Sit facing a window or a lamp, so your face is evenly lit.",
            "Keep your whole face in the frame, at eye level with the camera.",
            *score.toReach100,
        ][:3],
    })
