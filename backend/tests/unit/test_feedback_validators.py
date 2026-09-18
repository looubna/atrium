from __future__ import annotations

from typing import Any

import pytest

from app.platform.feedback.schemas import (
    CompetencyScoreDraft,
    EvaluationDraft,
    FeedbackEventDraft,
    QuestionClassification,
    Severity,
)
from app.platform.feedback.validators import EvaluationRejected, ValidationContext, validate_evaluation
from app.platform.transcripts.model import Segment

SEGMENTS = {
    "s0001": Segment(id="s0001", speaker="interviewer", start_ms=0, end_ms=900, text="How did you approach it?"),
    "s0002": Segment(
        id="s0002", speaker="candidate", start_ms=1000, end_ms=5000,
        text="I started writing the code and then I thought about the design",
    ),
    "s0003": Segment(
        id="s0003", speaker="candidate", start_ms=6000, end_ms=9000, text="We reduced latency by forty percent."
    ),
}
ROUND = frozenset({"interview.behavioral.answer_structure", "interview.behavioral.achievements"})
COMM = frozenset({"comm.clarity", "comm.structure", "comm.pace"})


def ctx(**overrides: Any) -> ValidationContext:
    base: dict[str, Any] = dict(run_id="run00001", duration_ms=10_000, segments=SEGMENTS,
                                round_competencies=ROUND, communication_competencies=COMM)
    return ValidationContext(**{**base, **overrides})


def event(**overrides: Any) -> FeedbackEventDraft:
    base: dict[str, Any] = dict(
        timestampStart=900, timestampEnd=5200, category="communication", competencyId="comm.structure",
        severity="major", title="Implementation before approach",
        observation="You described writing code before explaining your approach.",
        whyItMatters="Interviewers need the plan first.", recommendation="State your approach, then implement.",
        example="I'd approach this in three steps...", evidenceQuote="started writing the code",
        evidenceSegmentIds=["s0002"], questionSegmentId="s0001", confidence="high",
    )
    return FeedbackEventDraft(**{**base, **overrides})


def score(competency: str, value: int, **overrides: Any) -> CompetencyScoreDraft:
    base: dict[str, Any] = dict(
        competencyId=competency, score=value, confidence="medium", rationale="Jumped into details.",
        measured="The approach came after two minutes of detail.",
        meaning="Interviewers had to wait to hear how you would solve it.",
        toReach100=["Open with your approach in one sentence.", "Then walk through the steps in order."],
    )
    return CompetencyScoreDraft(**{**base, **overrides})


def draft(events: list[FeedbackEventDraft], **overrides: Any) -> EvaluationDraft:
    base: dict[str, Any] = dict(
        overallScore=68,
        roundScores=[score("interview.behavioral.answer_structure", 61)],
        communicationScores=[score("comm.structure", 58, confidence="high")],
        events=events, strengths=["Quantified impact"], improvements=["Lead with the approach"],
        questions=[QuestionClassification(segmentId="s0001", questionFamily="approach", competencyIds=[
            "interview.behavioral.answer_structure", "comm.structure"])],
    )
    return EvaluationDraft(**{**base, **overrides})


def test_valid_event_is_snapped_to_its_segment_and_gets_a_stable_id() -> None:
    result, report = validate_evaluation(draft([event()]), ctx())
    [ev] = result.events
    assert (ev.timestampStart, ev.timestampEnd) == (1000, 5000)
    assert ev.questionId == "s0001" and ev.responseId == "s0002"
    again, _ = validate_evaluation(draft([event()]), ctx())
    assert again.events[0].id == ev.id
    assert result.questions[0].competencyIds == ["interview.behavioral.answer_structure"]
    assert report.problems == []


def test_scores_carry_their_explanation() -> None:
    long_steps = ["Step one.", " ", "Step two.", "Step three.", "Step four."]
    result, report = validate_evaluation(
        draft([event()], communicationScores=[score("comm.structure", 58, toReach100=long_steps)]), ctx()
    )
    structure = next(s for s in result.scores if s.competencyId == "comm.structure")
    assert structure.meaning.startswith("Interviewers had to wait")
    assert structure.measured and structure.rationale
    assert structure.toReach100 == ["Step one.", "Step two.", "Step three."]
    assert report.problems == []


