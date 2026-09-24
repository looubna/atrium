"""Naming presentation competencies, and planning the next session."""

from __future__ import annotations

from typing import Any

from app.modules.interview.retry import build_retry_plan as plan_retry
from app.modules.presentation.catalogs import PRESENTATION_COMPETENCIES
from app.platform.competencies.catalog import COMMUNICATION
from app.platform.feedback.schemas import CompetencyScore, QuestionClassification
from app.platform.transcripts.model import Transcript


def competency_name(competency_id: str) -> str:
    competency = PRESENTATION_COMPETENCIES.get(competency_id) or COMMUNICATION.get(competency_id)
    return competency.name if competency else competency_id


def build_retry_plan(
    scores: list[CompetencyScore],
    questions: list[QuestionClassification],
    transcript: Transcript,
    previous: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return plan_retry(scores, questions, transcript, previous, namer=competency_name)
