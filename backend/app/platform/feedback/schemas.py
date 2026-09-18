"""Evaluation contract between an evaluator agent and the platform.

`EvaluationDraft` is what a model returns (structured output). It uses only
simple types so it maps cleanly onto a response schema; limits that a schema
cannot express are enforced by `validators.validate_evaluation`, which turns a
draft into a `ValidatedEvaluation` or reports why it cannot.
"""

from __future__ import annotations

from enum import StrEnum

from pydantic import BaseModel, Field


class Severity(StrEnum):
    STRENGTH = "strength"
    MINOR = "minor"
    MAJOR = "major"
    CRITICAL = "critical"


class Confidence(StrEnum):
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class Category(StrEnum):
    ROUND = "round"
    COMMUNICATION = "communication"


class CompetencyScoreDraft(BaseModel):
    competencyId: str
    score: int
    confidence: Confidence
    rationale: str = Field(description="Why this score, pointing to specific answers the candidate gave")
    measured: str = Field(
        description="What was observed; for measured competencies use the measurement's numbers and target"
    )
    meaning: str = Field(
        description="One plain sentence on what the score means for the candidate, e.g. 'You spoke faster than "
        "listeners can comfortably follow.'"
    )
    toReach100: list[str] = Field(
        description="Two or three specific actions for this candidate that would raise the score to 100"
    )


class FeedbackEventDraft(BaseModel):
    timestampStart: int = Field(description="Milliseconds from the start of the recording")
    timestampEnd: int = Field(description="Milliseconds from the start of the recording")
    category: Category
    competencyId: str
    severity: Severity
    title: str = Field(description="At most 8 words, e.g. 'Implementation before approach'")
    observation: str = Field(description="What happened, referring to what the candidate said")
    whyItMatters: str
    recommendation: str = Field(description="What to change next time")
    example: str = Field(description="A short better version, in the candidate's voice; empty for strengths")
    evidenceQuote: str = Field(description="A verbatim quote from the cited candidate segments")
    evidenceSegmentIds: list[str]
    questionSegmentId: str = Field(default="", description="Interviewer segment that asked the question, if any")
    confidence: Confidence


class QuestionClassification(BaseModel):
    segmentId: str = Field(description="Interviewer segment id")
    questionFamily: str
    competencyIds: list[str]


class EvaluationDraft(BaseModel):
    overallScore: int
    roundScores: list[CompetencyScoreDraft]
    communicationScores: list[CompetencyScoreDraft]
    events: list[FeedbackEventDraft]
    strengths: list[str]
    improvements: list[str]
    questions: list[QuestionClassification]


class CompetencyScore(BaseModel):
    competencyId: str
    category: Category
    score: int = Field(ge=0, le=100)
    confidence: Confidence
    rationale: str
    measured: str = ""
    meaning: str = ""
    toReach100: list[str] = Field(default_factory=list)
    #: A measured fact shown next to the score (e.g. speaking rate against its target); set by the platform.
    metric: dict[str, object] | None = None


class FeedbackEvent(BaseModel):
    id: str
    timestampStart: int = Field(ge=0)
    timestampEnd: int = Field(ge=0)
    category: Category
    competencyId: str
    severity: Severity
    title: str
    observation: str
    whyItMatters: str
    recommendation: str
    example: str
    questionId: str | None
    responseId: str
    evidence: dict[str, object]
    confidence: Confidence
    priority: int


class ValidatedEvaluation(BaseModel):
    overallScore: int = Field(ge=0, le=100)
    scores: list[CompetencyScore]
    events: list[FeedbackEvent]
    strengths: list[str]
    improvements: list[str]
    questions: list[QuestionClassification]