def test_unexplained_scores_are_reported_for_repair() -> None:
    _, report = validate_evaluation(
        draft([event()], communicationScores=[score("comm.structure", 58, meaning="", toReach100=[])]), ctx()
    )
    assert any("needs a meaning and steps" in p for p in report.problems)


def test_scores_out_of_range_or_unknown_are_dropped() -> None:
    too_high = score("interview.behavioral.answer_structure", 140, confidence="high")
    wrong_round = score("interview.coding.correctness", 70, confidence="high")
    bad = draft([event()], roundScores=[too_high, wrong_round])
    result, report = validate_evaluation(bad, ctx())
    assert [s.competencyId for s in result.scores] == ["comm.structure"]
    assert any("outside 0-100" in p for p in report.problems)
    assert any("unknown round competency" in p for p in report.problems)


@pytest.mark.parametrize(
    "overrides, message",
    [
        ({"timestampStart": 5000, "timestampEnd": 4000}, "must be after"),
        ({"timestampStart": 12_000, "timestampEnd": 13_000}, "outside the"),
        ({"evidenceQuote": "I designed everything first"}, "not a verbatim quote"),
        ({"evidenceSegmentIds": ["s0001"]}, "candidate segments"),
        ({"competencyId": "interview.behavioral.answer_structure"}, "not a communication competency"),
        ({"recommendation": ""}, "need a recommendation"),
    ],
)
def test_invalid_events_are_rejected_with_reasons(overrides: dict[str, Any], message: str) -> None:
    good = event(timestampStart=6000, timestampEnd=9000, evidenceQuote="reduced latency", evidenceSegmentIds=["s0003"],
                 severity="strength", competencyId="comm.clarity", recommendation="Keep quantifying.")
    result, report = validate_evaluation(draft([good, good.model_copy(update={"competencyId": "comm.pace"}),
                                                event(**overrides)]), ctx())
    assert len(result.events) == 2
    assert any(message in p for p in report.problems)


def test_overlapping_duplicates_keep_the_higher_priority_event() -> None:
    low = event(severity="minor", confidence="low", title="Minor structure note")
    high = event(severity="major", confidence="high")
    result, report = validate_evaluation(draft([low, high]), ctx())
    assert [e.title for e in result.events] == ["Implementation before approach"]
    assert report.dropped_events == 1


def test_event_cap_keeps_a_strength() -> None:
    segments = {f"s{i:04d}": Segment(id=f"s{i:04d}", speaker="candidate", start_ms=i * 10_000,
                                     end_ms=i * 10_000 + 8_000, text="alpha beta gamma") for i in range(1, 21)}
    events = [event(timestampStart=i * 10_000, timestampEnd=i * 10_000 + 8_000, evidenceQuote="beta gamma",
                    evidenceSegmentIds=[f"s{i:04d}"], questionSegmentId="", competencyId="comm.clarity",
                    severity="major") for i in range(1, 20)]
    events.append(event(timestampStart=200_000, timestampEnd=208_000, evidenceQuote="alpha", severity="strength",
                        evidenceSegmentIds=["s0020"], questionSegmentId="", competencyId="comm.pace", confidence="low"))
    result, _ = validate_evaluation(draft(events), ctx(segments=segments, duration_ms=210_000, max_events=15))
    assert len(result.events) == 15
    assert any(e.severity is Severity.STRENGTH for e in result.events)
    assert [e.timestampStart for e in result.events] == sorted(e.timestampStart for e in result.events)


def test_unusable_evaluations_are_rejected() -> None:
    with pytest.raises(EvaluationRejected):
        validate_evaluation(draft([event()], overallScore=250), ctx())
    with pytest.raises(EvaluationRejected):
        validate_evaluation(draft([event()], communicationScores=[]), ctx())
    with pytest.raises(EvaluationRejected) as exc:
        validate_evaluation(draft([event(evidenceQuote="made up"), event(timestampEnd=10)]), ctx())
    assert exc.value.problems
    with pytest.raises(EvaluationRejected):
        validate_evaluation(draft([]), ctx())
