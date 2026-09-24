"""Who examines the student, and in which voice.

An oral exam is the same person throughout, so there is one examiner per style:
the one who questions, and the one who watches you work at the board. Their faces
are recordings on our LiveTalking server (`infra/livetalking`), the same people the
interview module uses — the ones who read as the most senior. Mirrors
`src/data/examiners.ts`, and the two are kept in step by tests on both sides.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.modules.exam.catalogs import ExamStyle


@dataclass(frozen=True, slots=True)
class Examiner:
    """A recording on our LiveTalking face server (`data/avatars/<avatar_id>`)."""

    avatar_id: str
    name: str
    role: str
    voice: str


EXAMINERS: dict[ExamStyle, Examiner] = {
    # Questions across a desk: the senior academic who has heard every answer before.
    ExamStyle.ORAL_QUESTIONS: Examiner("william", "Prof. William Okonjo", "Examiner", "Sadaltager"),
    # At the board: someone who follows a derivation line by line.
    ExamStyle.BOARD_WORK: Examiner("gabriel", "Prof. Gabriel Sartori", "Examiner", "Charon"),
    ExamStyle.UNKNOWN: Examiner("william", "Prof. William Okonjo", "Examiner", "Sadaltager"),
}

DEFAULT = EXAMINERS[ExamStyle.UNKNOWN]


def examiner_for(style: ExamStyle | str | None) -> Examiner:
    if isinstance(style, str):
        try:
            style = ExamStyle(style)
        except ValueError:
            return DEFAULT
    return EXAMINERS.get(style, DEFAULT) if style is not None else DEFAULT
