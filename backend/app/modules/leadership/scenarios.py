"""The team on the call, and the situations the user leads them through.

The user is the team's manager, on a video call with three of their direct reports. Every
scenario is concrete — a company, a project, dates, numbers, and what each person privately
wants — because a leadership conversation is only practice if the people in it have real
stakes and push back like people do. Mirrors `LEADERSHIP_SCENARIOS` in `src/data/practice.ts`
(ids and labels), kept in step by tests on both sides.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from enum import StrEnum
from typing import Any


class Scenario(StrEnum):
    MOTIVATE = "motivate"
    CONFLICT = "conflict"
    CRISIS = "crisis"
    DELEGATE = "delegate"
    FEEDBACK = "feedback"


@dataclass(frozen=True, slots=True)
class TeamMember:
    """One of the user's direct reports, on camera in the call."""

    key: str
    name: str
    role: str
    #: Gemini Live voice; also the text-to-speech voice when they speak through a hand-over.
    voice: str
    #: Their face on the LiveTalking server, made for a call tile: 640x360, framed like a webcam
    #: (`infra/livetalking/recordings/leadership/`). Three faces stream at once on a call, and at
    #: full 1280x720 the server could not keep all three at 25 fps, so their voices broke up.
    avatar_id: str
    #: Who they are, in general, for the model to play them consistently.
    persona: str

    @property
    def first_name(self) -> str:
        return self.name.split()[0]


#: The same three people in every scenario, so the user leads a team, not a cast of strangers.
TEAM: tuple[TeamMember, ...] = (
    TeamMember(
        "laura", "Laura Bennett", "Senior Product Designer", "Gacrux", "ld_laura",
        "Eight years at the company, the most experienced person on the team. Calm, precise, respected; "
        "quietly protective of quality and of her evenings. Says no politely but clearly.",
    ),
    TeamMember(
        "marcus", "Marcus Hale", "Engineering Lead", "Sadaltager", "ld_marcus",
        "Twenty years in software, the oldest on the team, dry humour. Pragmatic, blunt about risk, "
        "suspicious of deadlines set without asking engineering. Loyal once he trusts you.",
    ),
    TeamMember(
        "nadia", "Nadia Karim", "Marketing Specialist", "Aoede", "ld_nadia",
        "Two years in, ambitious and quick, eager to be given real ownership. Takes criticism hard in the "
        "moment, but acts on it. Talks fast when nervous.",
    ),
)

TEAM_BY_KEY = {m.key: m for m in TEAM}


@dataclass(frozen=True, slots=True)
class Brief:
    scenario: Scenario
    label: str
    #: What happened, with the facts every person on the call knows.
    situation: str
    #: What each team member privately thinks and wants in this scenario (key -> note).
    stances: dict[str, str]
    #: Who speaks most: the model plays them in its own voice, the others through hand-overs.
    lead: str
    #: How the call starts: who speaks first and what they say, in substance.
    opening: str
    #: What a strong leader would get done in this conversation (internal, for play and feedback).
    success: str


