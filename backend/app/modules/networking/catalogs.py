"""What a networking conversation is judged on (layer 1 for the networking module)."""

from __future__ import annotations

from app.platform.competencies.catalog import Competency, Layer

CATALOG_VERSION = "networking-2026-09-23"

_ITEMS: list[tuple[str, str, str]] = [
    ("opening", "Opening the conversation", "Joining naturally: a greeting, a name, a reason to talk."),
    ("introduction", "Introducing yourself", "Who you are and what you do, short and memorable."),
    ("curiosity", "Curiosity and questions", "Open questions that get the other person talking about themselves."),
    ("listening", "Active listening", "Building on what they said rather than waiting for a turn."),
    ("common_ground", "Finding common ground", "Spotting shared interests or problems and using them."),
    ("value", "Offering value", "An idea, a contact or help, not only asking for something."),
    ("register", "Reading the room", "Pitching tone and depth to who they are: junior, peer, senior, client."),
    ("follow_up", "Closing with a next step", "A clear, polite exit and a concrete follow-up."),
]

NETWORKING_COMPETENCIES: dict[str, Competency] = {
    f"networking.{slug}": Competency(f"networking.{slug}", name, Layer.ROUND, description)
    for slug, name, description in _ITEMS
}


def competencies() -> list[Competency]:
    return list(NETWORKING_COMPETENCIES.values())
