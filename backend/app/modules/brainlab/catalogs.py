"""What a Brain Lab consultation is judged on: how well the user worked with the neuroscientist
on a change they can make (layer 1 for the brainlab module)."""

from __future__ import annotations

from app.platform.competencies.catalog import Competency, Layer

CATALOG_VERSION = "brainlab-2026-09-25"

_ITEMS: list[tuple[str, str, str]] = [
    ("self_insight", "Self-insight",
     "Describing the situation, what you feel and what you think, honestly and concretely."),
    ("specific_goal", "A specific goal", "Saying what you want in a way you could see happen, not 'be better'."),
    ("obstacle", "Naming the obstacle",
     "Naming the inner obstacle (a fear, a habit, a thought), not only outside causes."),
    ("plan_quality", "A usable plan", "If-then plans and practice steps specific enough to do this week."),
    ("engagement", "Trying it now",
     "Trying the technique in the session (the breath, your reappraisal line) and asking questions."),
]

BRAINLAB_COMPETENCIES: dict[str, Competency] = {
    f"brainlab.{slug}": Competency(f"brainlab.{slug}", name, Layer.ROUND, description)
    for slug, name, description in _ITEMS
}


def competencies() -> list[Competency]:
    return list(BRAINLAB_COMPETENCIES.values())
