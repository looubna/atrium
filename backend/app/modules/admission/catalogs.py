"""What an admission or scholarship interview is made of (layer 1 for the admission module).

Three things are decided here and nowhere else: what kind of opportunity the candidate is
preparing for, what a panel actually spends its time on, and how firmly any given piece of
research is known. The last one matters more than it looks: research for this module comes
from official guidelines, from strangers describing their own interview on a forum, and from
the model's own reading of the candidate's file, and those three can never be shown to a
candidate as if they were the same thing.
"""

from __future__ import annotations

from enum import StrEnum

from app.platform.competencies.catalog import Competency, Layer

CATALOG_VERSION = "admission-2026-09-23"


class OpportunityKind(StrEnum):
    """What the candidate is being interviewed for. Chosen by them, never inferred."""

    #: A funder's interview: money, and what the candidate will do with it.
    SCHOLARSHIP = "scholarship"
    #: A department's interview: whether this person can do the academic work.
    UNIVERSITY = "university"
    #: One interview that has to satisfy both, which is the common case for GKS, Chevening
    #: and the rest: the panel is paying for a place it also has to admit them to.
    BOTH = "both"


KIND_LABELS: dict[OpportunityKind, str] = {
    OpportunityKind.SCHOLARSHIP: "Scholarship",
    OpportunityKind.UNIVERSITY: "University admission",
    OpportunityKind.BOTH: "University + scholarship",
}


#: Other names the app uses for a kind. The app's picker says "admission" for a university
#: place; without this it fell through to a scholarship, and a department interview was
#: researched, prepared and conducted as a funder's.
KIND_ALIASES: dict[str, OpportunityKind] = {"admission": OpportunityKind.UNIVERSITY}


def parse_kind(value: str | None) -> OpportunityKind:
    if str(value) in KIND_ALIASES:
        return KIND_ALIASES[str(value)]
    try:
        return OpportunityKind(str(value))
    except ValueError:
        return OpportunityKind.SCHOLARSHIP


class EvidenceTier(StrEnum):
    """How firmly something is known. Every insight carries one, and it decides how it is said.

    The distinction the whole module rests on. An official requirement can be stated flatly.
    Something a past candidate wrote on a blog is one person's experience and is always
    attributed as such. A third-party guide is weaker again. And the model's own reading of
    a file is a guess, which may be a useful guess but is never dressed as a fact.
    """

    #: Published by the funder, university or programme itself.
    OFFICIAL = "official"
    #: A named individual's account of their own interview or application.
    REPORTED = "reported"
    #: An education site, ranking, or other third party describing the process.
    SECONDARY = "secondary"
    #: Ours: drawn from the candidate's own materials against the opportunity.
    INFERENCE = "inference"


#: How each tier is allowed to be phrased to the candidate. The preparation engine uses these
#: as the lead-in for any statement carrying that tier, so nothing can quietly be promoted.
TIER_VOICE: dict[EvidenceTier, str] = {
    EvidenceTier.OFFICIAL: "The official guidance says",
    EvidenceTier.REPORTED: "Candidates who described their own interview mention",
    EvidenceTier.SECONDARY: "A third-party guide describes",
    EvidenceTier.INFERENCE: "From your materials, you may be asked about",
}

#: Ordered strongest first, for sorting and for deciding which of two claims survives.
TIER_RANK: dict[EvidenceTier, int] = {
    EvidenceTier.OFFICIAL: 0,
    EvidenceTier.REPORTED: 1,
    EvidenceTier.SECONDARY: 2,
    EvidenceTier.INFERENCE: 3,
}


def parse_tier(value: str | None) -> EvidenceTier:
    """Anything unrecognised is an inference: the weakest reading, never the strongest."""
    try:
        return EvidenceTier(str(value))
    except ValueError:
        return EvidenceTier.INFERENCE