BRIEFS: dict[Scenario, Brief] = {
    Scenario.MOTIVATE: Brief(
        Scenario.MOTIVATE, "Motivate people",
        "Monday morning stand-up at Northwind, a 40-person SaaS company. The team's 'Checkout 2.0' launch "
        "slipped for the second time last Friday (from 1 to 15 then to 29 October) after the CEO added a "
        "late requirement. Sprint velocity has dropped from 34 to 21 points over three sprints, two retros "
        "were cancelled, and people have stopped turning cameras on until today.",
        {
            "laura": "Tired rather than angry. Feels the team keeps redoing work because decisions change; "
                     "wants the leader to protect scope, not give a pep talk.",
            "marcus": "Cynical: 'another date we didn't choose'. Will only engage if the leader admits what "
                      "went wrong and commits to something concrete about how deadlines get set.",
            "nadia": "Deflated because her launch campaign was pulled twice; quietly wondering whether to look "
                     "for another job. Brightens up if she is given something she can own.",
        },
        lead="marcus",
        opening="Marcus, once the leader has opened the call, answers the first question with a flat, slightly "
                "sarcastic line about the new date; the others stay quiet unless asked.",
        success="Acknowledges the setbacks honestly, listens before fixing, ties the work to a purpose, makes one "
                "concrete commitment (e.g. how scope changes will be handled), and gives each person something "
                "they own.",
    ),
    Scenario.CONFLICT: Brief(
        Scenario.CONFLICT, "Manage conflict",
        "Laura and Nadia have clashed for two weeks over the new pricing page. Nadia shipped copy and a hero "
        "image to production on Thursday at 16:00 without design review because a campaign email to 12,000 "
        "customers was going out; Laura rolled it back on Friday at 09:15, and the #launch Slack thread "
        "(40 replies) got sharp in front of the whole company. The "
        "leader has called this video call with both of them; Marcus is on it because engineering does the "
        "releases and was caught in the middle.",
        {
            "laura": "Feels her role was bypassed and the quality bar ignored; wants a clear rule that nothing "
                     "ships without review. Hurt that Nadia called her 'a bottleneck' in public.",
            "nadia": "Feels she is always blocked waiting for design and was trying to hit a date the leader "
                     "set; embarrassed by the rollback in front of everyone. Defensive at first.",
            "marcus": "Neutral but fed up with being asked to deploy and revert; wants one agreed release "
                      "process and will say so if asked.",
        },
        lead="laura",
        opening="Laura speaks first once the leader opens, stiffly, restating why she rolled the page back; "
                "Nadia cuts in to defend herself within the first minute.",
        success="Stays neutral, lets each side be heard without interruption, separates facts from feelings, "
                "gets both to agree on a shared goal and a concrete working agreement (review SLA, release "
                "process), and addresses the public Slack exchange.",
    ),
    Scenario.CRISIS: Brief(
        Scenario.CRISIS, "Handle a crisis",
        "Emergency call at 09:40. Since the 08:00 release, about 12% of card payments at checkout have been "
        "failing (error 502 from the payment provider); support has 140 open tickets, two enterprise "
        "customers (Halden Retail and Brightway) have escalated, and the CEO is asking for an update by 10:30. "
        "Rolling back is possible but would also remove a security fix that shipped in the same release.",
        {
            "marcus": "Knows the most: suspects a timeout change in the release. Wants to try a targeted fix "
                      "(20-30 minutes) rather than roll back and lose the security patch. Stressed, terse.",
            "laura": "Handles the status page and customer comms; needs a decision on what to tell customers "
                     "and when. Worried about promising a time.",
            "nadia": "Monitoring social media: complaints are starting to trend. Wants to post something now; "
                     "unsure if she's allowed.",
        },
        lead="marcus",
        opening="Marcus gives a quick, stressed status as soon as the leader opens the call: what is failing, "
                "since when, his suspicion, and the rollback trade-off. He ends by asking what the leader wants "
                "to do.",
        success="Stays calm, gets the key facts fast, makes a clear decision with a time box and a fallback, "
                "assigns owners (fix, comms, social, CEO update), sets the next check-in time, and communicates "
                "honestly without blame.",
    ),
    Scenario.DELEGATE: Brief(
        Scenario.DELEGATE, "Delegate, goals & expectations",
        "Quarterly planning call. The leader must hand over three pieces of work for Q4: owning the customer "
        "onboarding redesign (target: cut time-to-first-value from 9 days to 5 by 15 December), running the "
        "vendor evaluation for a new analytics tool (decision by 30 November, budget 18,000 per year), and "
        "writing the team's OKRs draft by Friday. Laura is at capacity; Nadia wants a bigger role; Marcus "
        "prefers technical work.",
        {
            "laura": "Already carrying two projects; will accept more only if something comes off her plate, "
                     "and will ask exactly that.",
            "nadia": "Wants the onboarding redesign badly and will push for it; lacks experience with "
                     "cross-team projects and needs support she won't ask for.",
            "marcus": "Happy to take the vendor evaluation if he can decide the technical criteria; dislikes "
                      "vague success measures and will ask 'what does done look like?'.",
        },
        lead="nadia",
        opening="Nadia jumps in first after the leader opens, eager, asking whether the onboarding project is "
                "up for grabs.",
        success="Matches work to people deliberately, states outcomes, deadlines and success measures clearly, "
                "agrees the level of autonomy and check-ins, handles Laura's capacity honestly, and confirms "
                "understanding rather than assuming it.",
    ),
    Scenario.FEEDBACK: Brief(
        Scenario.FEEDBACK, "Give feedback",
        "One-to-one video call, with Marcus. Over the last month he has missed three code reviews "
        "(one left open for 4 days, blocking Nadia's release on 12 September), and in Tuesday's planning "
        "meeting he dismissed Nadia's idea with 'that's not how real products work', in front of the team. "
        "His technical work is still excellent. The leader has asked for this call; Laura and Nadia are not "
        "on it.",
        {
            "marcus": "Knows he's been short with people; is burnt out from on-call weeks nobody noticed. Will "
                      "get defensive if feedback sounds vague or like a character judgement, and will open up "
                      "if the leader is specific and asks what's going on.",
            "laura": "Not on this call.",
            "nadia": "Not on this call.",
        },
        lead="marcus",
        opening="Marcus joins a little guarded, asks what the call is about.",
        success="Gives specific, behaviour-based feedback with impact (e.g. SBI), listens and asks about his "
                "side, separates the work quality from the behaviour, agrees concrete changes and support, and "
                "keeps his dignity intact.",
    ),
}

