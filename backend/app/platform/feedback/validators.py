"""Turning a model's evaluation draft into trustworthy feedback.

Every rule here exists because model output cannot be trusted blindly:
- scores must be integers in 0-100 for known competencies of the right layer;
- timestamps must lie inside the recording, start before they end, and are
  snapped to the candidate segments they refer to;
- the evidence quote must really occur in those segments;
- overlapping duplicates are merged and the list is capped to the moments that
  matter most.
Problems are collected so a single repair attempt can be made with them.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field

from app.platform.feedback.schemas import (
    Category,
    CompetencyScore,
    CompetencyScoreDraft,
    Confidence,
    EvaluationDraft,
    FeedbackEvent,
    FeedbackEventDraft,
    QuestionClassification,
    Severity,
    ValidatedEvaluation,
)
from app.platform.transcripts.model import Segment, normalize

MAX_EVENTS = 15
MAX_EVENT_WINDOW_MS = 90_000
TIMESTAMP_TOLERANCE_MS = 1_000
MAX_TEXT = {"title": 80, "observation": 500, "whyItMatters": 300, "recommendation": 400, "example": 500}

SEVERITY_WEIGHT = {Severity.CRITICAL: 4, Severity.MAJOR: 3, Severity.MINOR: 1, Severity.STRENGTH: 2}
CONFIDENCE_WEIGHT = {Confidence.HIGH: 3, Confidence.MEDIUM: 2, Confidence.LOW: 1}


class EvaluationRejected(ValueError):
    def __init__(self, problems: list[str]) -> None:
        super().__init__("; ".join(problems[:10]))
        self.problems = problems


@dataclass(frozen=True)
class ValidationContext:
    run_id: str
    duration_ms: int
    segments: dict[str, Segment]
    round_competencies: frozenset[str]
    communication_competencies: frozenset[str]
    max_events: int = MAX_EVENTS


@dataclass
class ValidationReport:
    problems: list[str] = field(default_factory=list)
    dropped_events: int = 0


def _event_id(run_id: str, competency: str, start: int, end: int) -> str:
    return hashlib.sha256(f"{run_id}|{competency}|{start}|{end}".encode()).hexdigest()[:24]


def _scores(
    drafts: list[CompetencyScoreDraft], allowed: frozenset[str], category: Category, report: ValidationReport
) -> list[CompetencyScore]:
    seen: set[str] = set()
    out: list[CompetencyScore] = []
    for draft in drafts:
        if draft.competencyId not in allowed:
            report.problems.append(f"unknown {category.value} competency {draft.competencyId!r}")
            continue
        if draft.competencyId in seen:
            report.problems.append(f"duplicate score for {draft.competencyId}")
            continue
        if not 0 <= draft.score <= 100:
            report.problems.append(f"score {draft.score} for {draft.competencyId} is outside 0-100")
            continue
        seen.add(draft.competencyId)
        steps = [step.strip()[:220] for step in draft.toReach100 if step.strip()][:3]
        if not draft.meaning.strip() or not steps:
            report.problems.append(f"score for {draft.competencyId} needs a meaning and steps to reach 100")
        out.append(
            CompetencyScore(
                competencyId=draft.competencyId,
                category=category,
                score=draft.score,
                confidence=draft.confidence,
                rationale=draft.rationale.strip()[:400],
                measured=draft.measured.strip()[:300],
                meaning=draft.meaning.strip()[:240],
                toReach100=steps,
            )
        )
    return out


def _event(draft: FeedbackEventDraft, ctx: ValidationContext, report: ValidationReport) -> FeedbackEvent | None:
    label = f"event {draft.title[:40]!r}"
    allowed = ctx.round_competencies if draft.category is Category.ROUND else ctx.communication_competencies
    if draft.competencyId not in allowed:
        report.problems.append(f"{label}: competency {draft.competencyId!r} is not a {draft.category.value} competency")
        return None

    start, end = draft.timestampStart, draft.timestampEnd
    if start < 0 or end <= start:
        report.problems.append(f"{label}: timestampEnd must be after timestampStart and both non-negative")
        return None
    if start >= ctx.duration_ms or end > ctx.duration_ms + TIMESTAMP_TOLERANCE_MS:
        report.problems.append(f"{label}: timestamps {start}-{end} are outside the {ctx.duration_ms} ms recording")
        return None
    end = min(end, ctx.duration_ms)

    cited = [ctx.segments[sid] for sid in draft.evidenceSegmentIds if sid in ctx.segments]
    cited = [s for s in cited if s.speaker == "candidate"]
    if not cited:
        report.problems.append(f"{label}: evidenceSegmentIds must reference candidate segments")
        return None
    seg_start = min(s.start_ms for s in cited)
    seg_end = max(s.end_ms for s in cited)
    if end < seg_start - TIMESTAMP_TOLERANCE_MS or start > seg_end + TIMESTAMP_TOLERANCE_MS:
        report.problems.append(f"{label}: timestamps do not overlap the cited segments")
        return None
    start, end = max(start, seg_start), min(max(end, start + 1), seg_end)
    if end <= start:
        start, end = seg_start, seg_end
    if end - start > MAX_EVENT_WINDOW_MS:
        report.problems.append(f"{label}: moment longer than {MAX_EVENT_WINDOW_MS // 1000} s")
        return None

    quote = normalize(draft.evidenceQuote)
    haystack = normalize(" ".join(s.text for s in cited))
    if len(quote) < 3 or quote not in haystack:
        report.problems.append(f"{label}: evidenceQuote is not a verbatim quote from the cited segments")
        return None

    question_id = draft.questionSegmentId or None
    if question_id is not None and (
        question_id not in ctx.segments or ctx.segments[question_id].speaker != "interviewer"
    ):
        question_id = None

    texts = {k: getattr(draft, k).strip()[:limit] for k, limit in MAX_TEXT.items()}
    if not texts["observation"] or not texts["title"]:
        report.problems.append(f"{label}: title and observation are required")
        return None
    if draft.severity is not Severity.STRENGTH and not texts["recommendation"]:
        report.problems.append(f"{label}: improvement moments need a recommendation")
        return None

    priority = SEVERITY_WEIGHT[draft.severity] * 10 + CONFIDENCE_WEIGHT[draft.confidence]
    return FeedbackEvent(
        id=_event_id(ctx.run_id, draft.competencyId, start, end),
        timestampStart=start,
        timestampEnd=end,
        category=draft.category,
        competencyId=draft.competencyId,
        severity=draft.severity,
        title=texts["title"],
        observation=texts["observation"],
        whyItMatters=texts["whyItMatters"],
        recommendation=texts["recommendation"],
        example=texts["example"] if draft.severity is not Severity.STRENGTH else "",
        questionId=question_id,
        responseId=cited[0].id,
        evidence={"quote": draft.evidenceQuote.strip()[:300], "segmentIds": [s.id for s in cited]},
        confidence=draft.confidence,
        priority=priority,
    )


def _dedupe_and_cap(events: list[FeedbackEvent], max_events: int, report: ValidationReport) -> list[FeedbackEvent]:
    ranked = sorted(events, key=lambda e: (-e.priority, e.timestampStart))
    kept: list[FeedbackEvent] = []
    for event in ranked:
        overlaps = any(
            k.competencyId == event.competencyId
            and k.timestampStart < event.timestampEnd
            and event.timestampStart < k.timestampEnd
            for k in kept
        )
        if overlaps or any(k.id == event.id for k in kept):
            report.dropped_events += 1
            continue
        kept.append(event)

    if len(kept) > max_events:
        # Keep at least one strength so feedback is balanced, if there is one.
        strengths = [e for e in kept if e.severity is Severity.STRENGTH]
        chosen = kept[:max_events]
        if strengths and not any(e.severity is Severity.STRENGTH for e in chosen):
            chosen = [*kept[: max_events - 1], strengths[0]]
        report.dropped_events += len(kept) - len(chosen)
        kept = chosen
    return sorted(kept, key=lambda e: e.timestampStart)


def validate_evaluation(draft: EvaluationDraft, ctx: ValidationContext) -> tuple[ValidatedEvaluation, ValidationReport]:
    """Returns the validated evaluation and a report; raises EvaluationRejected when unusable."""
    report = ValidationReport()
    if not 0 <= draft.overallScore <= 100:
        report.problems.append(f"overallScore {draft.overallScore} is outside 0-100")

    scores = [
        *_scores(draft.roundScores, ctx.round_competencies, Category.ROUND, report),
        *_scores(draft.communicationScores, ctx.communication_competencies, Category.COMMUNICATION, report),
    ]
    events = [e for d in draft.events if (e := _event(d, ctx, report)) is not None]
    report.dropped_events += len(draft.events) - len(events)
    events = _dedupe_and_cap(events, ctx.max_events, report)

    questions = [
        QuestionClassification(
            segmentId=q.segmentId,
            questionFamily=q.questionFamily.strip()[:120],
            competencyIds=[c for c in q.competencyIds if c in ctx.round_competencies][:6],
        )
        for q in draft.questions
        if q.segmentId in ctx.segments and ctx.segments[q.segmentId].speaker == "interviewer"
    ]

    has_candidate_speech = any(s.speaker == "candidate" for s in ctx.segments.values())
    fatal = (
        not 0 <= draft.overallScore <= 100
        or not any(s.category is Category.COMMUNICATION for s in scores)
        or (has_candidate_speech and not events)
        or (draft.events and report.dropped_events > len(draft.events) / 2)
    )
    if fatal:
        raise EvaluationRejected(report.problems or ["evaluation is missing scores or usable moments"])

    return (
        ValidatedEvaluation(
            overallScore=draft.overallScore,
            scores=scores,
            events=events,
            strengths=[s.strip()[:200] for s in draft.strengths if s.strip()][:5],
            improvements=[s.strip()[:200] for s in draft.improvements if s.strip()][:5],
            questions=questions,
        ),
        report,
    )
