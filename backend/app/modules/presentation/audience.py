"""Who the user presents to, and what they will ask.

Four formats, mirrored by the Presentation formats in `src/data/practice.ts`: a small room (three
people at a table, live faces from the sales cast's boardroom), a large audience (the auditorium
footage, with a chair and questions from the floor: three people in its front row, lip-synced), a
virtual presentation (the
same three on a video call), and an academic presentation (a research talk in the university
classroom: a session chair and academics asking from the floor, three students in it lip-synced).
The audience is written for the user's own talk — its title, who it is
for, and the text of their slides — by `world.write_audience`.

The user holds the floor while they present: the audience listens without a word
(`LiveAgentSpec.hold_floor`) until they take questions. Whether it hears the talk is the user's
choice (`Questions`): questions on the talk and the slides, or on the slides alone.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from enum import StrEnum
from typing import Any


class Format(StrEnum):
    SMALL_ROOM = "small-room"
    LARGE_AUDIENCE = "large-audience"
    VIRTUAL = "virtual"
    #: A research talk at the university: the chair and two academics, questions on method and evidence.
    ACADEMIC = "academic"


class Questions(StrEnum):
    #: The audience listens to the talk, then asks about it and the slides.
    TALK = "talk"
    #: The audience does not hear the talk; its questions come from the slides alone.
    SLIDES = "slides"


@dataclass(frozen=True, slots=True)
class Person:
    """Someone in the audience. Name, voice and face stay the same; their job is the talk's."""

    key: str
    name: str
    #: Gemini Live voice; also the text-to-speech voice when they speak through a hand-over.
    voice: str
    persona: str
    role: str = ""

    @property
    def first_name(self) -> str:
        return self.name.split()[0]


#: The chair first. In the auditorium and the classroom they are three people in the audience.
AUDIENCE: tuple[Person, ...] = (
    Person(
        "robert", "Robert Lindqvist", "Algieba",
        "Late fifties, senior and measured; chairs the session. Asks about the big picture, impact and risk.",
    ),
    Person(
        "priya", "Priya Raman", "Autonoe",
        "Late thirties, analytical and direct. Asks about the numbers, the evidence and the method.",
    ),
    Person(
        "kevin", "Kevin Zhou", "Achird",
        "Around thirty, practical and friendly. Asks how it works in practice and what happens next.",
    ),
)


@dataclass(frozen=True, slots=True)
class Plan:
    #: The talk's title.
    title: str
    #: Who the audience is, to the user ("The leadership team of Northwind").
    audience: str
    #: What the audience cares about and expects from the talk, to the user.
    expects: str
    #: What each person privately wants to know and is sceptical about (key -> note). Never shown.
    stances: dict[str, str]
    #: Each person's job (key -> title).
    roles: dict[str, str]
    #: How the chair welcomes the speaker, in substance.
    opening: str
    #: What a strong talk and Q&A would achieve (internal, for play and feedback).
    success: str
    #: Tips for this talk, to the user, from its content and audience.
    tips: tuple[str, ...] = ()

    def people(self) -> tuple[Person, ...]:
        return tuple(replace(p, role=self.roles.get(p.key, p.role)) for p in AUDIENCE)

    def to_doc(self) -> dict[str, Any]:
        return {
            "title": self.title, "audience": self.audience, "expects": self.expects, "stances": dict(self.stances),
            "roles": dict(self.roles), "opening": self.opening, "success": self.success, "tips": list(self.tips),
        }

    @classmethod
    def from_doc(cls, doc: dict[str, Any], title: str = "") -> Plan:
        base = fallback(title)

        def text(field: str) -> str:
            return str(doc.get(field) or getattr(base, field))

        def per_person(field: str) -> dict[str, str]:
            given = doc.get(field) or {}
            return {k: str(given.get(k) or v) for k, v in getattr(base, field).items()}

        return cls(
            text("title"), text("audience"), text("expects"), per_person("stances"), per_person("roles"),
            text("opening"), text("success"),
            tuple(str(t) for t in doc.get("tips") or () if str(t).strip()) or base.tips,
        )


def fallback(title: str) -> Plan:
    """An audience for the user's own words, for when none could be written for them."""
    return Plan(
        title or "Your presentation",
        "An interested professional audience.",
        "A clear message, evidence for it, and what it means for them.",
        {
            "robert": "Wants to know why it matters and what the speaker recommends.",
            "priya": "Wants to see the evidence behind the main claim.",
            "kevin": "Wants to know how it would work in practice.",
        },
        {"robert": "Session chair", "priya": "Analyst", "kevin": "Manager"},
        "The chair welcomes the speaker by the talk's title and hands them the floor.",
        "A clear structure, one main message, evidence, a confident close, and calm, direct answers.",
        (
            "Open with the one message you want them to remember.",
            "Give each slide one point, and say it before you show the detail.",
            "Close with what you want them to do, then invite questions.",
        ),
    )


def format_of(context: dict[str, Any]) -> Format:
    try:
        return Format(str(context.get("format")))
    except ValueError:
        return Format.SMALL_ROOM


def questions_of(context: dict[str, Any]) -> Questions:
    try:
        return Questions(str(context.get("questions")))
    except ValueError:
        return Questions.TALK


def plan_of(context: dict[str, Any]) -> Plan:
    title = str(context.get("title") or "")
    doc = context.get("plan")
    return Plan.from_doc(doc, title) if isinstance(doc, dict) else fallback(title)


def briefing(context: dict[str, Any]) -> dict[str, Any]:
    """The user's pre-read: the audience, what it expects, tips, and how questions will work."""
    plan, fmt, questions = plan_of(context), format_of(context), questions_of(context)
    where = {
        Format.SMALL_ROOM: "In a meeting room, with three people at the table.",
        Format.LARGE_AUDIENCE: "In the auditorium, from the stage, with a chair and questions from the floor.",
        Format.VIRTUAL: "On a video call, with your slides on screen.",
        Format.ACADEMIC: (
            "In a university classroom, from the lectern, with a session chair and questions from academics in the "
            "room. For an accurate analysis of your posture and gestures, stand back so your whole body is on camera."
        ),
    }[fmt]
    how = ("They listen to your whole talk, then ask about it and your slides."
           if questions is Questions.TALK else "They ask about your slides after the talk.")
    people = plan.people()
    return {
        "title": plan.title,
        "audience": plan.audience,
        "expects": plan.expects,
        "tips": list(plan.tips),
        "people": [{"name": p.name, "role": p.role} for p in people],
        "format": f"{where} {how} " + (
            "When you finish, press Take questions or ask \"any questions?\"." if questions is Questions.TALK
            else "When you finish, press Take questions."
        ),
        "slides": bool(context.get("deckText")),
    }
