"""What a café conversation is judged on (layer 1 for the cafe module), per area."""

from __future__ import annotations

from app.modules.cafe.people import EVERYDAY, STARTING
from app.platform.competencies.catalog import Competency, Layer

CATALOG_VERSION = "cafe-2026-09-25.2"

#: Per area: (slug, name, what doing it well looks like). Ids are `cafe.<area>.<slug>`.
_SKILLS: dict[str, list[tuple[str, str, str]]] = {
    STARTING: [
        ("opener", "A natural opener",
         "Opening with something from the shared moment (the book, the queue, the café) or a simple hello and "
         "name, not a rehearsed line."),
        ("follow_up", "Follow-up questions",
         "Asking about what they just said, so they feel heard, rather than jumping to unrelated questions."),
        ("sharing", "Sharing in return", "Offering something of your own (an opinion, a small story) so it is a "
                                        "conversation, not an interview."),
        ("keeping_flow", "Keeping it going",
         "Handling short answers and silences with a new thread or a deeper question, without giving up."),
        ("close", "A warm close", "Ending well: names, a line that makes the next chat easy, or a natural goodbye."),
    ],
    EVERYDAY: [
        ("clear_point", "Saying it clearly",
         "Saying what you want, think or need plainly and early, not hinting or burying it."),
        ("listening", "Listening", "Questions and acknowledging their side, so they feel heard before you answer."),
        ("firm_calm", "Firm and calm",
         "Holding your position through pushback (guilt, provocation, a brush-off), without caving or attacking."),
        ("next_step", "A clear outcome", "Ending with something concrete: an ask, an agreement or a clear no."),
        ("relationship", "Keeping the relationship", "Warmth and respect that leave them glad they talked to you."),
    ],
}

AREA_COMPETENCIES: dict[str, list[Competency]] = {
    area: [Competency(f"cafe.{area}.{slug}", name, Layer.ROUND, how) for slug, name, how in skills]
    for area, skills in _SKILLS.items()
}

CAFE_COMPETENCIES: dict[str, Competency] = {c.id: c for skills in AREA_COMPETENCIES.values() for c in skills}


def competencies(area: str | None = None) -> list[Competency]:
    """The skills a conversation in this area is judged on; every area's when none is given."""
    if area in AREA_COMPETENCIES:
        return AREA_COMPETENCIES[area]
    return list(CAFE_COMPETENCIES.values())
