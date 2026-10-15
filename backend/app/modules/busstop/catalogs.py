"""What a bus stop conversation is judged on (layer 1 for the busstop module), per area."""

from __future__ import annotations

from app.modules.busstop.people import BOUNDARIES, SMALL_TALK
from app.platform.competencies.catalog import Competency, Layer

CATALOG_VERSION = "busstop-2026-09-27.1"

#: Per area: (slug, name, what doing it well looks like). Ids are `busstop.<area>.<slug>`.
_SKILLS: dict[str, list[tuple[str, str, str]]] = {
    SMALL_TALK: [
        ("opener", "A natural opener",
         "Opening with something from the shared moment (the late bus, the rain, the queue), or answering a "
         "greeting warmly, not with a rehearsed line."),
        ("follow_up", "Follow-up questions",
         "Asking about what they just said, so they feel heard, rather than jumping to unrelated questions."),
        ("sharing", "Sharing in return", "Offering something of your own (your morning, a small story) so it is a "
                                        "conversation, not an interview."),
        ("awkward", "Handling awkward moments",
         "Short answers, silences or a forgotten name handled lightly and honestly, without freezing or faking."),
        ("close", "A warm close",
         "Ending on purpose and kindly: a clear reason, a nice word about the chat, a door left open."),
    ],
    BOUNDARIES: [
        ("clear_point", "Saying it clearly",
         "Saying what you need or won't do plainly and early, not hinting, apologising at length or burying it."),
        ("reason", "Giving a reason", "A short, real reason for a request or a limit, without over-explaining."),
        ("firm_calm", "Firm and calm",
         "Holding your position through pushback (guilt, charm, pretending not to hear), without caving or "
         "attacking."),
        ("outcome", "A clear outcome",
         "Ending with something concrete: the answer you needed, your place kept, or a limit respected."),
        ("courtesy", "Staying courteous", "Politeness and warmth that keep it civil, even while saying no."),
    ],
}

AREA_COMPETENCIES: dict[str, list[Competency]] = {
    area: [Competency(f"busstop.{area}.{slug}", name, Layer.ROUND, how) for slug, name, how in skills]
    for area, skills in _SKILLS.items()
}

BUSSTOP_COMPETENCIES: dict[str, Competency] = {c.id: c for skills in AREA_COMPETENCIES.values() for c in skills}


def competencies(area: str | None = None) -> list[Competency]:
    """The skills a conversation in this area is judged on; every area's when none is given."""
    if area in AREA_COMPETENCIES:
        return AREA_COMPETENCIES[area]
    return list(BUSSTOP_COMPETENCIES.values())
