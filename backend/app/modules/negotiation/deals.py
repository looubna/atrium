"""Who the user negotiates with, and what is on the table.

Seven situations (`Scenario`), mirrored by `NEGOTIATION_SCENARIOS` in `src/data/practice.ts`. Each
is concrete — an organisation, figures, dates — and gives the other side a private target, a limit
it will not cross, the interests behind its position and what it can trade, because a negotiation
is only practice if the other side has real reasons to hold firm and real room to move.

The faces are the sales cast (`infra/livetalking/recordings/sales/`), in new roles: a one-to-one is
Claire; a group is Robert, who leads, with Priya and Kevin. These hand-written deals are the default;
when the user describes their own situation the deal is rewritten for it (`world.write_deal`).
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from enum import StrEnum
from typing import Any


class Scenario(StrEnum):
    SALARY = "salary"
    PRICE = "price"
    CONTRACT = "contract"
    DEADLINE = "deadline"
    SCOPE = "scope"
    PARTNERSHIP = "partnership"
    OTHER = "other"


LABELS: dict[Scenario, str] = {
    Scenario.SALARY: "Salary",
    Scenario.PRICE: "Price negotiation",
    Scenario.CONTRACT: "Contract negotiation",
    Scenario.DEADLINE: "Deadline negotiation",
    Scenario.SCOPE: "Scope negotiation",
    Scenario.PARTNERSHIP: "Business partnership",
    Scenario.OTHER: "Other",
}


@dataclass(frozen=True, slots=True)
class Person:
    """Someone across the table. Their name, voice and face stay the same; their job is the deal's."""

    key: str
    name: str
    #: Gemini Live voice; also the text-to-speech voice when they speak through a hand-over.
    voice: str
    #: Who they are as a negotiator, for the model to play them consistently.
    persona: str
    role: str = ""

    @property
    def first_name(self) -> str:
        return self.name.split()[0]


SOLO = Person(
    "claire", "Claire Donovan", "Despina",
    "Early forties, experienced and direct. Friendly but firm; knows her numbers and her limits. Rewards "
    "preparation, clear reasons and creative options; hardens against pressure, bluffing or ultimatums.",
)

GROUP: tuple[Person, ...] = (
    Person(
        "robert", "Robert Lindqvist", "Algieba",
        "Late fifties, senior, courteous and hard to read. Chairs the meeting and has the final say; moves only "
        "for a solid case and never in the first offer.",
    ),
    Person(
        "priya", "Priya Raman", "Autonoe",
        "Late thirties, precise and numbers-first. Tests every figure, anchors firmly, and trades rather than "
        "gives.",
    ),
    Person(
        "kevin", "Kevin Zhou", "Achird",
        "Around thirty, practical and warmer than the others. Cares about how things will work day to day; "
        "sometimes signals where there is room.",
    ),
)

PEOPLE = {p.key: p for p in (SOLO, *GROUP)}


def people_for(group: bool) -> tuple[Person, ...]:
    """Who is across the table, the one who leads first."""
    return GROUP if group else (SOLO,)


