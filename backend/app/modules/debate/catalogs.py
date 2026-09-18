"""Debate formats, difficulties, positions and the competencies a debate is judged on.

A debate is one scenario type on the platform, so everything that varies between
debates is configuration here rather than a separate code path: the format decides
how turns are shaped, the difficulty decides how hard the opponent presses (see
`orchestrator.py`), and the position decides who argues which side.
"""

from __future__ import annotations

import random
from enum import StrEnum

from app.platform.competencies.catalog import Competency, Layer

CATALOG_VERSION = "debate-2026-09-19"


class DebateFormat(StrEnum):
    #: Natural back-and-forth. The default, and what most people picture.
    FREE = "free"
    #: Opening, rebuttal, counterargument, closing — the phases are held to more strictly.
    STRUCTURED = "structured"
    #: The opponent mostly asks: it attacks assumptions through questions rather than counterclaims.
    SOCRATIC = "socratic"
    #: Formal debate: longer, less interrupted turns on both sides.
    OXFORD = "oxford"
    #: The opponent argues the side the user holds privately, to test whether they can defend the other.
    DEVILS_ADVOCATE = "devils_advocate"


FORMAT_LABELS: dict[DebateFormat, str] = {
    DebateFormat.FREE: "Free debate",
    DebateFormat.STRUCTURED: "Structured debate",
    DebateFormat.SOCRATIC: "Socratic debate",
    DebateFormat.OXFORD: "Formal (Oxford-style)",
    DebateFormat.DEVILS_ADVOCATE: "Devil's advocate",
}


def parse_format(value: str | None) -> DebateFormat:
    try:
        return DebateFormat(str(value))
    except ValueError:
        return DebateFormat.FREE


class Difficulty(StrEnum):
    BEGINNER = "beginner"
    INTERMEDIATE = "intermediate"
    ADVANCED = "advanced"


def parse_difficulty(value: str | None) -> Difficulty:
    try:
        return Difficulty(str(value))
    except ValueError:
        return Difficulty.INTERMEDIATE


class Focus(StrEnum):
    """One weakness a follow-up debate concentrates on (§31, "Focus practice").

    A focus never changes the debate into a drill: it is a real debate on a real motion,
    with the opponent leaning on one dimension harder than it otherwise would.
    """

    NONE = "none"
    EVIDENCE = "evidence"
    REBUTTALS = "rebuttals"
    CONCISENESS = "conciseness"
    CRITICAL_THINKING = "critical_thinking"
    INTERRUPTIONS = "interruptions"


FOCUS_LABELS: dict[Focus, str] = {
    Focus.NONE: "A full debate",
    Focus.EVIDENCE: "Evidence",
    Focus.REBUTTALS: "Rebuttals",
    Focus.CONCISENESS: "Conciseness",
    Focus.CRITICAL_THINKING: "Critical thinking",
    Focus.INTERRUPTIONS: "Handling interruptions",
}

#: What the opponent does differently. Read by the orchestrator (which targets it prefers)
#: and by the debater's instruction (how it behaves).
FOCUS_BRIEFS: dict[Focus, str] = {
    Focus.NONE: "",
    Focus.EVIDENCE: "Ask what supports almost every claim they make, and do not let a vague source pass. When they "
    "give evidence, ask what it actually shows.",
    Focus.REBUTTALS: "Put an objection in nearly every turn, and hold them to answering the objection itself. When "
    "they answer something easier, say so and ask again.",
    Focus.CONCISENESS: "Keep your own turns short, and when they run long, say plainly that you have lost the "
    "thread and ask them for the point in one sentence.",
    Focus.CRITICAL_THINKING: "Go after the reasoning rather than the facts: the assumptions the argument needs, "
    "whether what they call a cause is one, and the cost their own position carries.",
    Focus.INTERRUPTIONS: "Come in while they are still speaking when they have made a point you can object to, "
    "rather than waiting for them to finish. Be brisk, never rude, and let them finish if they push back.",
}


