"""Competency definitions.

IDs are namespaced and permanent: `comm.*` for the universal communication
dimensions every module is scored on (the global communication profile), and
`<module>.<area>.*` for module-specific competencies. An ID is never reused for
a different meaning; changed definitions bump `catalogVersion`, and progress
deltas only compare scores from the same competency and version.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum


class Layer(StrEnum):
    COMMUNICATION = "communication"
    ROUND = "round"


@dataclass(frozen=True, slots=True)
class Competency:
    id: str
    name: str
    layer: Layer
    description: str


COMMUNICATION_CATALOG_VERSION = "comm-2026-09-16"

_COMMUNICATION = [
    ("clarity", "Clarity", "Ideas are easy to follow on first hearing."),
    ("structure", "Answer structure", "Answers have a clear shape: point, support, conclusion."),
    ("conciseness", "Conciseness", "Says what is needed without padding or rambling."),
    ("relevance", "Relevance", "Answers the question that was asked."),
    ("fluency", "Fluency", "Speech flows without frequent restarts or long hesitations."),
    ("pace", "Pace", "Speaking rate is comfortable to follow and varies for emphasis."),
    ("filler_words", "Filler words", "Minimal use of um, uh, like, you know and similar fillers."),
    ("repetition", "Repetition", "Avoids repeating the same points or phrases."),
    ("listening", "Listening and engagement", "Builds on what the interviewer said; answers follow-ups directly."),
    ("vocabulary", "Professional vocabulary", "Uses precise, appropriate terms for the domain."),
    ("reasoning", "Explaining reasoning", "Makes the why behind decisions explicit."),
    ("handling_questions", "Handling questions", "Responds to challenges and clarifications calmly and directly."),
    ("delivery", "Delivery", "Perceived confidence: steady voice, decisive phrasing."),
    ("storytelling", "Storytelling", "Examples have context, stakes, actions and outcomes."),
    ("intonation", "Intonation", "Voice rises and falls naturally so key points stand out; never flat or monotone."),
    ("articulation", "Articulation", "Words are pronounced clearly and completely; nothing is swallowed or mumbled."),
    ("projection", "Volume and projection", "Clearly audible, and the voice holds its strength to the end of answers."),
    ("eye_contact", "Eye contact", "Looks at the camera, the interviewer's eyes, most of the time and at key points."),
    ("facial_expression", "Facial expression", "Expressions are warm and match what is said; not blank or tense."),
    ("composure", "Body language and composure", "Steady and upright on camera, little fidgeting or looking away."),
]

#: Scored only when the camera was on (face measurements or video are available).
VISUAL_COMPETENCIES = frozenset({"comm.eye_contact", "comm.facial_expression", "comm.composure"})

COMMUNICATION: dict[str, Competency] = {
    f"comm.{slug}": Competency(f"comm.{slug}", name, Layer.COMMUNICATION, desc) for slug, name, desc in _COMMUNICATION
}
