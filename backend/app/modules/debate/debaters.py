"""Who the user debates against, and in which voice.

A debate has one opponent throughout — swapping faces mid-argument would break the
one thing this feature depends on, which is the sense of arguing with somebody who
remembers what you said. Which opponent depends on the format, because a Socratic
questioner and a formal-debate opponent are genuinely different people to face.

The faces are recordings on our own LiveTalking server (`infra/livetalking`), reusing
the people the other modules already use. Mirrors `src/data/debaters.ts`; tests on both
sides keep the two in step.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.modules.debate.catalogs import DebateFormat

#: The man in the debate hall's centre chair. His avatar is built from the wide hall clip
#: itself, not a close-up, so lip-sync happens where he is sitting and the shot never changes:
#: the candidate keeps the bench, the audience and their own lectern the whole way through.
#: The hall is one room with one opponent's chair, so every opponent with a man's voice wears him.
HALL_FACE = "debate_opponent"


@dataclass(frozen=True, slots=True)
class Debater:
    """A recording on our LiveTalking face server (`data/avatars/<avatar_id>`)."""

    avatar_id: str
    name: str
    role: str
    voice: str
    #: How they argue, in one line. Goes into their own instruction, never spoken.
    manner: str
    #: The lip-synced face they are shown with, or "" to stay on the filmed hall footage.
    face: str = HALL_FACE


DEBATERS: dict[DebateFormat, Debater] = {
    # Free debate: someone who argues like a well-read colleague who disagrees with you.
    DebateFormat.FREE: Debater(
        "richard", "Richard Hale", "Debate opponent", "Alnilam",
        "direct and conversational; concedes a good point in a sentence and then explains why it changes nothing",
    ),
    # Structured: a chairperson's discipline, keeping to the phase the debate is in.
    DebateFormat.STRUCTURED: Debater(
        "william", "William Okonjo", "Debate opponent", "Sadaltager",
        "measured and orderly; signposts what it is doing — answering, objecting, or opening a new line",
    ),
    # Socratic: almost never asserts, and the questions do the damage.
    DebateFormat.SOCRATIC: Debater(
        "cara", "Cara Lindqvist", "Socratic interlocutor", "Erinome",
        "asks rather than tells; every turn is a question that makes the last answer harder to hold",
        face="",  # a woman's voice: the hall's filmed opponent is a man
    ),
    # Formal: longer, more rhetorical turns, as an Oxford-style opponent speaks.
    DebateFormat.OXFORD: Debater(
        "gabriel", "Gabriel Sartori", "Opposing speaker", "Charon",
        "formal and structured; speaks in complete arguments rather than short exchanges",
    ),
    # Devil's advocate: argues a side it is open about not necessarily holding.
    DebateFormat.DEVILS_ADVOCATE: Debater(
        "pablo", "Pablo Duarte", "Devil's advocate", "Iapetus",
        "argues the other side as strongly as it can be argued, and says openly that this is what it is doing",
    ),
}

DEFAULT = DEBATERS[DebateFormat.FREE]


def debater_for(fmt: DebateFormat | str | None) -> Debater:
    if isinstance(fmt, str):
        try:
            fmt = DebateFormat(fmt)
        except ValueError:
            return DEFAULT
    return DEBATERS.get(fmt, DEFAULT) if fmt is not None else DEFAULT