@dataclass(frozen=True, slots=True)
class Deal:
    scenario: Scenario
    #: To the user, one sentence: who they are in this negotiation.
    you: str
    #: The other side's organisation, by name.
    org: str
    #: One sentence on it.
    about: str
    #: The facts both sides know.
    situation: str
    #: The user's own side, to them: what they want, their walk-away point and their alternatives.
    position: str
    #: What each person privately wants, can give, will not cross, and how they will play it (key -> note).
    #: Never shown to the user.
    stances: dict[str, str]
    #: How the meeting starts.
    opening: str
    #: What a strong negotiator gets out of it (internal, for play and feedback).
    success: str
    #: The user's goal, to them.
    goal: str
    #: What the user knows about each person (key -> note): facts only.
    known: dict[str, str]
    #: Each person's job in this deal (key -> title).
    roles: dict[str, str]

    def people(self, group: bool) -> tuple[Person, ...]:
        return tuple(replace(p, role=self.roles.get(p.key, p.role)) for p in people_for(group))

    def to_doc(self) -> dict[str, Any]:
        return {
            "you": self.you, "org": self.org, "about": self.about, "situation": self.situation,
            "position": self.position, "stances": dict(self.stances), "opening": self.opening,
            "success": self.success, "goal": self.goal, "known": dict(self.known), "roles": dict(self.roles),
        }

    @classmethod
    def from_doc(cls, scenario: Scenario, doc: dict[str, Any]) -> Deal:
        """A stored deal, filled in from the default wherever it is missing something."""
        base = DEALS[scenario]

        def text(field: str) -> str:
            return str(doc.get(field) or getattr(base, field))

        def per_person(field: str) -> dict[str, str]:
            given = doc.get(field) or {}
            return {k: str(given.get(k) or v) for k, v in getattr(base, field).items()}

        return cls(
            scenario, text("you"), text("org"), text("about"), text("situation"), text("position"),
            per_person("stances"), text("opening"), text("success"), text("goal"), per_person("known"),
            per_person("roles"),
        )


def _deal(scenario: Scenario, you: str, org: str, about: str, situation: str, position: str,
          stances: dict[str, str], opening: str, success: str, goal: str, known: dict[str, str],
          roles: dict[str, str]) -> Deal:
    return Deal(scenario, you, org, about, situation, position, stances, opening, success, goal, known, roles)


