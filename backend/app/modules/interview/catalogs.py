"""Interview round types and their round-specific competencies (layer 1).

The number and order of rounds for a given job come from the Strategist's
blueprint; this module only defines the vocabulary those blueprints use.
"""

from __future__ import annotations

import re
from enum import StrEnum

from app.platform.competencies.catalog import Competency, Layer

CATALOG_VERSION = "interview-2026-09-15"


class RoundType(StrEnum):
    SCREENING = "screening"
    BEHAVIORAL = "behavioral"
    TECHNICAL = "technical"
    CODING = "coding"
    SYSTEM_DESIGN = "system_design"
    CASE = "case"
    HIRING_MANAGER = "hiring_manager"
    PRESENTATION = "presentation"
    TAKE_HOME_REVIEW = "take_home_review"
    OTHER = "other"


ROUND_LABELS: dict[RoundType, str] = {
    RoundType.SCREENING: "Recruiter / screening",
    RoundType.BEHAVIORAL: "Behavioral",
    RoundType.TECHNICAL: "Technical",
    RoundType.CODING: "Coding",
    RoundType.SYSTEM_DESIGN: "System design",
    RoundType.CASE: "Case",
    RoundType.HIRING_MANAGER: "Hiring manager",
    RoundType.PRESENTATION: "Presentation",
    RoundType.TAKE_HOME_REVIEW: "Take-home review",
    RoundType.OTHER: "Other",
}

CODING_ROUNDS = frozenset({RoundType.CODING, RoundType.SYSTEM_DESIGN})

# How people and models commonly name rounds, normalized (lower case, underscores).
_ROUND_ALIASES: dict[str, RoundType] = {
    "recruiter": RoundType.SCREENING,
    "recruiter_screen": RoundType.SCREENING,
    "recruiter_screening": RoundType.SCREENING,
    "phone_screen": RoundType.SCREENING,
    "hr": RoundType.SCREENING,
    "hr_screen": RoundType.SCREENING,
    "initial_screen": RoundType.SCREENING,
    "behavioural": RoundType.BEHAVIORAL,
    "culture_fit": RoundType.BEHAVIORAL,
    "values": RoundType.BEHAVIORAL,
    "technical_interview": RoundType.TECHNICAL,
    "technical_screen": RoundType.TECHNICAL,
    "live_coding": RoundType.CODING,
    "coding_interview": RoundType.CODING,
    "pair_programming": RoundType.CODING,
    "system_design_interview": RoundType.SYSTEM_DESIGN,
    "architecture": RoundType.SYSTEM_DESIGN,
    "case_study": RoundType.CASE,
    "case_interview": RoundType.CASE,
    "manager": RoundType.HIRING_MANAGER,
    "hiring_manager_interview": RoundType.HIRING_MANAGER,
    "take_home": RoundType.TAKE_HOME_REVIEW,
    "take_home_assignment": RoundType.TAKE_HOME_REVIEW,
    "take_home_exercise": RoundType.TAKE_HOME_REVIEW,
    "portfolio_review": RoundType.PRESENTATION,
}


def parse_round_type(text: str) -> RoundType | None:
    """Maps a round type value, label or common alias to a RoundType; None when unknown."""
    key = re.sub(r"[^a-z0-9]+", "_", text.strip().lower()).strip("_")
    if not key:
        return None
    try:
        return RoundType(key)
    except ValueError:
        pass
    for round_type, label in ROUND_LABELS.items():
        if key == re.sub(r"[^a-z0-9]+", "_", label.lower()).strip("_"):
            return round_type
    return _ROUND_ALIASES.get(key)

