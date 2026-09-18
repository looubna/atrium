"""Oral exam styles and their competencies (layer 1 for the exam module).

An oral exam is run one of two ways: the examiner questions the student on the
subject, or the student solves problems at the board while the examiner watches
and probes. Which one a course uses is inferred from the student's material
(`agents/analyst.py`), never asked up front.
"""

from __future__ import annotations

from enum import StrEnum

from app.platform.competencies.catalog import Competency, Layer

CATALOG_VERSION = "exam-2026-09-18"


class ExamStyle(StrEnum):
    #: The examiner asks questions and the student answers out loud.
    ORAL_QUESTIONS = "oral_questions"
    #: The student works problems on the board, thinking aloud, and is questioned about them.
    BOARD_WORK = "board_work"
    #: Not settled yet: the analyst decides from the material, so a session never carries this.
    UNKNOWN = "unknown"


STYLE_LABELS: dict[ExamStyle, str] = {
    ExamStyle.ORAL_QUESTIONS: "The professor asks questions",
    ExamStyle.BOARD_WORK: "Problems solved at the board",
    ExamStyle.UNKNOWN: "Not sure yet",
}


def parse_style(value: str | None) -> ExamStyle:
    try:
        return ExamStyle(str(value))
    except ValueError:
        return ExamStyle.UNKNOWN


class MaterialType(StrEnum):
    """What a piece of uploaded material turns out to be. The student never chooses this."""

    LECTURE_SLIDES = "lecture_slides"
    LECTURE_NOTES = "lecture_notes"
    TEXTBOOK = "textbook"
    PERSONAL_NOTES = "personal_notes"
    SYLLABUS = "syllabus"
    PAST_EXAM = "past_exam"
    PROBLEM_SET = "problem_set"
    OTHER = "other"


MATERIAL_LABELS: dict[MaterialType, str] = {
    MaterialType.LECTURE_SLIDES: "Lecture slides",
    MaterialType.LECTURE_NOTES: "Lecture notes",
    MaterialType.TEXTBOOK: "Textbook",
    MaterialType.PERSONAL_NOTES: "Your notes",
    MaterialType.SYLLABUS: "Syllabus",
    MaterialType.PAST_EXAM: "Previous exam",
    MaterialType.PROBLEM_SET: "Problem set",
    MaterialType.OTHER: "Course material",
}


def parse_material_type(value: str | None) -> MaterialType:
    try:
        return MaterialType(str(value))
    except ValueError:
        return MaterialType.OTHER


_EXAM_COMPETENCIES: dict[str, list[tuple[str, str]]] = {
    "oral": [
        ("subject_knowledge", "Subject knowledge"),
        ("depth", "Depth of understanding"),
        ("accuracy", "Accuracy"),
        ("terminology", "Precise terminology"),
        ("reasoning", "Reasoning from principles"),
        ("applying_concepts", "Applying concepts"),
        ("examples", "Use of examples"),
        ("structure", "Structure of explanation"),
        ("handling_probing", "Handling probing questions"),
        ("admitting_limits", "Saying what you don't know"),
        ("composure", "Composure under pressure"),
    ],
    "board": [
        ("problem_understanding", "Problem understanding"),
        ("method_choice", "Choice of method"),
        ("derivation", "Derivation and steps"),
        ("notation", "Notation and rigour"),
        ("computation", "Computational accuracy"),
        ("sanity_checks", "Checking the result"),
        ("explaining_while_solving", "Explaining while solving"),
        ("handling_hints", "Handling hints"),
        ("subject_knowledge", "Subject knowledge"),
        ("time_management", "Time management"),
    ],
}

CATALOG_FOR_STYLE: dict[ExamStyle, str] = {
    ExamStyle.ORAL_QUESTIONS: "oral",
    ExamStyle.BOARD_WORK: "board",
    ExamStyle.UNKNOWN: "oral",
}

EXAM_COMPETENCIES: dict[str, Competency] = {
    f"exam.{area}.{slug}": Competency(f"exam.{area}.{slug}", name, Layer.ROUND, name)
    for area, items in _EXAM_COMPETENCIES.items()
    for slug, name in items
}


def competencies_for_style(style: ExamStyle) -> list[Competency]:
    prefix = f"exam.{CATALOG_FOR_STYLE[style]}."
    return [c for cid, c in EXAM_COMPETENCIES.items() if cid.startswith(prefix)]
