"""What a meeting is judged on (layer 1 for the meeting module)."""

from __future__ import annotations

from app.platform.competencies.catalog import Competency, Layer

CATALOG_VERSION = "meeting-2026-09-24"

_ITEMS: list[tuple[str, str, str]] = [
    ("clarity", "Clear contributions", "Makes points that are short, structured and easy to follow."),
    ("influence", "Making your point heard", "Speaks up at the right moment and backs points with facts."),
    ("questions", "Asking good questions", "Asks questions that clarify, test assumptions and move things on."),
    ("listening", "Listening & building", "Lets people finish, acknowledges them, and builds on what they said."),
    ("disagreement", "Handling disagreement", "Disagrees constructively and keeps the discussion on the issue."),
    ("facilitation", "Running the meeting", "Sets the purpose and agenda, keeps time and brings everyone in."),
    ("decisions", "Driving to decisions", "Moves the group from discussion to a clear decision."),
    ("next_steps", "Actions & next steps", "Ends with owners, deadlines and what happens next."),
    ("composure", "Composure", "Stays calm and professional under pushback and interruptions."),
]

MEETING_COMPETENCIES: dict[str, Competency] = {
    f"meeting.{slug}": Competency(f"meeting.{slug}", name, Layer.ROUND, description)
    for slug, name, description in _ITEMS
}


def competencies() -> list[Competency]:
    return list(MEETING_COMPETENCIES.values())
