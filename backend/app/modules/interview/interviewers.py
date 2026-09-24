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
#: Each speaks in their own voice, which no lead interviewer uses.
#:
#: There are two of these, because a call and a room are not the same event. On a call the panel
#: is a grid of tiles and any of them can be given the floor. In the meeting room the panel is
#: three people in one photograph, and the only people who may speak are the people sitting in it.


@dataclass(frozen=True, slots=True)
class Panel:
    """Who else is in the interview, and how much of it is theirs."""

    #: Everyone with a voice: those who ask, and those who only introduce themselves.
    colleagues: tuple[PanelMember, ...]
    #: Someone at the table who is introduced by the lead and never speaks at all. None: nobody.
    observer: tuple[str, str] | None = None

    @property
    def askers(self) -> tuple[PanelMember, ...]:
        return tuple(m for m in self.colleagues if m.asks)

    @property
    def greeters(self) -> tuple[PanelMember, ...]:
        """They say hello at the start and then listen and take notes."""
        return tuple(m for m in self.colleagues if not m.asks)

    @property
    def shared_out(self) -> bool:
        """Somebody's share of the questions has been decided, so the lead is held to it."""
        return any(m.questions is not None for m in self.colleagues)

    @property
    def everyone(self) -> tuple[tuple[str, str], ...]:
        """Name and role for each of them, in the order they sit, the observer last."""
        return tuple((m.name, m.role) for m in self.colleagues) + ((self.observer,) if self.observer else ())


#: On a video call: the lead and two colleagues on camera, and nobody else. Neither colleague
#: declares a share, so the lead hands the floor out as it sees fit — as this call has always run.
PANEL_ONLINE = Panel(
    colleagues=(
        PanelMember("Daniel Brooks", "Team Lead", "Orus",
                    "Hi, I'm Daniel, I lead the team you'd be joining. Nice to meet you.",
                    "how the candidate would deliver results in this role: priorities, decisions, "
                    "ownership and impact"),
        PanelMember("Grace Lin", "Senior Team Member", "Kore",
                    "Hello, I'm Grace, I'd be one of your colleagues on the team. Great to meet you.",
                    "the day-to-day work of this role: working with colleagues, handling real situations, "
                    "the craft itself"),
    ),
)

#: In the meeting room: the three people in the room footage, and no more, because the candidate
#: can see the table. It is a real panel rather than three interviewers taking turns — the lead
#: runs it and asks most of the questions, Daniel comes in once or twice, and Grace sits in to
#: listen and take notes. The same two people as on the call, now seated at the table.
#: `questions` is that share, and the gateway holds the lead to it.
PANEL_IN_PERSON = Panel(
    colleagues=(
        PanelMember("Daniel Brooks", "Team Lead", "Orus",
                    "Hi, I'm Daniel, I lead the team you'd be joining. Nice to meet you.",
                    "how the candidate would deliver results in this role: priorities, decisions, "
                    "ownership and impact",
                    questions=2),
        PanelMember("Grace Lin", "Senior Team Member", "Kore",
                    "Hi, I'm Grace, I'm on the team. I'll mostly be listening and taking notes today.",
                    questions=0),
    ),
)


def panel_for(in_person: bool) -> Panel:
    return PANEL_IN_PERSON if in_person else PANEL_ONLINE


#: Their own recordings, used by no lead interviewer — a colleague wearing the lead's face would
#: put the same person on two tiles at once, so `avatar_api` drops any that collides.
#:
#: Only the call needs these: the meeting room is footage of the people already sitting in it and
#: draws no face at all. A colleague with no recording keeps their initials tile.
PANEL_AVATARS: dict[str, str] = {
    # The oral exam's professor. His base clip is the one recording of a man on this server whose
    # mouth actually stays shut (stitched from closed frames, with the parsing patch that keeps
    # his beard), so he is the only male face that does not mouth words through somebody else's
    # turn. Marcus's own clips all came back talking — see recordings/marcus/README.md.
    "Daniel Brooks": "william",
}


#: Who sits in the centre chair of the meeting-room footage.
#:
#: A call can put a different interviewer in front of the candidate for every round, because the
#: tile is whoever we say it is. The room cannot: it is one photograph of three people, and the
#: name under the frame has to belong to the woman actually sitting there. So an in-person round
#: is led by her whatever its type, and the round's character comes from the questions instead.
IN_PERSON_LEAD = INTERVIEWERS[RoundType.BEHAVIORAL]


def lead_for(round_type: RoundType | str | None, *, in_person: bool = False) -> Interviewer:
    """Who runs this round: the room's own interviewer, or the one the round type calls for."""
    return IN_PERSON_LEAD if in_person else interviewer_for(round_type)


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