DEALS: dict[Scenario, Deal] = {
    Scenario.SALARY: _deal(
        Scenario.SALARY,
        "You have been offered the job of Senior Product Analyst at Veridian Health Tech.",
        "Veridian Health Tech", "Veridian Health Tech, a 600-person digital health company.",
        "The written offer: €72,000 base salary, a 10% bonus target, 25 days of leave, start on 1 November. "
        "This meeting is to go through it before you sign.",
        "You want €82,000. Market data for the role in this city is €76,000 to €85,000. You would walk away "
        "below €75,000. You are in the final round with a bank for a role around €78,000, but have no offer yet.",
        {
            "claire": "The band goes up to €80,000 base; above €77,000 she needs her VP's approval, which she "
                      "would rather not ask for. Can also give: a sign-on bonus up to €5,000, 3 more days of leave, "
                      "2 remote days a week, €2,000 a year of training. Wants the start date of 1 November and "
                      "does not want to break the team's pay structure. Pushes back on 'the market' without "
                      "numbers; moves for specific evidence and for trades.",
            "robert": "VP who signs off. Hard ceiling €80,000 base; prefers one-off money (sign-on) to base. "
                      "Wants a decision this week.",
            "priya": "HR business partner. Guards the salary band and equity with the team; flexible on sign-on "
                     "bonus, leave and remote days.",
            "kevin": "The team lead the user would work with. Wants them to join and says so; not about money, "
                     "but will mention the team needs them by November.",
        },
        "The hiring manager thanks them for coming in, says the team is delighted, and asks what they wanted "
        "to talk through in the offer.",
        "Anchors with a justified number, asks what flexibility exists before conceding, trades (base against "
        "sign-on, leave, remote, training) rather than splitting the difference, uses the other process "
        "honestly without bluffing, and closes on a clear written package.",
        "Raise the package towards €82,000 in value, and leave with a clear, agreed offer.",
        {
            "claire": "Head of Analytics, your future manager. Interviewed you twice and pushed for your hire.",
            "robert": "VP of Data. Signs off offers above the standard band.",
            "priya": "HR business partner who drafted the offer.",
            "kevin": "Team lead of the analytics squad you would join.",
        },
        {"claire": "Head of Analytics", "robert": "VP of Data", "priya": "HR Business Partner",
         "kevin": "Analytics Team Lead"},
    ),
    Scenario.PRICE: _deal(
        Scenario.PRICE,
        "You are the account manager at Brightline Packaging, renewing an annual contract with a client.",
        "Harvest & Co", "Harvest & Co, an organic food brand selling in 1,200 shops.",
        "The packaging contract is €240,000 a year and ends on 31 December. You have proposed €262,000 (+9%) "
        "because board and ink costs rose 14% this year. Last year you delivered 99% of orders on time.",
        "Your floor is €250,000. You can offer a 2- or 3-year term, volume tiers, faster delivery, or a small "
        "discount for 30-day payment. Losing the account would cost you your biggest client in the region.",
        {
            "claire": "Target: stay at €240,000. Can accept up to €252,000, more only for a multi-year lock or "
                      "better payment terms (she needs 60 days). Has a competitor quote at €225,000, but with a "
                      "6-week lead time and worse quality; she values Brightline's reliability and will not say "
                      "so first. Anchors hard, uses the competitor quote early, and needs a 'win' to show her CFO.",
            "robert": "CFO. Has a 5% cost-cutting target for the year; will accept a higher price only with "
                      "something to show for it (term, payment days).",
            "priya": "Head of Procurement. Leads the numbers and the competitor quote; tough but fair.",
            "kevin": "Operations manager. Afraid of switching suppliers before the spring launch; lets slip "
                     "that reliability matters.",
        },
        "The client says they have looked at the proposal and that 9% is a lot this year.",
        "Justifies the price with the cost increase, explores what the client values before discounting, "
        "trades price for term, volume or payment terms, never drops below the floor, and closes on a clear figure.",
        "Renew the contract at €250,000 or more, trading only for things that are worth it to you.",
        {
            "claire": "Procurement Director. Negotiated last year's contract; known as tough but loyal.",
            "robert": "CFO of Harvest & Co.",
            "priya": "Head of Procurement.",
            "kevin": "Operations Manager, who deals with your delivery team every week.",
        },
        {"claire": "Procurement Director", "robert": "CFO", "priya": "Head of Procurement",
         "kevin": "Operations Manager"},
    ),
    Scenario.CONTRACT: _deal(
        Scenario.CONTRACT,
        "You are a partner at Northfold Studio, a design agency, about to sign a 12-month retainer.",
        "Lumen Fitness", "Lumen Fitness, a chain of 45 gyms.",
        "A retainer of €9,000 a month for brand and campaign design. Their draft contract says: unlimited "
        "revisions, payment at 90 days, all rights transferred on signing, termination at 7 days' notice, and "
        "unlimited liability.",
        "Must-haves: rights transfer on payment, payment within 30 days, 30 days' notice. Nice to have: three "
        "rounds of revisions per piece, liability capped at the contract value. You can live with 45-day payment.",
        {
            "claire": "90-day payment is company policy, but finance allows 45 days for 'strategic suppliers'. "
                      "Rights on payment is fine if asked properly. Wants to be able to leave early: will accept "
                      "30 days' notice after a 3-month minimum. Cares most about revisions — the last agency was "
                      "slow — and will trade on the rest to keep them generous. Liability: legal insists on a cap "
                      "of at least twice the contract value.",
            "robert": "General Counsel. Owns liability and rights; reasonable if given standard language.",
            "priya": "Head of Marketing. Wants speed and revisions; the reason the contract exists.",
            "kevin": "Finance Manager. Owns the payment terms; can do 45 days for strategic suppliers.",
        },
        "The client says they are keen to get started next month and asks if the contract is ready to sign.",
        "Separates must-haves from nice-to-haves, asks why each clause matters to them, trades revisions for "
        "payment and rights terms, proposes concrete wording, and ends with every open clause agreed.",
        "Get rights on payment, payment within 45 days at most and 30 days' notice, without losing the retainer.",
        {
            "claire": "Head of Marketing at Lumen Fitness; signed with you after a pitch in September.",
            "robert": "General Counsel of Lumen Fitness.",
            "priya": "Head of Marketing.",
            "kevin": "Finance Manager.",
        },
        {"claire": "Head of Marketing", "robert": "General Counsel", "priya": "Head of Marketing",
         "kevin": "Finance Manager"},
    ),
    Scenario.DEADLINE: _deal(
        Scenario.DEADLINE,
        "You lead a team of four engineers building a new customer portal.",
        "Your company", "Your own company: a 300-person software firm.",
        "The portal is planned for 15 December. Your manager now asks for 15 November: the CEO promised a big "
        "client, Orbis Bank, a demo. Your team did two weekend releases last month.",
        "Full delivery before 15 December is not realistic. By 15 November you could deliver login and the "
        "billing view if analytics and single sign-on move to December and you get one contractor. You will "
        "not ask the team for more weekends.",
        {
            "claire": "The real need is a working demo for Orbis Bank on 18 November, not a full launch — she "
                      "will only say so if asked what the date is for. Can get €15,000 for a contractor and can "
                      "pause a lower-priority project. Will not move the demo. Responds well to options with "
                      "trade-offs; gets defensive at a flat 'impossible'.",
            "robert": "VP of Sales who made the promise to Orbis. Wants a yes; needs a demo that impresses.",
            "priya": "Director of Product, the user's manager. Wants a plan she can defend upwards.",
            "kevin": "QA lead. Worried about quality; supports a smaller scope done properly.",
        },
        "The manager says the CEO needs the portal by 15 November and asks if the team can make it.",
        "Asks what the date is really for, proposes a scoped demo instead of refusing, asks for the "
        "contractor and a paused project in exchange, protects the team, and agrees a written plan.",
        "Agree a plan for mid-November that the team can deliver without weekends.",
        {
            "claire": "Director of Product, your manager for two years; under pressure from the CEO.",
            "robert": "VP of Sales, who promised Orbis the demo.",
            "priya": "Director of Product, your manager.",
            "kevin": "QA lead on the portal.",
        },
        {"claire": "Director of Product (your manager)", "robert": "VP of Sales", "priya": "Director of Product",
         "kevin": "QA Lead"},
    ),
    Scenario.SCOPE: _deal(
        Scenario.SCOPE,
        "You are the project lead at Kestrel Digital, building a booking app for a client on a fixed price.",
        "Meridian Clinics", "Meridian Clinics, a group of 18 private clinics.",
        "Fixed price €120,000, 60% done, launch planned for March. The client now asks to add online payments "
        "and three languages 'within the current budget'. Specification v2.1, section 4, excludes payments.",
        "Your estimate for both: €28,000 and 5 extra weeks. You can phase the work, or drop to one feature, "
        "but you will not absorb the cost: the project margin is already only 12%.",
        {
            "claire": "Promised her board a March launch with payments. Budget is fixed this year, but she has "
                      "€15,000 in a separate innovation budget. Could move the languages to a second phase. "
                      "Will claim payments were 'implied' in the original scope, and give way if shown section 4.",
            "robert": "COO, owns the budget; firm on 'no more money' until shown the specification.",
            "priya": "Head of Digital; promised the board payments.",
            "kevin": "IT manager; knows payments need a security review that takes 3 weeks anyway.",
        },
        "The client says the board expects payments at launch and asks how the team will fit it in.",
        "Refers to the agreed scope calmly, separates the two requests, offers phased options with prices, "
        "finds the separate budget, and closes on a signed change request.",
        "Add the work only with extra budget or a later date, and leave with a change request both sides accept.",
        {
            "claire": "Head of Digital at Meridian; your day-to-day client contact.",
            "robert": "COO of Meridian Clinics.",
            "priya": "Head of Digital.",
            "kevin": "IT Manager.",
        },
        {"claire": "Head of Digital", "robert": "COO", "priya": "Head of Digital", "kevin": "IT Manager"},
    ),
    Scenario.PARTNERSHIP: _deal(
        Scenario.PARTNERSHIP,
        "You are a co-founder of Tidewave, a meal-kit startup with 40,000 subscribers.",
        "FreshMart", "FreshMart, a supermarket chain with 320 stores.",
        "The idea: Tidewave meal kits sold in FreshMart stores, co-branded. You proposed 45% of revenue to "
        "Tidewave with FreshMart handling logistics. FreshMart answered: 25% to Tidewave, Tidewave pays for "
        "marketing, and 3 years of exclusivity.",
        "You would walk away below 35%, or with exclusivity longer than 18 months. You can put €30,000 into "
        "launch marketing and share sales data.",
        {
            "claire": "Can go to 38% if Tidewave co-funds launch marketing (€50,000). Wants exclusivity because a "
                      "competitor, HelloBowl, approached them; would accept shorter exclusivity with performance "
                      "targets. Her hidden priority is customer data sharing, which she will trade a lot for.",
            "robert": "Commercial Director. Wants exclusivity and a low share; open to targets.",
            "priya": "Head of Partnerships. Runs the numbers; wants the marketing co-funded.",
            "kevin": "Supply chain lead. Worried about fresh-produce logistics; would rather Tidewave kept them.",
        },
        "The other side says they like the idea, but 45% does not work for them, and asks where the user sees room.",
        "Explores interests behind exclusivity and share, finds the data priority, trades data and marketing "
        "for share and term, keeps to the walk-away points, and closes on the main terms.",
        "Agree at least 35% of revenue and no more than 18 months of exclusivity.",
        {
            "claire": "Head of Partnerships at FreshMart; reached out to you after seeing your growth.",
            "robert": "Commercial Director at FreshMart.",
            "priya": "Head of Partnerships.",
            "kevin": "Supply Chain Lead.",
        },
        {"claire": "Head of Partnerships", "robert": "Commercial Director", "priya": "Head of Partnerships",
         "kevin": "Supply Chain Lead"},
    ),
    Scenario.OTHER: _deal(
        Scenario.OTHER,
        "You are negotiating the situation you described.",
        "The other side", "The other party in your situation.",
        "The situation as you described it.",
        "What you described wanting.",
        {
            "claire": "Has a realistic position opposed to the user's: a target, a limit she will not cross, and "
                      "some things she can give in exchange. Moves only for good reasons and trades.",
            "robert": "Leads the other side; has the final say and a firm limit.",
            "priya": "Tests the numbers and facts.",
            "kevin": "Practical; cares about how it will work in practice.",
        },
        "The other side opens by asking what the user would like to discuss.",
        "States a clear goal with reasons, asks about the other side's interests, trades rather than concedes, "
        "and closes on a clear agreement.",
        "Reach an agreement you are comfortable with.",
        {"claire": "The other party.", "robert": "Leads the other side.", "priya": "The other side.",
         "kevin": "The other side."},
        {"claire": "Counterpart", "robert": "Lead negotiator", "priya": "Negotiator", "kevin": "Negotiator"},
    ),
}


def scenario_of(context: dict[str, Any]) -> Scenario:
    try:
        return Scenario(str(context.get("scenario")))
    except ValueError:
        return Scenario.SALARY


def deal_of(context: dict[str, Any]) -> Deal:
    scenario = scenario_of(context)
    doc = context.get("deal")
    return Deal.from_doc(scenario, doc) if isinstance(doc, dict) else DEALS[scenario]


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
    """The user's pre-read: who they are, the facts, their own position, who is there and the goal."""
    scenario, deal, group = scenario_of(context), deal_of(context), is_group(context)
    people = deal.people(group)
    where = "In person, across the table" if in_person(context) else "A video call"
    who = "with three people from the other side" if group else f"with {people[0].first_name}"
    return {
        "title": LABELS[scenario],
        "you": deal.you,
        "org": deal.org,
        "about": deal.about,
        "situation": deal.situation,
        "position": deal.position,
        "goal": deal.goal,
        "people": [{"name": p.name, "role": p.role, "known": _known(deal.known[p.key], p.role)} for p in people],
        "format": f"{where} {who}.",
    }
