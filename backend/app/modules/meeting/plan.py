"""The meeting the user joins: who is there, what it is about, and what each person wants from it.

Every meeting is written for the user's own topic (and their material, when they bring some) by
`world.write_plan` — there is no preset, since the topic is the one thing the setup always asks for.
The user takes one of three roles (`Role`, mirrored by `MEETING_ROLES` in `src/data/practice.ts`):
they run the meeting, they take part in one someone else runs, or they are the client the team reports
to. The faces are the sales cast (`infra/livetalking/recordings/sales/`): Claire in a one-to-one;
Robert, Priya and Kevin in a group, Robert first.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from enum import StrEnum
from typing import Any


class Role(StrEnum):
    PARTICIPANT = "participant"
    LEADER = "leader"
    STAKEHOLDER = "stakeholder"


LABELS: dict[Role, str] = {
    Role.PARTICIPANT: "Participant",
    Role.LEADER: "Meeting leader",
    Role.STAKEHOLDER: "Client / stakeholder",
}


@dataclass(frozen=True, slots=True)
class Person:
    """Someone in the meeting. Name, voice and face stay the same; their job is the meeting's."""

    key: str
    name: str
    #: Gemini Live voice; also the text-to-speech voice when they speak through a hand-over.
    voice: str
    #: How they behave in meetings, for the model to play them consistently.
    persona: str
    role: str = ""

    @property
    def first_name(self) -> str:
        return self.name.split()[0]


SOLO = Person(
    "claire", "Claire Donovan", "Despina",
    "Early forties, experienced, direct and warm. Prepared, asks precise questions, dislikes vague answers.",
)

GROUP: tuple[Person, ...] = (
    Person(
        "robert", "Robert Lindqvist", "Algieba",
        "Late fifties, senior and measured. Speaks with authority, cares about decisions and risk; can go long.",
    ),
    Person(
        "priya", "Priya Raman", "Autonoe",
        "Late thirties, analytical and direct. Brings data, challenges assumptions, disagrees openly.",
    ),
    Person(
        "kevin", "Kevin Zhou", "Achird",
        "Around thirty, practical and friendly. Close to the day-to-day work; raises real blockers, sometimes "
        "too quietly.",
    ),
)

PEOPLE = {p.key: p for p in (SOLO, *GROUP)}


def people_for(group: bool) -> tuple[Person, ...]:
    """Who is in the meeting besides the user, the one who speaks most first."""
    return GROUP if group else (SOLO,)


@dataclass(frozen=True, slots=True)
class Plan:
    role: Role
    #: Short title for the meeting ("Q4 launch recovery plan").
    title: str
    #: To the user, one sentence: who they are in this meeting.
    you: str
    #: The organisation, by name.
    org: str
    #: One sentence on it.
    about: str
    #: Background and agenda: what everyone knows coming in.
    situation: str
    #: What the user brings and wants from the meeting, to them.
    position: str
    #: What each person privately wants, worries about and will push (key -> note). Never shown to the user.
    stances: dict[str, str]
    #: How the meeting starts.
    opening: str
    #: What a strong meeting gets done (internal, for play and feedback).
    success: str
    #: The user's goal, to them.
    goal: str
    #: What the user knows about each person (key -> note): facts only.
    known: dict[str, str]
    #: Each person's job (key -> title).
    roles: dict[str, str]
    #: What the user should raise or cover in this meeting, in their role, from the topic and material.
    points: tuple[str, ...] = ()

    def people(self, group: bool) -> tuple[Person, ...]:
        return tuple(replace(p, role=self.roles.get(p.key, p.role)) for p in people_for(group))

    def to_doc(self) -> dict[str, Any]:
        return {
            "title": self.title, "you": self.you, "org": self.org, "about": self.about,
            "situation": self.situation, "position": self.position, "stances": dict(self.stances),
            "opening": self.opening, "success": self.success, "goal": self.goal, "known": dict(self.known),
            "roles": dict(self.roles), "points": list(self.points),
        }

    @classmethod
    def from_doc(cls, role: Role, doc: dict[str, Any], topic: str = "") -> Plan:
        """A stored plan, filled in from the fallback wherever it is missing something."""
        base = fallback(role, topic)

        def text(field: str) -> str:
            return str(doc.get(field) or getattr(base, field))

        def per_person(field: str) -> dict[str, str]:
            given = doc.get(field) or {}
            return {k: str(given.get(k) or v) for k, v in getattr(base, field).items()}

        return cls(
            role, text("title"), text("you"), text("org"), text("about"), text("situation"), text("position"),
            per_person("stances"), text("opening"), text("success"), text("goal"), per_person("known"),
            per_person("roles"),
            tuple(str(p) for p in doc.get("points") or () if str(p).strip()) or base.points,
        )


