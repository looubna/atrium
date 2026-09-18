"""Naming debate competencies, planning the next debate, and what happens after feedback.

The targeting is the platform's deterministic planner, the same one the interview and exam
modules use — only the catalog the ids are named from differs. What is debate-specific is
what a next attempt can be (§31): the same motion again, the same motion from the other
side, a harder opponent, or a debate aimed at one weakness.
"""

from __future__ import annotations

from typing import Any

from app.modules.debate.argument_map import PATTERN_LABELS, patterns
from app.modules.debate.argument_map import build as build_map
from app.modules.debate.catalogs import DEBATE_COMPETENCIES, Difficulty, Focus, parse_difficulty
from app.modules.interview.retry import build_retry_plan as plan_retry
from app.platform.competencies.catalog import COMMUNICATION
from app.platform.feedback.schemas import CompetencyScore, QuestionClassification, ValidatedEvaluation
from app.platform.transcripts.model import Transcript


def competency_name(competency_id: str) -> str:
    competency = DEBATE_COMPETENCIES.get(competency_id) or COMMUNICATION.get(competency_id)
    return competency.name if competency else competency_id


def build_retry_plan(
    scores: list[CompetencyScore],
    questions: list[QuestionClassification],
    transcript: Transcript,
    previous: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return plan_retry(scores, questions, transcript, previous, namer=competency_name)


def harder(difficulty: Difficulty | str | None) -> Difficulty:
    """One step up, for "harder opponent". Advanced stays advanced — there is no eleven."""
    current = parse_difficulty(difficulty if isinstance(difficulty, str) else getattr(difficulty, "value", None))
    return {
        Difficulty.BEGINNER: Difficulty.INTERMEDIATE,
        Difficulty.INTERMEDIATE: Difficulty.ADVANCED,
        Difficulty.ADVANCED: Difficulty.ADVANCED,
    }[current]


#: Which weakness each pattern is practised away, so feedback can offer the right drill.
FOCUS_FOR_PATTERN: dict[str, Focus] = {
    "claims_without_evidence": Focus.EVIDENCE,
    "no_specific_examples": Focus.EVIDENCE,
    "answering_a_different_question": Focus.REBUTTALS,
    "ignored_objections": Focus.REBUTTALS,
    "weak_rebuttals": Focus.REBUTTALS,
    "unexamined_assumptions": Focus.CRITICAL_THINKING,
    "overgeneralisation": Focus.CRITICAL_THINKING,
    "contradictions": Focus.CRITICAL_THINKING,
    "never_conceded_a_point": Focus.CRITICAL_THINKING,
    "repeating_the_same_argument": Focus.CONCISENESS,
}


def suggested_focus(found: list[str]) -> Focus:
    """The one focus most worth practising, from what the debate actually showed."""
    for pattern in found:
        focus = FOCUS_FOR_PATTERN.get(pattern)
        if focus is not None:
            return focus
    return Focus.NONE


async def post_evaluation_steps(
    *,
    uid: str,
    session_id: str,
    run_id: str,
    session: dict[str, Any],
    evaluation: ValidatedEvaluation,
    transcript: Transcript,
) -> dict[str, Any]:
    """Extra fields for the session document, once feedback exists.

    The argument map and the patterns are both derived from the state the debate was
    actually conducted against, so they are computed rather than asked for, and they are
    stored on the session where the feedback screen reads them.
    """
    from app.modules.debate.agents.evaluator import debate_state_of

    context = session.get("context") or {}
    state = debate_state_of(session)
    found = patterns(state)
    focus = suggested_focus(found)
    return {
        "argumentMap": build_map(
            state,
            motion=str(context.get("motion") or context.get("topic", "")),
            user_position=str(context.get("userPosition", "")),
            ai_position=str(context.get("aiPosition", "")),
        ),
        "debatePatterns": [{"id": p, "label": PATTERN_LABELS.get(p, p)} for p in found],
        # What "practise this" should offer next, decided from the debate rather than guessed.
        "nextPractice": {
            "harderDifficulty": harder(str(context.get("difficulty", ""))).value,
            "suggestedFocus": focus.value,
        },
    }