@dataclass(frozen=True, slots=True)
class ManagerBrief:
    """What the manager knows walking into the call — never what anyone privately thinks."""

    #: Your goal for this meeting, in one or two sentences.
    goal: str
    #: What you have noticed about each person on the call (key -> note).
    noticed: dict[str, str]


MANAGER_BRIEFS: dict[Scenario, ManagerBrief] = {
    Scenario.MOTIVATE: ManagerBrief(
        "Get the team re-engaged after the second slip: understand what is weighing on them and leave with a "
        "plan they believe in for the 29 October launch.",
        {
            "laura": "Has redone the checkout designs three times this quarter; unusually quiet in the last retro.",
            "marcus": "Pushed back hard in Slack when the new date was announced without engineering.",
            "nadia": "Her launch campaign was pulled twice; she has not posted in the team channel for a week.",
        },
    ),
    Scenario.CONFLICT: ManagerBrief(
        "Resolve the clash between Laura and Nadia so they can work together again, agree how work gets "
        "reviewed and released, and deal with how it played out in public.",
        {
            "laura": "Rolled the pricing page back on Friday morning; called it 'unreviewed work' in the thread.",
            "nadia": "Shipped the page to meet the campaign date you set; called design 'a bottleneck' in public.",
            "marcus": "Engineering deployed and then reverted the page within 18 hours.",
        },
    ),
    Scenario.CRISIS: ManagerBrief(
        "Get payments working again and keep customers and the CEO informed: decide between a fix and a "
        "rollback, give everyone a clear job, and have an update ready for 10:30.",
        {
            "marcus": "Leads the release; his team shipped the 08:00 change that includes a security fix.",
            "laura": "Owns the status page and customer messages today.",
            "nadia": "Watches social media and the community forum.",
        },
    ),
    Scenario.DELEGATE: ManagerBrief(
        "Hand out the three Q4 pieces of work — onboarding redesign, analytics vendor evaluation, OKR draft — "
        "to the right people, with clear outcomes, deadlines and how you will check in.",
        {
            "laura": "Already leading two projects; delivers reliably.",
            "nadia": "Asked you last month for 'something bigger to own'; has not led a cross-team project yet.",
            "marcus": "Strong on technical evaluations; tends to ask for precise success criteria.",
        },
    ),
    Scenario.FEEDBACK: ManagerBrief(
        "Tell Marcus clearly what has to change — the missed reviews and the comment to Nadia — understand "
        "what is behind it, and agree on next steps, without losing a strong engineer.",
        {
            "marcus": "Missed three code reviews this month; dismissed Nadia's idea in Tuesday's planning; his "
                      "technical work is still excellent. He was on call two of the last four weeks.",
            "laura": "Not on this call.",
            "nadia": "Not on this call.",
        },
    ),
}


#: The full simulation runs several of these in one team call, as things come up.
FULL_SEQUENCE: tuple[Scenario, ...] = (Scenario.MOTIVATE, Scenario.DELEGATE, Scenario.CONFLICT)


