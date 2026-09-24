"""What a presentation is judged on (layer 1 for the presentation module)."""

from __future__ import annotations

from app.platform.competencies.catalog import Competency, Layer

CATALOG_VERSION = "presentation-2026-09-24"

_ITEMS: list[tuple[str, str, str]] = [
    ("opening", "Strong opening", "Grabs attention and says early what the talk is about and why it matters."),
    ("structure", "Clear structure", "A logical order the audience can follow, with signposts between parts."),
    ("message", "Key message", "One clear main message, repeated and landed, not lost in detail."),
    ("evidence", "Evidence & examples", "Backs claims with data, examples or stories the audience can relate to."),
    ("slides", "Using your slides", "Talks to the audience, not the slides; each slide supports one point."),
    ("audience", "Audience focus", "Speaks to what this audience cares about, in their language."),
    ("closing", "Close & call to action", "Ends with a summary and a clear ask or next step."),
    ("qa", "Handling questions", "Listens fully, answers directly and briefly, admits what they don't know."),
    ("composure", "Composure", "Stays calm and confident, including under challenging questions."),
]

PRESENTATION_COMPETENCIES: dict[str, Competency] = {
    f"presentation.{slug}": Competency(f"presentation.{slug}", name, Layer.ROUND, description)
    for slug, name, description in _ITEMS
}


def competencies() -> list[Competency]:
    return list(PRESENTATION_COMPETENCIES.values())
