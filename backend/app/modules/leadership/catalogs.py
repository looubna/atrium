"""What a leadership conversation is judged on (layer 1 for the leadership module)."""

from __future__ import annotations

from app.platform.competencies.catalog import Competency, Layer

CATALOG_VERSION = "leadership-2026-09-23"

_ITEMS: list[tuple[str, str, str]] = [
    ("clarity", "Clear direction", "Says what matters, what is decided and what happens next."),
    ("listening", "Listening", "Lets people finish, asks questions, and uses what they said."),
    ("empathy", "Empathy", "Acknowledges feelings and pressure without losing the point."),
    ("decisions", "Decision-making", "Decides when a decision is needed, with reasons and a fallback."),
    ("accountability", "Accountability", "Owns their part, sets owners and deadlines, follows through."),
    ("fairness", "Fairness", "Stays neutral in conflict, separates facts from interpretations."),
    ("feedback", "Specific feedback", "Names behaviour and impact precisely, not character."),
    ("motivation", "Motivating others", "Connects work to purpose and gives people ownership."),
    ("composure", "Composure", "Stays calm and steady under pressure and pushback."),
]

LEADERSHIP_COMPETENCIES: dict[str, Competency] = {
    f"leadership.{slug}": Competency(f"leadership.{slug}", name, Layer.ROUND, description)
    for slug, name, description in _ITEMS
}


def competencies() -> list[Competency]:
    return list(LEADERSHIP_COMPETENCIES.values())