class Phase(StrEnum):
    """The stretches a real admission panel moves through.

    Held as explicit state rather than left to the model's memory of the conversation
    (§22): the interviewer may leave the order when an answer earns a follow-up, but the
    session always knows which ground is covered and which is still owed.
    """

    OPENING = "opening"
    MOTIVATION = "motivation"
    BACKGROUND = "background"
    PROGRAM_FIT = "program_fit"
    STUDY_PLAN = "study_plan"
    CHALLENGES = "challenges"
    CONTRIBUTION = "contribution"
    CLOSING = "closing"


PHASE_LABELS: dict[Phase, str] = {
    Phase.OPENING: "Opening",
    Phase.MOTIVATION: "Motivation",
    Phase.BACKGROUND: "Academic and professional background",
    Phase.PROGRAM_FIT: "Fit with the programme",
    Phase.STUDY_PLAN: "Study and research plan",
    Phase.CHALLENGES: "Challenges and follow-ups",
    Phase.CONTRIBUTION: "Contribution and future",
    Phase.CLOSING: "Closing",
}

#: The usual order. A scholarship panel and a department weight these differently, which is
#: what `PHASE_WEIGHT` below is for, but both walk roughly this path.
PHASE_ORDER: tuple[Phase, ...] = (
    Phase.OPENING,
    Phase.MOTIVATION,
    Phase.BACKGROUND,
    Phase.PROGRAM_FIT,
    Phase.STUDY_PLAN,
    Phase.CHALLENGES,
    Phase.CONTRIBUTION,
    Phase.CLOSING,
)

#: Share of the interview each phase is worth, per kind (§30). A department spends its time
#: on whether the academic work is real; a funder spends its time on motivation, contribution
#: and what happens afterwards. Weights, not minutes: the session scales them to its length.
PHASE_WEIGHT: dict[OpportunityKind, dict[Phase, float]] = {
    OpportunityKind.UNIVERSITY: {
        Phase.OPENING: 0.05,
        Phase.MOTIVATION: 0.10,
        Phase.BACKGROUND: 0.20,
        Phase.PROGRAM_FIT: 0.20,
        Phase.STUDY_PLAN: 0.25,
        Phase.CHALLENGES: 0.13,
        Phase.CONTRIBUTION: 0.02,
        Phase.CLOSING: 0.05,
    },
    OpportunityKind.SCHOLARSHIP: {
        Phase.OPENING: 0.05,
        Phase.MOTIVATION: 0.22,
        Phase.BACKGROUND: 0.13,
        Phase.PROGRAM_FIT: 0.15,
        Phase.STUDY_PLAN: 0.10,
        Phase.CHALLENGES: 0.10,
        Phase.CONTRIBUTION: 0.20,
        Phase.CLOSING: 0.05,
    },
    OpportunityKind.BOTH: {
        Phase.OPENING: 0.05,
        Phase.MOTIVATION: 0.16,
        Phase.BACKGROUND: 0.16,
        Phase.PROGRAM_FIT: 0.17,
        Phase.STUDY_PLAN: 0.18,
        Phase.CHALLENGES: 0.12,
        Phase.CONTRIBUTION: 0.11,
        Phase.CLOSING: 0.05,
    },
}


class MaterialType(StrEnum):
    """What a document turns out to be. The candidate never classifies it themselves (§4)."""

    CV = "cv"
    PERSONAL_STATEMENT = "personal_statement"
    MOTIVATION_LETTER = "motivation_letter"
    STUDY_PLAN = "study_plan"
    RESEARCH_PROPOSAL = "research_proposal"
    ESSAY = "essay"
    TRANSCRIPT = "transcript"
    RECOMMENDATION = "recommendation"
    #: The opportunity's own paperwork, which is research rather than candidate evidence.
    PROGRAM_DESCRIPTION = "program_description"
    SCHOLARSHIP_GUIDELINES = "scholarship_guidelines"
    INTERVIEW_INSTRUCTIONS = "interview_instructions"
    PORTFOLIO = "portfolio"
    OTHER = "other"