#: How each role's meeting starts and what it is for, whatever the topic.
_BY_ROLE: dict[Role, tuple[str, str, str, str]] = {
    # role -> (you, opening, success, goal)
    Role.LEADER: (
        "You are running this meeting.",
        "Everyone has joined and waits for the user to open the meeting.",
        "Opens with the purpose and agenda, keeps to time, brings everyone in, handles disagreement fairly, "
        "drives to a decision, and closes with owners and dates.",
        "Run the meeting to a clear decision, with owners and next steps.",
    ),
    Role.PARTICIPANT: (
        "You are taking part in this meeting.",
        "The chair welcomes everyone, states the purpose in a sentence, and asks the user for their view early on.",
        "Makes their point clearly and early, backs it with facts, asks good questions, builds on others, "
        "handles pushback calmly, and helps the meeting reach a decision.",
        "Get your point heard and shape the decision.",
    ),
    Role.STAKEHOLDER: (
        "You are the client: the team reports to you.",
        "The team lead welcomes the user, gives a one-sentence status, and asks what they would like to cover.",
        "Asks sharp questions, states their priorities clearly, pushes back where the plan does not serve them, "
        "agrees trade-offs, and leaves with clear commitments.",
        "Make sure the plan serves your interests, and leave with clear commitments.",
    ),
}


#: What to discuss when no points could be written for the user's meeting.
_POINTS: dict[Role, tuple[str, ...]] = {
    Role.LEADER: (
        "Open with the purpose of the meeting and the decision you need by the end.",
        "Give the key facts in two or three sentences, then ask each person for their view.",
        "Summarise the options and drive the group to a decision.",
        "Close with owners, deadlines and the next check-in.",
    ),
    Role.PARTICIPANT: (
        "Make your main point early, with the fact or figure that supports it.",
        "Ask one question that tests the plan's weakest assumption.",
        "Say clearly what you need from the others.",
        "Before the end, check the decision and your own actions.",
    ),
    Role.STAKEHOLDER: (
        "State your top priorities and what success looks like for you.",
        "Ask about the biggest risk to your timeline or budget.",
        "Push back on anything that does not serve your priorities, and propose a trade-off.",
        "Leave with clear commitments and dates.",
    ),
}


def fallback(role: Role, topic: str) -> Plan:
    """A meeting on the user's own words, for when none could be written for them."""
    you, opening, success, goal = _BY_ROLE[role]
    subject = topic or "the topic on the agenda"
    stances = {
        "claire": "Has her own view on the topic and a concern she will raise; wants a clear decision.",
        "robert": "Senior; wants a decision and cares about cost and risk.",
        "priya": "Challenges assumptions with data; disagrees with at least one proposal.",
        "kevin": "Knows the day-to-day blockers; raises one only if asked.",
    }
    return Plan(
        role, "Meeting", you, "Your organisation", "The organisation the meeting is for.",
        f"The meeting is about: {subject}", f"What you want from it: {subject}", stances, opening, success, goal,
        {k: "A colleague in the meeting." for k in PEOPLE},
        {"claire": "Colleague", "robert": "Director", "priya": "Analyst", "kevin": "Team member"},
        _POINTS[role],
    )


def role_of(context: dict[str, Any]) -> Role:
    try:
        return Role(str(context.get("role")))
    except ValueError:
        return Role.PARTICIPANT


def plan_of(context: dict[str, Any]) -> Plan:
    role, topic = role_of(context), str(context.get("topic") or "")
    doc = context.get("plan")
    return Plan.from_doc(role, doc, topic) if isinstance(doc, dict) else fallback(role, topic)


def is_group(context: dict[str, Any]) -> bool:
    return bool(context.get("group"))


def in_person(context: dict[str, Any]) -> bool:
    return context.get("mode") == "in_person"


def _known(note: str, role: str) -> str:
    """What the user knows about someone, without repeating the job title shown next to it."""
    if role and note.lower().startswith(role.lower()):
        rest = note[len(role):].lstrip(" .,;:")
        return rest[:1].upper() + rest[1:]
    return note


def briefing(context: dict[str, Any]) -> dict[str, Any]:
    """The user's pre-read: their role, the background and agenda, their aims, who is there, the goal."""
    plan, group = plan_of(context), is_group(context)
    people = plan.people(group)
    where = "In person, around the table" if in_person(context) else "A video call"
    who = "with three colleagues" if group else f"with {people[0].first_name}"
    return {
        "title": plan.title,
        "you": plan.you,
        "org": plan.org,
        "about": plan.about,
        "situation": plan.situation,
        "position": plan.position,
        "goal": plan.goal,
        "points": list(plan.points),
        "people": [{"name": p.name, "role": p.role, "known": _known(plan.known[p.key], p.role)} for p in people],
        "format": f"{where} {who}." + (" You open it." if plan.role is Role.LEADER else ""),
    }
