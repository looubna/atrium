"""Who the user sells to, and the deal on the table.

Four situations (`SalesType`), mirrored by `SALES_TYPES` in `src/data/practice.ts`: a first
call with a prospect, a pitch or demo to the same buyer further down the funnel, an account
review with her as an existing client, and a pitch to a panel of three investors. Every deal
is concrete — an organisation, numbers, dates, and what each person privately needs to hear —
because a sales conversation is only practice if the buyer has real reasons to say no.

These hand-written deals are the default; when the session is set up they are rewritten for
what the user actually sells (`world.write_deal`) and stored with it.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from enum import StrEnum
from typing import Any


class SalesType(StrEnum):
    OUTREACH = "call-outreach"
    PITCH = "pitch-demo"
    INVESTOR = "investor-pitch"
    ACCOUNT = "account-management"


LABELS: dict[SalesType, str] = {
    SalesType.OUTREACH: "Call outreach",
    SalesType.PITCH: "Sales pitch / demo",
    SalesType.INVESTOR: "Investor pitch",
    SalesType.ACCOUNT: "Account management",
}


@dataclass(frozen=True, slots=True)
class Person:
    """Someone the user sells to, with a face filmed for sales only."""

    key: str
    name: str
    role: str
    #: Gemini Live voice; also the text-to-speech voice when they speak through a hand-over.
    voice: str
    #: Who they are, in general, for the model to play them consistently.
    persona: str

    @property
    def first_name(self) -> str:
        return self.name.split()[0]


BUYER = Person(
    "claire", "Claire Donovan", "Head of Operations", "Despina",
    "Early forties, fifteen years in operations, runs a large team and a tight budget. Direct, busy, "
    "polite; has been burned by a software rollout before and does not trust vendor promises. Warms "
    "up to people who understand her numbers and ask good questions; goes short and cold with pitches.",
)

INVESTORS: tuple[Person, ...] = (
    Person(
        "robert", "Robert Lindqvist", "Managing Partner", "Algieba",
        "Late fifties, twenty years investing, chairs the meeting. Courteous, unhurried, hard to read. "
        "Backs founders more than slides: wants to know why this team, why now, and how big it can get.",
    ),
    Person(
        "priya", "Priya Raman", "Partner", "Autonoe",
        "Late thirties, former operator turned investor, lives in the metrics. Precise, friendly, "
        "relentless on unit economics: churn, payback, burn. Notices when numbers do not add up.",
    ),
    Person(
        "kevin", "Kevin Zhou", "Associate", "Achird",
        "Around thirty, did the diligence: called customers and mapped the competition. Polite, "
        "well-prepared, asks the pointed question about competitors and what a customer told him.",
    ),
)

PEOPLE = {p.key: p for p in (BUYER, *INVESTORS)}


def people_for(kind: SalesType) -> tuple[Person, ...]:
    """Who is on the other side, the one who leads first."""
    return INVESTORS if kind is SalesType.INVESTOR else (BUYER,)


@dataclass(frozen=True, slots=True)
class Deal:
    kind: SalesType
    #: To the user, one sentence: who they are and what they sell ("You are an account executive at ...").
    seller: str
    #: The organisation on the other side, by name.
    org: str
    #: One sentence on that organisation.
    about: str
    #: The facts both sides know before the conversation.
    situation: str
    #: What each person privately needs, fears and will object to (key -> note). Never shown to the user.
    stances: dict[str, str]
    #: How the conversation starts.
    opening: str
    #: What a strong seller gets done (internal, for play and feedback).
    success: str
    #: The user's goal for the conversation, to them.
    goal: str
    #: What the user's research says about each person (key -> note): facts only.
    known: dict[str, str]
    #: Each person's job title at `org` (key -> title).
    roles: dict[str, str]

    def people(self) -> tuple[Person, ...]:
        return tuple(replace(p, role=self.roles.get(p.key, p.role)) for p in people_for(self.kind))

    def to_doc(self) -> dict[str, Any]:
        return {
            "seller": self.seller, "org": self.org, "about": self.about, "situation": self.situation,
            "stances": dict(self.stances), "opening": self.opening, "success": self.success,
            "goal": self.goal, "known": dict(self.known), "roles": dict(self.roles),
        }

    @classmethod
    def from_doc(cls, kind: SalesType, doc: dict[str, Any]) -> Deal:
        """A stored deal, filled in from the default wherever it is missing something."""
        base = DEALS[kind]

        def text(field: str) -> str:
            return str(doc.get(field) or getattr(base, field))

        def per_person(field: str) -> dict[str, str]:
            given = doc.get(field) or {}
            return {k: str(given.get(k) or v) for k, v in getattr(base, field).items()}

        return cls(
            kind, text("seller"), text("org"), text("about"), text("situation"), per_person("stances"),
            text("opening"), text("success"), text("goal"), per_person("known"), per_person("roles"),
        )


_SELLER = ("You are an account executive at Relay, a scheduling and dispatch platform for field-service "
           "companies (plumbing, heating, electrical): it plans technicians' routes, books jobs and tracks them live.")
_HARLOW = ("Harlow Home Services, a heating and plumbing company with 320 technicians across four cities "
           "and about 1,900 jobs a week.")

DEALS: dict[SalesType, Deal] = {
    SalesType.OUTREACH: Deal(
        SalesType.OUTREACH, _SELLER, "Harlow Home Services", _HARLOW,
        "A first call. Claire replied to your email last Thursday and accepted a 15-minute call, no promises. "
        "Harlow dispatches with spreadsheets and ServiceTrak, a ten-year-old tool whose contract renews on "
        "31 March. Their job ads mention 'rapid growth' and they opened a fourth city in May.",
        {"claire": "Real pain she will not volunteer: 18% of jobs need a second visit (wrong part, wrong "
                   "technician), and overtime is up 22% since spring. The CFO, Martin, is on her about it. "
                   "Burned by a CRM rollout in 2024 that technicians refused to use; allergic to feature lists. "
                   "Answers short until asked a good question about her operation; opens up if the caller "
                   "is curious and specific. Will only agree to a next meeting if the caller shows they "
                   "understand her problem; says 'send me something' to get rid of a pitch."},
        "Claire picks up: 'Claire Donovan.' Once the caller introduces themselves she is brisk: she has "
        "fifteen minutes, what is this about?",
        "Earns attention in the first thirty seconds with a reason relevant to Harlow, asks open discovery "
        "questions that surface the second-visit rate and the overtime, listens more than talks, does not "
        "demo on the phone, handles 'we already have a tool' and 'send me something' with a question, and "
        "books a concrete next step: a 30-minute call with her and her dispatch lead, with a date and time.",
        "Find out what is costing Harlow money in scheduling, and book a 30-minute follow-up with Claire and "
        "her dispatch lead.",
        {"claire": "Head of Operations at Harlow for three years; posted on LinkedIn in June about "
                   "'fixing first-time fix rates'. Replied to your email with one line: 'Fine, 15 min Tuesday.'"},
        {"claire": "Head of Operations"},
    ),
    SalesType.PITCH: Deal(
        SalesType.PITCH, _SELLER, "Harlow Home Services", _HARLOW,
        "A demo meeting after a good discovery call. You know: 18% of jobs need a second visit, overtime is "
        "up 22%, ServiceTrak renews on 31 March. Your proposal is €84,000 a year for 320 technicians. "
        "Claire has 40 minutes and has said she will take a recommendation to the CFO, Martin, if it stacks up.",
        {"claire": "Her budget in her head is €60,000. Objections she will raise, one at a time, when the "
                   "moment comes: the price; whether it connects to their accounting system (Sage 200); "
                   "whether technicians in their fifties will use an app (the 2024 CRM failed on that); and "
                   "timing, because June to August is peak season and nothing can go live then. Tunes out "
                   "if shown features she did not ask about; leans in when the seller ties things to second "
                   "visits and overtime in euros. Would accept a paid pilot in one city with clear success "
                   "criteria, and a meeting with Martin, if the seller earns it."},
        "Claire joins, says hello, and asks what the seller has for her; she has 40 minutes.",
        "Recaps her problem before showing anything, tailors the demo to second visits and overtime, puts a "
        "number on the cost of the problem (second visits cost Harlow about €1.1 million a year), handles "
        "each objection by asking about it first, does not drop the price without getting something back, "
        "and closes on a concrete next step: a pilot in one city with success criteria, and a date with Martin.",
        "Show Claire how Relay cuts second visits and overtime, handle her objections, and agree a pilot "
        "and a meeting with the CFO.",
        {"claire": "In discovery she said: 'If you can get second visits under 10%, I can sell it to Martin.' "
                   "She mentioned Sage 200 in passing and that 'the guys hate new apps'."},
        {"claire": "Head of Operations"},
    ),
    SalesType.ACCOUNT: Deal(
        SalesType.ACCOUNT, _SELLER.replace("an account executive", "the account manager"),
        "Harlow Home Services", _HARLOW,
        "A quarterly business review with a client of 14 months (€84,000 a year, 320 technicians). The "
        "renewal is due on 30 November, in six weeks. On 12 August Relay had a four-hour dispatch outage on "
        "a Monday morning; in the Leeds region usage has dropped 30% since and dispatchers went back to "
        "spreadsheets. In the other three cities second visits fell from 18% to 11%.",
        {"claire": "Frustrated: the outage cost her a very bad week and she heard about it from her team, not "
                   "from Relay. The CFO asked her to look at a competitor, FieldPro, which offered 25% less. "
                   "She actually likes Relay in the three cities and does not want to switch, but needs a "
                   "credible plan for Leeds and something to show Martin. Will test whether the account "
                   "manager owns the outage or makes excuses. Open to adding the two cities Harlow is "
                   "acquiring in January, but only if the relationship is repaired first; pushing an upsell "
                   "early annoys her."},
        "Claire joins and gets straight to it: before any slides, she wants to talk about August.",
        "Owns the outage without excuses, asks what it cost her and her team, brings the 18% to 11% result "
        "as her team's win, agrees a concrete recovery plan for Leeds (owner, dates, a check-in), handles "
        "the FieldPro comparison on value rather than price, protects the renewal without a big discount, "
        "and only then opens the conversation about the two new cities.",
        "Rebuild Claire's trust after the August outage, secure the November renewal, and open the door to "
        "the two cities Harlow is adding.",
        {"claire": "Your usage data: Leeds down 30% since 12 August; the other cities stable. She has not "
                   "replied to the last two check-in emails. Harlow announced an acquisition of two smaller "
                   "firms, closing in January."},
        {"claire": "Head of Operations"},
    ),
    SalesType.INVESTOR: Deal(
        SalesType.INVESTOR,
        "You are the founder and CEO of Relay, a scheduling and dispatch platform for field-service companies. "
        "You are raising a €2.5 million seed round.",
        "Northlight Ventures", "Northlight Ventures, a €180 million early-stage fund that invests in B2B software.",
        "A first partner meeting, 30 minutes. Relay: €480,000 annual recurring revenue, 42 customers, net "
        "revenue retention 118%, 3 customers lost last quarter, burn €140,000 a month, 9 months of runway, a "
        "team of 11. The raise would fund sales hires and a move into the UK.",
        {
            "robert": "Wants the story: why this team, why now, how big. Thinks field service is crowded "
                      "(ServiceTitan) and will ask what makes this a venture-scale company. Likes founders "
                      "who answer straight and say 'I don't know' when they don't. Chairs: invites the "
                      "founder to start, keeps time, and closes with what happens next.",
            "priya": "Will dig into the three churned customers, CAC payback (she estimates 20 months from "
                     "the deck and thinks that is too long) and why burn went up 40% this year. Warms up to "
                     "a founder who knows their numbers cold; cools on vague answers.",
            "kevin": "Called two customers: one loved it, one said onboarding took four months. Will ask "
                     "about that, about competitors, and what stops a big player from copying Relay.",
        },
        "Robert welcomes the founder, introduces himself and his colleagues in a sentence, and hands them "
        "the floor: 'Take us through it.'",
        "Tells a clear story in two to three minutes (problem, solution, traction, why now, the ask), knows "
        "every number, is honest about the churn and the onboarding problem with what is being done about "
        "it, answers the competition question with evidence, states the ask and the use of funds, and "
        "closes by asking about their process and next step.",
        "Get Northlight to a second meeting: a clear story, every number to hand, and straight answers on "
        "churn, payback and competition.",
        {
            "robert": "Founded Northlight in 2009; led two exits in logistics software.",
            "priya": "Ran operations at a SaaS scale-up before investing; on LinkedIn she writes about unit "
                     "economics.",
            "kevin": "Asked for your customer list last week and said he would 'make a couple of calls'.",
        },
        {"robert": "Managing Partner", "priya": "Partner", "kevin": "Associate"},
    ),
}


def kind_of(context: dict[str, Any]) -> SalesType:
    try:
        return SalesType(str(context.get("type")))
    except ValueError:
        return SalesType.PITCH


def deal_of(context: dict[str, Any]) -> Deal:
    kind = kind_of(context)
    doc = context.get("deal")
    return Deal.from_doc(kind, doc) if isinstance(doc, dict) else DEALS[kind]


def in_person(context: dict[str, Any]) -> bool:
    # `in_person` as stored; `in-person` in sessions made before that spelling was fixed.
    return context.get("mode") in ("in_person", "in-person")


FORMATS: dict[tuple[SalesType, bool], str] = {
    (SalesType.OUTREACH, False): "A video call. She agreed to 15 minutes; you open it.",
    (SalesType.PITCH, False): "A video call with Claire. Share your story, not your screen.",
    (SalesType.PITCH, True): "At the offices of {org}, across the table from Claire.",
    (SalesType.ACCOUNT, False): "A video call with Claire.",
    (SalesType.ACCOUNT, True): "At the offices of {org}, across the table from Claire.",
    (SalesType.INVESTOR, False): "A video call with three people from the fund.",
    (SalesType.INVESTOR, True): "In their boardroom, across the table from three people from the fund.",
}


def briefing(context: dict[str, Any]) -> dict[str, Any]:
    """The seller's pre-read, shown before they join: the deal, who is there, the goal."""
    kind, deal = kind_of(context), deal_of(context)
    return {
        "title": LABELS[kind],
        "seller": deal.seller,
        "org": deal.org,
        "about": deal.about,
        "situation": deal.situation,
        "goal": deal.goal,
        "people": [{"name": p.name, "role": p.role, "known": deal.known[p.key]} for p in deal.people()],
        "format": FORMATS.get((kind, in_person(context)), FORMATS[(kind, False)]).format(org=deal.org),
    }
