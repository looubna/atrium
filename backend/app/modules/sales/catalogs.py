"""What a sales conversation is judged on (layer 1 for the sales module)."""

from __future__ import annotations

from app.platform.competencies.catalog import Competency, Layer

CATALOG_VERSION = "sales-2026-09-23"

_ITEMS: list[tuple[str, str, str]] = [
    ("opening", "Opening & rapport", "Earns attention early with a reason that matters to them, and builds trust."),
    ("discovery", "Discovery questions", "Asks open, specific questions that uncover needs, pain and how they decide."),
    ("listening", "Active listening", "Lets them finish, picks up on cues, and uses what they said."),
    ("value", "Value proposition", "Ties what they sell to this buyer's problem, in their numbers, not features."),
    ("objections", "Objection handling", "Explores an objection before answering it, and answers with evidence."),
    ("story", "Pitch structure", "A clear story: problem, solution, proof, and the ask, in the right order."),
    ("numbers", "Command of numbers", "Knows the figures, uses them accurately, and admits what they don't know."),
    ("closing", "Next step & close", "Asks for a concrete commitment: who, what and when."),
    ("composure", "Composure", "Stays calm, confident and honest under pushback and tough questions."),
]

SALES_COMPETENCIES: dict[str, Competency] = {
    f"sales.{slug}": Competency(f"sales.{slug}", name, Layer.ROUND, description)
    for slug, name, description in _ITEMS
}


def competencies() -> list[Competency]:
    return list(SALES_COMPETENCIES.values())