_ROUND_COMPETENCIES: dict[str, list[tuple[str, str]]] = {
    "coding": [
        ("problem_understanding", "Problem understanding"),
        ("decomposition", "Problem decomposition"),
        ("algorithmic_thinking", "Algorithmic thinking"),
        ("data_structures", "Data structures & algorithms"),
        ("code_quality", "Code quality"),
        ("correctness", "Correctness"),
        ("efficiency", "Efficiency"),
        ("debugging", "Debugging"),
        ("testing", "Testing"),
        ("think_aloud", "Think-aloud communication"),
        ("handling_hints", "Handling hints"),
        ("time_management", "Time management"),
    ],
    "system_design": [
        ("requirements", "Requirements gathering"),
        ("high_level_design", "High-level design"),
        ("data_modeling", "Data modeling"),
        ("scalability", "Scalability"),
        ("reliability", "Reliability & failure handling"),
        ("tradeoffs", "Trade-off analysis"),
        ("defending_decisions", "Defending decisions"),
        ("handling_ambiguity", "Handling ambiguity"),
    ],
    "case": [
        ("structuring", "Problem structuring"),
        ("analytical_thinking", "Analytical thinking"),
        ("logical_reasoning", "Logical reasoning"),
        ("quantitative_reasoning", "Quantitative reasoning"),
        ("data_interpretation", "Data interpretation"),
        ("hypothesis_driven", "Hypothesis-driven thinking"),
        ("business_judgment", "Business judgment"),
        ("prioritization", "Prioritization"),
        ("creativity", "Creativity"),
        ("adaptability", "Adaptability"),
        ("recommendation", "Recommendation quality"),
        ("handling_questions", "Handling questions"),
        ("framework_usage", "Framework usage"),
    ],
    "technical": [
        ("knowledge", "Technical knowledge"),
        ("problem_solving", "Problem solving"),
        ("logical_reasoning", "Logical reasoning"),
        ("depth", "Depth of understanding"),
        ("applying_concepts", "Applying concepts"),
        ("explaining_concepts", "Explaining technical concepts"),
        ("critical_thinking", "Critical thinking"),
        ("handling_ambiguity", "Handling ambiguity"),
        ("accuracy", "Accuracy"),
        ("defending_decisions", "Defending decisions"),
    ],
    "behavioral": [
        ("answer_structure", "Answer structure"),
        ("relevance", "Relevance"),
        ("storytelling", "Storytelling"),
        ("self_awareness", "Self-awareness"),
        ("authenticity", "Authenticity"),
        ("achievements", "Communication of achievements"),
        ("emotional_intelligence", "Emotional intelligence"),
        ("difficult_questions", "Handling difficult questions"),
        ("motivation", "Motivation"),
    ],
    "hiring_manager": [
        ("leadership", "Leadership"),
        ("ownership", "Ownership"),
        ("decision_making", "Decision-making"),
        ("problem_solving", "Problem solving"),
        ("collaboration", "Collaboration"),
        ("conflict_management", "Conflict management"),
        ("adaptability", "Adaptability"),
        ("accountability", "Accountability"),
        ("motivation", "Motivation"),
        ("role_understanding", "Role understanding"),
        ("stakeholder_management", "Stakeholder management"),
        ("self_awareness", "Self-awareness"),
    ],
    "screening": [
        ("communication", "Communication"),
        ("clarity", "Clarity"),
        ("conciseness", "Conciseness"),
        ("self_presentation", "Self-presentation"),
        ("motivation", "Motivation"),
        ("career_goals", "Career goals"),
        ("role_understanding", "Role understanding"),
        ("company_interest", "Company interest"),
        ("professionalism", "Professionalism"),
        ("experience_relevance", "Experience relevance"),
        ("asking_questions", "Asking good questions"),
    ],
    "presentation": [
        ("message_clarity", "Message clarity"),
        ("narrative", "Narrative structure"),
        ("audience_awareness", "Audience awareness"),
        ("evidence", "Use of evidence"),
        ("handling_questions", "Handling questions"),
        ("time_management", "Time management"),
    ],
    "take_home_review": [
        ("solution_walkthrough", "Solution walkthrough"),
        ("design_rationale", "Design rationale"),
        ("quality_awareness", "Quality awareness"),
        ("defending_decisions", "Defending decisions"),
        ("receiving_critique", "Receiving critique"),
        ("improvement_ideas", "Improvement ideas"),
    ],
}

# Round types without a dedicated catalog borrow the closest one.
CATALOG_FOR_ROUND: dict[RoundType, str] = {
    RoundType.SCREENING: "screening",
    RoundType.BEHAVIORAL: "behavioral",
    RoundType.TECHNICAL: "technical",
    RoundType.CODING: "coding",
    RoundType.SYSTEM_DESIGN: "system_design",
    RoundType.CASE: "case",
    RoundType.HIRING_MANAGER: "hiring_manager",
    RoundType.PRESENTATION: "presentation",
    RoundType.TAKE_HOME_REVIEW: "take_home_review",
    RoundType.OTHER: "behavioral",
}

ROUND_COMPETENCIES: dict[str, Competency] = {
    f"interview.{area}.{slug}": Competency(f"interview.{area}.{slug}", name, Layer.ROUND, name)
    for area, items in _ROUND_COMPETENCIES.items()
    for slug, name in items
}


def competencies_for_round(round_type: RoundType) -> list[Competency]:
    prefix = f"interview.{CATALOG_FOR_ROUND[round_type]}."
    return [c for cid, c in ROUND_COMPETENCIES.items() if cid.startswith(prefix)]


def is_round_competency(competency_id: str, round_type: RoundType) -> bool:
    return competency_id.startswith(f"interview.{CATALOG_FOR_ROUND[round_type]}.") and (
        competency_id in ROUND_COMPETENCIES
    )