@dataclass(frozen=True, slots=True)
class World:
    """Where the call happens: the company, what each person does there, and the situations.

    Written for the user's own field when they set the call up (`world.write_world`) — a scenario
    only teaches if it is the user's kind of work — and kept with the session, so the live team,
    the briefing and the feedback all use the same one. The hand-written product team is the default.
    """

    #: One sentence, to the manager: the company and the team they manage.
    company: str
    #: What each person does here (key -> role title).
    roles: dict[str, str]
    briefs: dict[Scenario, Brief]
    manager: dict[Scenario, ManagerBrief]

    def on_call(self, scenario: Scenario | None) -> tuple[TeamMember, ...]:
        return tuple(replace(m, role=self.roles.get(m.key, m.role)) for m in on_call(scenario))

    def to_doc(self) -> dict[str, Any]:
        return {
            "company": self.company,
            "roles": dict(self.roles),
            "briefs": {
                s.value: {"situation": b.situation, "stances": dict(b.stances), "opening": b.opening,
                          "success": b.success, "goal": self.manager[s].goal, "noticed": dict(self.manager[s].noticed)}
                for s, b in self.briefs.items()
            },
        }

    @classmethod
    def from_doc(cls, doc: dict[str, Any]) -> World:
        """A stored world, filled in from the default wherever it is missing something."""
        briefs, manager = dict(BRIEFS), dict(MANAGER_BRIEFS)
        for value, b in (doc.get("briefs") or {}).items():
            scenario = parse_scenario(value)
            if scenario is None or not isinstance(b, dict):
                continue
            base = BRIEFS[scenario]
            briefs[scenario] = replace(
                base,
                situation=str(b.get("situation") or base.situation),
                stances={k: str((b.get("stances") or {}).get(k) or base.stances[k]) for k in base.stances},
                opening=str(b.get("opening") or base.opening),
                success=str(b.get("success") or base.success),
            )
            m = MANAGER_BRIEFS[scenario]
            manager[scenario] = ManagerBrief(
                str(b.get("goal") or m.goal),
                {k: str((b.get("noticed") or {}).get(k) or m.noticed[k]) for k in m.noticed},
            )
        roles = {m.key: str((doc.get("roles") or {}).get(m.key) or m.role) for m in TEAM}
        return cls(str(doc.get("company") or DEFAULT_WORLD.company), roles, briefs, manager)


DEFAULT_WORLD = World(
    "Northwind, a 40-person SaaS company. You manage its product team.",
    {m.key: m.role for m in TEAM},
    dict(BRIEFS),
    dict(MANAGER_BRIEFS),
)


def world_of(context: dict[str, Any]) -> World:
    doc = context.get("world")
    return World.from_doc(doc) if isinstance(doc, dict) else DEFAULT_WORLD


def scenario_of(context: dict[str, Any]) -> Scenario | None:
    return parse_scenario(context.get("scenario")) if context.get("mode") == "scenario" else None


def briefing(scenario: Scenario | None, world: World = DEFAULT_WORLD) -> dict[str, object]:
    """The manager's pre-read for the call, shown before they join."""
    members = world.on_call(scenario)
    shown = [scenario] if scenario else list(FULL_SEQUENCE)
    return {
        "title": BRIEFS[scenario].label if scenario else "Weekly team call",
        "company": world.company,
        "situations": [
            {"label": BRIEFS[s].label, "whatHappened": world.briefs[s].situation, "yourGoal": world.manager[s].goal}
            for s in shown
        ],
        "people": [
            {"name": m.name, "role": m.role,
             "noticed": " ".join(world.manager[s].noticed[m.key] for s in shown
                                 if world.manager[s].noticed[m.key] != "Not on this call.")}
            for m in members
        ],
        "format": ("One-to-one video call." if len(members) == 1 else
                   "Video call with your team. You called the meeting: open it when you join."),
    }


def parse_scenario(value: str | None) -> Scenario | None:
    try:
        return Scenario(str(value))
    except ValueError:
        return None


def on_call(scenario: Scenario | None) -> tuple[TeamMember, ...]:
    """Who is in the call: the lead of that scenario first. A one-to-one has just that person."""
    if scenario is Scenario.FEEDBACK:
        return (TEAM_BY_KEY["marcus"],)
    lead = BRIEFS[scenario].lead if scenario else "marcus"
    return (TEAM_BY_KEY[lead], *(m for m in TEAM if m.key != lead))
