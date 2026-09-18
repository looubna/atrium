"""Who the user debates against, and in which voice.

A debate has one opponent throughout — swapping faces mid-argument would break the
one thing this feature depends on, which is the sense of arguing with somebody who
remembers what you said. Which opponent depends on the format, because a Socratic
questioner and a formal-debate opponent are genuinely different people to face.

Debates are voice only: nobody is shown on screen. The cast reuses
the people the other modules already use. Mirrors `src/data/debaters.ts`; tests on both
sides keep the two in step.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.modules.debate.catalogs import DebateFormat


@dataclass(frozen=True, slots=True)
class Debater:
    """The person the candidate hears. No face: interviews are voice only."""

    name: str
    role: str
    voice: str
    #: How they argue, in one line. Goes into their own instruction, never spoken.
    manner: str


DEBATERS: dict[DebateFormat, Debater] = {
    # Free debate: someone who argues like a well-read colleague who disagrees with you.
    DebateFormat.FREE: Debater("Richard Hale", "Debate opponent", "Alnilam",
        "direct and conversational; concedes a good point in a sentence and then explains why it changes nothing",
    ),
    # Structured: a chairperson's discipline, keeping to the phase the debate is in.
    DebateFormat.STRUCTURED: Debater("William Okonjo", "Debate opponent", "Sadaltager",
        "measured and orderly; signposts what it is doing — answering, objecting, or opening a new line",
    ),
    # Socratic: almost never asserts, and the questions do the damage.
    DebateFormat.SOCRATIC: Debater("Cara Lindqvist", "Socratic interlocutor", "Erinome",
        "asks rather than tells; every turn is a question that makes the last answer harder to hold",
    ),
    # Formal: longer, more rhetorical turns, as an Oxford-style opponent speaks.
    DebateFormat.OXFORD: Debater("Gabriel Sartori", "Opposing speaker", "Charon",
        "formal and structured; speaks in complete arguments rather than short exchanges",
    ),
    # Devil's advocate: argues a side it is open about not necessarily holding.
    DebateFormat.DEVILS_ADVOCATE: Debater("Pablo Duarte", "Devil's advocate", "Iapetus",
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
