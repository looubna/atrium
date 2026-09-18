"""Retry targeting: practise the same weak skills with different questions.

Deterministic on purpose: the evaluation already identified what was weak and
which question families tested it, so no extra model call is needed. The plan
feeds the next session's live interviewer instructions.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from app.modules.interview.catalogs import ROUND_COMPETENCIES
from app.platform.competencies.catalog import COMMUNICATION
from app.platform.feedback.schemas import CompetencyScore, Confidence, QuestionClassification
from app.platform.transcripts.model import Transcript

WEAK_THRESHOLD = 75
MAX_TARGETS = 3
MAX_EXCLUDED = 30


def competency_name(competency_id: str) -> str:
    competency = ROUND_COMPETENCIES.get(competency_id) or COMMUNICATION.get(competency_id)
    return competency.name if competency else competency_id


def build_retry_plan(
    scores: list[CompetencyScore],
    questions: list[QuestionClassification],
    transcript: Transcript,
    previous: dict[str, Any] | None = None,
    *,
    namer: Callable[[str], str] = competency_name,
) -> dict[str, Any]:
    """`namer` lets another module reuse this planner with its own competency catalog."""
    candidates = [s for s in scores if s.score < WEAK_THRESHOLD and s.confidence is not Confidence.LOW]
    weakest = sorted(candidates, key=lambda s: (s.score, s.competencyId))[:MAX_TARGETS]
    target_ids = [s.competencyId for s in weakest]

    families: list[str] = []
    for question in questions:
        tested = set(question.competencyIds)
        if (not target_ids or tested.intersection(target_ids)) and question.questionFamily not in families:
            families.append(question.questionFamily)

    segments = transcript.segment_map()
    asked = [
        segments[q.segmentId].text.strip()[:240]
        for q in questions
        if q.segmentId in segments and segments[q.segmentId].text.strip()
    ]
    excluded: list[str] = []
    for text in [*(previous or {}).get("excludeQuestions", []), *asked]:
        if text and text not in excluded:
            excluded.append(str(text)[:240])

    return {
        "competencyIds": target_ids,
        "competencyNames": [namer(cid) for cid in target_ids],
        "questionFamilies": families[:6],
        "excludeQuestions": excluded[-MAX_EXCLUDED:],
    }