MATERIAL_LABELS: dict[MaterialType, str] = {
    MaterialType.CV: "CV",
    MaterialType.PERSONAL_STATEMENT: "Personal statement",
    MaterialType.MOTIVATION_LETTER: "Motivation letter",
    MaterialType.STUDY_PLAN: "Study plan",
    MaterialType.RESEARCH_PROPOSAL: "Research proposal",
    MaterialType.ESSAY: "Essay",
    MaterialType.TRANSCRIPT: "Transcript",
    MaterialType.RECOMMENDATION: "Recommendation letter",
    MaterialType.PROGRAM_DESCRIPTION: "Programme description",
    MaterialType.SCHOLARSHIP_GUIDELINES: "Scholarship guidelines",
    MaterialType.INTERVIEW_INSTRUCTIONS: "Interview instructions",
    MaterialType.PORTFOLIO: "Portfolio",
    MaterialType.OTHER: "Document",
}

#: Documents that describe the *opportunity* rather than the candidate. They are evidence
#: about the interview, so they feed the opportunity profile and are read as OFFICIAL when
#: the candidate says they came from the funder — not mined for things to claim about them.
ABOUT_THE_OPPORTUNITY: frozenset[MaterialType] = frozenset(
    {
        MaterialType.PROGRAM_DESCRIPTION,
        MaterialType.SCHOLARSHIP_GUIDELINES,
        MaterialType.INTERVIEW_INSTRUCTIONS,
    }
)


def parse_material_type(value: str | None) -> MaterialType:
    try:
        return MaterialType(str(value))
    except ValueError:
        return MaterialType.OTHER


_ADMISSION_COMPETENCIES: dict[str, list[tuple[str, str]]] = {
    # What a funder is listening for.
    "scholarship": [
        ("motivation", "Motivation"),
        ("country_fit", "Why this country and programme"),
        ("contribution", "Contribution and impact"),
        ("leadership", "Leadership"),
        ("community", "Community involvement"),
        ("cross_cultural", "Cross-cultural readiness"),
        ("long_term_goals", "Long-term goals"),
        ("self_awareness", "Self-awareness"),
    ],
    # What a department is listening for.
    "academic": [
        ("academic_preparation", "Academic preparation"),
        ("program_fit", "Fit with the programme"),
        ("research_depth", "Depth in the research area"),
        ("study_plan", "Study and research plan"),
        ("methodology", "Methodology"),
        ("intellectual_curiosity", "Intellectual curiosity"),
        ("faculty_fit", "Fit with faculty and labs"),
        ("academic_potential", "Academic potential"),
    ],
    # True of any panel, and where most interviews are actually won or lost.
    "shared": [
        ("evidence", "Backing claims with evidence"),
        ("consistency", "Consistency with the application"),
        ("specificity", "Specificity over generalities"),
        ("handling_followups", "Handling follow-up questions"),
        ("story_coherence", "Coherence of the story"),
    ],
}

ADMISSION_COMPETENCIES: dict[str, Competency] = {
    f"admission.{area}.{slug}": Competency(f"admission.{area}.{slug}", name, Layer.ROUND, name)
    for area, items in _ADMISSION_COMPETENCIES.items()
    for slug, name in items
}

#: Which areas a kind is scored on. `shared` is always in: an answer with no evidence behind
#: it is just as weak in front of a department as in front of a funder.
AREAS_FOR_KIND: dict[OpportunityKind, tuple[str, ...]] = {
    OpportunityKind.SCHOLARSHIP: ("scholarship", "shared"),
    OpportunityKind.UNIVERSITY: ("academic", "shared"),
    OpportunityKind.BOTH: ("scholarship", "academic", "shared"),
}


def competencies_for_kind(kind: OpportunityKind) -> list[str]:
    """The competency ids an interview for this kind is scored on."""
    areas = AREAS_FOR_KIND[kind]
    return [cid for cid in ADMISSION_COMPETENCIES if cid.split(".")[1] in areas]
