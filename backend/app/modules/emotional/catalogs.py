"""What an emotional conversation is judged on (layer 1 for the emotional module).

Each situation trains its own skills: comforting someone is not judged like setting a boundary.
A conversation is scored on its situation's skills (`competencies(scenario)`), plus the platform's
communication competencies.
"""

from __future__ import annotations

from app.platform.competencies.catalog import Competency, Layer

CATALOG_VERSION = "emotional-2026-09-24.2"

#: Per situation: (slug, name, what doing it well looks like). Ids are `emotional.<situation>.<slug>`.
_SKILLS: dict[str, list[tuple[str, str, str]]] = {
    "share-feelings": [
        ("name_feeling", "Naming the feeling",
         "Saying the actual feeling in a word or two (hurt, lonely, anxious), not only 'bad' or 'stressed'."),
        ("i_statements", "Speaking from 'I'",
         "'I feel… when…' rather than 'you make me…' or talking in general terms."),
        ("context", "Giving the why",
         "Saying what set it off or how long it has been going on, so the friend can understand."),
        ("staying_open", "Staying with it",
         "Not deflecting with a joke, 'it's nothing' or a change of subject when it gets real."),
        ("ask_for_need", "Asking for what you need",
         "Saying whether you want to be listened to, advised or helped, and steering back when the friend "
         "jumps to fixing."),
    ],
    "comfort": [
        ("validate", "Validating",
         "Acknowledging the feeling as real and understandable ('that sounds really painful') before anything "
         "else."),
        ("open_questions", "Open questions",
         "Asking questions that let them say more ('what was that like?'), not yes/no or leading ones."),
        ("reflect", "Reflecting back",
         "Putting what you heard, and the feeling under it, into your own words so they feel understood."),
        ("no_fixing", "Not rushing to fix",
         "Holding back advice, silver linings and 'at least…' until they have been heard or ask for it."),
        ("pacing", "Pacing and presence", "Letting silences be, not interrupting, not turning it to your own story."),
        ("offer_support", "Offering support",
         "Ending with a concrete, sincere offer ('want to get dinner Friday?'), not a vague 'let me know'."),
    ],
    "apologise": [
        ("clear_apology", "A clear 'I'm sorry'",
         "Apologising early and plainly, without softening it into 'sorry if…'."),
        ("ownership", "Owning it", "Naming exactly what you did, with no excuses and no 'but'."),
        ("impact", "Acknowledging the impact", "Saying how it must have made them feel, and letting them say it."),
        ("no_defensiveness", "Staying undefensive",
         "Taking their anger or 'you always…' without arguing back or explaining it away."),
        ("repair", "Repair", "Saying what you will do differently or how you will make it up, concretely."),
    ],
    "appreciation": [
        ("specific", "Being specific", "Naming concrete moments and things they did, not general praise."),
        ("impact", "Saying what it meant", "How it changed things for you or how it made you feel."),
        ("sincerity", "Sincerity", "Warm, plain, unhurried words; no joking it away."),
        ("persist", "Getting past the deflection",
         "When they brush it off, gently saying it again rather than dropping it."),
    ],
    "boundary": [
        ("clear_request", "A clear request",
         "Saying exactly what needs to change (when, how often, how much), not hinting."),
        ("i_statements", "Speaking from 'I'",
         "Explaining the effect on you ('I'm exhausted at work') without blaming or labelling them."),
        ("empathy", "Kindness while firm",
         "Acknowledging what they are going through while still asking for the change."),
        ("hold_line", "Holding the line",
         "Staying with the boundary through guilt, bargaining and minimising, calmly, without caving or "
         "escalating."),
        ("alternative", "Offering what you can do",
         "Proposing what you can still give (a set time to talk, a repayment plan)."),
    ],
    "disappointment": [
        ("describe_facts", "Describing what happened",
         "Stating the specific behaviour factually, not attacking their character."),
        ("share_impact", "Sharing the impact", "Saying how it made you feel, from 'I'."),
        ("listen", "Listening to their side", "Asking for and hearing their view before concluding."),
        ("calm_under_defence", "Staying calm under defensiveness",
         "Not escalating when they minimise, deny or turn it around."),
        ("next_step", "Agreeing a way forward", "Asking for what you need next time and checking you both agree."),
    ],
}

SCENARIO_COMPETENCIES: dict[str, list[Competency]] = {
    scenario: [Competency(f"emotional.{scenario}.{slug}", name, Layer.ROUND, how) for slug, name, how in skills]
    for scenario, skills in _SKILLS.items()
}

#: Ids from the first version (one list for every situation); kept so old reports still name their scores.
_LEGACY = [
    ("naming_feelings", "Naming feelings"), ("empathy", "Empathy"), ("active_listening", "Active listening"),
    ("ownership", "Ownership"), ("clarity", "Clarity"), ("composure", "Composure"), ("repair", "Repair and next step"),
]

EMOTIONAL_COMPETENCIES: dict[str, Competency] = {
    **{f"emotional.{slug}": Competency(f"emotional.{slug}", name, Layer.ROUND, "") for slug, name in _LEGACY},
    **{c.id: c for skills in SCENARIO_COMPETENCIES.values() for c in skills},
}


def competencies(scenario: str | None = None) -> list[Competency]:
    """The skills a conversation in this situation is judged on; every situation's when none is given."""
    if scenario in SCENARIO_COMPETENCIES:
        return SCENARIO_COMPETENCIES[scenario]
    return [c for skills in SCENARIO_COMPETENCIES.values() for c in skills]