def parse_focus(value: str | None) -> Focus:
    try:
        return Focus(str(value))
    except ValueError:
        return Focus.NONE


class Position(StrEnum):
    FOR = "for"
    AGAINST = "against"

    @property
    def opposite(self) -> Position:
        return Position.AGAINST if self is Position.FOR else Position.FOR


def parse_position(value: str | None) -> Position | None:
    try:
        return Position(str(value))
    except ValueError:
        return None


class PositionMode(StrEnum):
    """Who decides which side the user argues (§6 of the product brief)."""

    #: The user picked their own side.
    USER = "user"
    #: We assign it — useful for testing whether they can argue a side they did not choose.
    ASSIGNED = "assigned"
    #: Coin toss, decided when the debate is prepared so the user cannot re-roll it.
    RANDOM = "random"


def parse_position_mode(value: str | None) -> PositionMode:
    try:
        return PositionMode(str(value))
    except ValueError:
        return PositionMode.USER


def assign_positions(
    mode: PositionMode, asked: Position | None, *, rng: random.Random | None = None
) -> tuple[Position, Position]:
    """The user's side and the opponent's. The opponent always takes the other one.

    A debate where both sides agree is not a debate, so the opponent's position is
    never chosen independently — it is whatever the user is not arguing.
    """
    chooser = rng or random.SystemRandom()
    if mode is PositionMode.USER and asked is not None:
        user = asked
    else:
        user = Position.FOR if chooser.random() < 0.5 else Position.AGAINST
    return user, user.opposite


#: How a fully open motion is worded when the user only gave a topic.
def position_phrase(position: Position, topic: str) -> str:
    return f"{'FOR' if position is Position.FOR else 'AGAINST'}: {topic}"


_DEBATE_COMPETENCIES: list[tuple[str, str, str]] = [
    ("argument.claims", "Clear claims", "States a position plainly enough to be argued with."),
    ("argument.reasoning", "Reasoning", "The conclusion actually follows from the reasons given."),
    ("argument.evidence", "Use of evidence", "Supports claims with specific, relevant, checkable evidence."),
    ("argument.structure", "Argument structure",
     "Claim, reason, evidence and conclusion are all present and in order."),
    ("rebuttal.responsiveness", "Answering the objection",
     "Addresses the objection that was actually made, not an easier one."),
    ("rebuttal.defence", "Defending your position", "Holds and repairs its own case when it is attacked."),
    ("rebuttal.pressure", "Holding up under pressure", "Stays precise and calm when pressed repeatedly."),
    ("thinking.assumptions", "Assumption awareness", "Notices and defends what the argument takes for granted."),
    ("thinking.counterexamples", "Handling counterexamples", "Deals with the awkward case instead of ignoring it."),
    ("thinking.tradeoffs", "Weighing trade-offs", "Acknowledges the costs of its own position."),
    ("thinking.causality", "Causal reasoning", "Keeps correlation, cause and coincidence apart."),
    ("thinking.concession", "Conceding well", "Grants a fair point without giving up the argument."),
    ("consistency.coherence", "Consistency", "Later claims do not contradict earlier ones."),
    ("substance.engagement", "Engaging the strongest case",
     "Argues against the opponent's best point, not its weakest."),
]

DEBATE_COMPETENCIES: dict[str, Competency] = {
    f"debate.{slug}": Competency(f"debate.{slug}", name, Layer.ROUND, description)
    for slug, name, description in _DEBATE_COMPETENCIES
}


def competencies_for_format(fmt: DebateFormat) -> list[Competency]:
    """Every debate is judged on the same things; the format only changes how they show up.

    Keeping one list means progress in "answering the objection" compares across a
    Socratic debate and a formal one, which is the point of tracking it at all.
    """
    if fmt is DebateFormat.SOCRATIC:
        # Nobody defends a case against counterclaims here, so that competency has no evidence.
        return [c for cid, c in DEBATE_COMPETENCIES.items() if cid != "debate.substance.engagement"]
    return list(DEBATE_COMPETENCIES.values())
