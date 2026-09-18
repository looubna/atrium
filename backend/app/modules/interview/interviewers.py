"""Who the candidate meets in each round: a face and a voice that belong together.

A real loop escalates — a recruiter first, engineers next, the hiring manager and
executives last — and the interviewer should escalate with it. The avatar is chosen
here, on the server, so a client can never ask for an arbitrary face.

Their faces are recordings on our LiveTalking server (`infra/livetalking`), the same person
online and in person. Mirrors `src/data/interviewers.ts`; the two are kept in step by tests on both sides.
Google describes Live API voices by character (firm, mature, clear) and never by
gender, so each voice pairing is a listening judgement, not a documented fact.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.modules.interview.catalogs import RoundType
from app.platform.agents.live import PanelMember


@dataclass(frozen=True, slots=True)
class Interviewer:
    """A recording on our LiveTalking face server (`data/avatars/<avatar_id>`)."""

    avatar_id: str
    name: str
    role: str
    voice: str


INTERVIEWERS: dict[RoundType, Interviewer] = {
    RoundType.SCREENING: Interviewer(
        "mia", "Mia Fernández", "Talent Partner", "Leda"
    ),
    RoundType.BEHAVIORAL: Interviewer(
        "evelyn", "Evelyn Ross", "People Business Partner", "Gacrux"
    ),
    RoundType.TECHNICAL: Interviewer(
        "pablo", "Pablo Duarte", "Senior Engineer", "Iapetus"
    ),
    RoundType.CODING: Interviewer(
        "leo", "Leo Mensah", "Staff Engineer", "Puck"
    ),
    RoundType.SYSTEM_DESIGN: Interviewer(
        "gabriel", "Gabriel Sartori", "Principal Engineer", "Charon"
    ),
    RoundType.CASE: Interviewer(
        "cara", "Cara Lindqvist", "Engagement Manager", "Erinome"
    ),
    RoundType.HIRING_MANAGER: Interviewer(
        "richard", "Richard Hale", "Hiring Manager", "Alnilam"
    ),
    RoundType.PRESENTATION: Interviewer(
        "william", "William Okonjo", "Department Head", "Sadaltager"
    ),
    RoundType.TAKE_HOME_REVIEW: Interviewer(
        "kevin", "Kevin Park", "Team Manager", "Schedar"
    ),
    RoundType.OTHER: Interviewer(
        "mia", "Mia Fernández", "Interviewer", "Leda"
    ),
}

DEFAULT = INTERVIEWERS[RoundType.OTHER]

#: The rest of a panel, exactly as their tiles read. Their titles fit any job and field; what they
#: ask comes from the actual role, company and round (`PANEL` in `src/data/interviewers.ts`).
#: The two on camera ask their own questions in their own voices, which no lead
#: interviewer uses; the observer keeps the camera off and never speaks.
PANEL_COLLEAGUES: tuple[PanelMember, ...] = (
    PanelMember("Daniel Brooks", "Team Lead", "Orus",
                "Hi, I'm Daniel, I lead the team you'd be joining. Nice to meet you.",
                "how the candidate would deliver results in this role: priorities, decisions, ownership and impact"),
    PanelMember("Grace Lin", "Senior Team Member", "Kore",
                "Hello, I'm Grace, I'd be one of your colleagues on the team. Great to meet you.",
                "the day-to-day work of this role: working with colleagues, handling real situations, "
                "the craft itself"),
)
PANEL_OBSERVER = ("Sam Wright", "Recruiting Coordinator")
#: Their own recordings, used by no lead interviewer.
PANEL_AVATARS: dict[str, str] = {
    "Daniel Brooks": "daniel",
    "Grace Lin": "grace",
}

def interviewer_for(round_type: RoundType | str | None) -> Interviewer:
    """The interviewer for a round, falling back rather than leaving a round faceless."""
    if isinstance(round_type, str):
        try:
            round_type = RoundType(round_type)
        except ValueError:
            return DEFAULT
    return INTERVIEWERS.get(round_type, DEFAULT) if round_type is not None else DEFAULT


VOICES: dict[RoundType, str] = {round_type: person.voice for round_type, person in INTERVIEWERS.items()}
DEFAULT_VOICE = DEFAULT.voice


def voice_for(round_type: RoundType) -> str:
    """The voice for a round, matching the face shown for it."""
    return VOICES.get(round_type, DEFAULT_VOICE)
