"""What a negotiation is judged on (layer 1 for the negotiation module)."""

from __future__ import annotations

from app.platform.competencies.catalog import Competency, Layer

CATALOG_VERSION = "negotiation-2026-09-24"

_ITEMS: list[tuple[str, str, str]] = [
    ("anchoring", "Opening & anchoring", "States a clear, ambitious, justified first position at the right moment."),
    ("interests", "Uncovering interests", "Asks why the other side wants what it wants, and listens for what matters."),
    ("value", "Creating value", "Finds options and trades that are worth more to one side than they cost the other."),
    ("concessions", "Managing concessions", "Concedes slowly, in small steps, and always for something in return."),
    ("alternatives", "Using alternatives", "Knows their walk-away point and uses real alternatives without bluffing."),
    ("listening", "Active listening", "Lets them finish, summarises what they said, and builds on it."),
    ("assertiveness", "Assertiveness", "Holds firm on what matters and says no clearly and politely."),
    ("composure", "Composure", "Stays calm and constructive under pressure, anchors and tough tactics."),
    ("agreement", "Closing the agreement", "Ends with clear, confirmed terms: who does what, for how much, by when."),
]

NEGOTIATION_COMPETENCIES: dict[str, Competency] = {
    f"negotiation.{slug}": Competency(f"negotiation.{slug}", name, Layer.ROUND, description)
    for slug, name, description in _ITEMS
}


def competencies() -> list[Competency]:
    return list(NEGOTIATION_COMPETENCIES.values())
