"""What a language conversation is judged on (layer 1 for the language module)."""

from __future__ import annotations

from app.platform.competencies.catalog import Competency, Layer

CATALOG_VERSION = "language-2026-09-24.2"

#: How the learner sounds (the communication layer) and what they can do with the language (the round).
_ITEMS: list[tuple[str, str, Layer, str]] = [
    ("fluency", "Fluency", Layer.COMMUNICATION,
     "Keeps talking in the language, with few long stops or switches to their own."),
    ("grammar", "Grammar", Layer.ROUND,
     "Builds sentences correctly for their level: verb forms, agreement, word order."),
    ("vocabulary", "Vocabulary", Layer.ROUND, "Finds the words they need, and uses them precisely."),
    ("pronunciation", "Pronunciation", Layer.COMMUNICATION, "Is easy to understand: sounds, stress and rhythm."),
    ("comprehension", "Understanding", Layer.ROUND, "Understands what is said and answers to the point."),
    ("register", "Politeness & tone", Layer.COMMUNICATION,
     "Sounds right for the situation: polite forms, greetings, tone."),
    ("task", "Getting it done", Layer.ROUND, "Achieves what the scene was for (ordering, buying, finding the way)."),
]

LANGUAGE_COMPETENCIES: dict[str, Competency] = {
    f"language.{slug}": Competency(f"language.{slug}", name, layer, description)
    for slug, name, layer, description in _ITEMS
}


def competencies(layer: Layer | None = None) -> list[Competency]:
    return [c for c in LANGUAGE_COMPETENCIES.values() if layer is None or c.layer is layer]
