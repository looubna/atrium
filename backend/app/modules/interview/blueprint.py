"""Interview blueprint: Agent 1's output contract and its validation.

A blueprint is the likely interview journey for one application. The number,
order and type of rounds come from research and the job context, never from a
fixed list. Everything is phrased as likely, not certain: questions reported
publicly must cite a stored source; everything else is a predicted question
family; a round marked high confidence without evidence is downgraded.
"""

from __future__ import annotations

import re
import secrets
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, Field

from app.modules.interview.catalogs import ROUND_LABELS, RoundType, competencies_for_round, parse_round_type
from app.modules.interview.sanitize import clean_list, clean_phrase, clean_text
from app.platform.feedback.schemas import Confidence

MAX_ROUNDS = 12
MAX_SOURCES = 20
_DOMAIN = re.compile(r"(?=.{3,253}$)([a-z0-9-]{1,63}\.)+[a-z]{2,63}")
_ROUND_ID = re.compile(r"r\d{2}[0-9a-f]{8}")


class SourceKind(StrEnum):
    OFFICIAL = "official"
    EMPLOYEE_REPORT = "employee_report"
    JOB_POSTING = "job_posting"
    NEWS = "news"
    OTHER = "other"


class SourceDraft(BaseModel):
    id: str = Field(description="Short id such as src1, referenced by rounds")
    title: str
    domain: str = Field(description="Website domain, e.g. careers.example.com")
    kind: SourceKind


class ReportedQuestionDraft(BaseModel):
    text: str = Field(description="A question candidates publicly reported being asked")
    sourceIds: list[str]


class QuestionFamilyDraft(BaseModel):
    name: str
    description: str
    exampleQuestions: list[str] = Field(description="Predicted example questions, not reported ones")


class RubricItemDraft(BaseModel):
    competencyId: str
    strongSignals: str
    weakSignals: str


class RoundDraft(BaseModel):
    order: int
    type: str = Field(description="One of the allowed round types")
    customLabel: str = Field(description="Label when type is 'other', otherwise empty")
    title: str
    format: str = Field(description="e.g. 'Video call, one interviewer'")
    durationMinutes: int = Field(description="Approximate length, or 0 when unknown")
    competencyIds: list[str]
    questionFamilies: list[QuestionFamilyDraft]
    reportedQuestions: list[ReportedQuestionDraft]
    resumeFocus: list[str]
    roleFocus: list[str]
    companyFocus: list[str]
    rubric: list[RubricItemDraft]
    confidence: Confidence
    rationale: str
    evidenceSourceIds: list[str]


class BlueprintDraft(BaseModel):
    processSummary: str = Field(description="Starts with 'Likely interview process' and never states certainty")
    companySummary: str
    roleSummary: str
    rounds: list[RoundDraft]
    sources: list[SourceDraft]
    caveats: list[str]


class BlueprintRejected(ValueError):
    def __init__(self, problems: list[str]) -> None:
        super().__init__("; ".join(problems[:10]))
        self.problems = problems


def new_round_id(order: int) -> str:
    return f"r{order:02d}{secrets.token_hex(4)}"


def _sources(drafts: list[SourceDraft], problems: list[str]) -> dict[str, dict[str, str]]:
    sources: dict[str, dict[str, str]] = {}
    for draft in drafts[: MAX_SOURCES * 2]:
        sid = clean_phrase(draft.id, 20)
        domain = draft.domain.strip().lower().removeprefix("www.")
        if not sid or sid in sources:
            continue
        if not _DOMAIN.fullmatch(domain):
            problems.append(f"source {sid!r} has an invalid domain")
            continue
        sources[sid] = {"id": sid, "title": clean_phrase(draft.title, 160) or domain, "domain": domain,
                        "kind": draft.kind.value}
        if len(sources) >= MAX_SOURCES:
            break
    return sources


def _round(draft: RoundDraft, order: int, sources: dict[str, dict[str, str]], problems: list[str],
           keep_id: str | None) -> dict[str, Any]:
    parsed = parse_round_type(draft.type)
    if parsed is None or parsed is RoundType.OTHER:
        round_type, custom = RoundType.OTHER, clean_phrase(draft.customLabel or draft.type, 60)
    else:
        round_type, custom = parsed, ""

    catalog = [c.id for c in competencies_for_round(round_type)]
    competency_ids = [c for c in dict.fromkeys(draft.competencyIds) if c in catalog][:8]
    if len(competency_ids) < 3:
        competency_ids = list(dict.fromkeys([*competency_ids, *catalog]))[:5]

    reported: list[dict[str, Any]] = []
    for question in draft.reportedQuestions[:12]:
        cited = [s for s in question.sourceIds if s in sources]
        text = clean_phrase(question.text, 240)
        if not cited:
            problems.append(f"round {order}: reported question without a known source was removed")
            continue
        if text:
            reported.append({"text": text, "sourceIds": cited})

    evidence = [s for s in dict.fromkeys(draft.evidenceSourceIds) if s in sources]
    confidence = draft.confidence
    if confidence is Confidence.HIGH and not evidence:
        confidence = Confidence.MEDIUM

    duration = draft.durationMinutes if 5 <= draft.durationMinutes <= 240 else None
    return {
        "id": keep_id if keep_id and _ROUND_ID.fullmatch(keep_id) else new_round_id(order),
        "order": order,
        "type": round_type.value,
        "customLabel": custom,
        "title": clean_phrase(draft.title, 100) or custom or ROUND_LABELS[round_type],
        "format": clean_phrase(draft.format, 120),
        "durationMin": duration,
        "competencyIds": competency_ids,
        "questionFamilies": [
            {
                "name": clean_phrase(f.name, 80),
                "description": clean_phrase(f.description, 240),
                "exampleQuestions": clean_list(f.exampleQuestions, max_items=3, max_chars=200),
            }
            for f in draft.questionFamilies[:8]
            if clean_phrase(f.name, 80)
        ],
        "reportedQuestions": reported[:8],
        "resumeFocus": clean_list(draft.resumeFocus, max_items=6),
        "roleFocus": clean_list(draft.roleFocus, max_items=6),
        "companyFocus": clean_list(draft.companyFocus, max_items=6),
        "rubric": [
            {"competencyId": r.competencyId, "strongSignals": clean_phrase(r.strongSignals, 300),
             "weakSignals": clean_phrase(r.weakSignals, 300)}
            for r in draft.rubric[:8]
            if r.competencyId in competency_ids
        ],
        "confidence": confidence.value,
        "rationale": clean_phrase(draft.rationale, 400),
        "evidenceSourceIds": evidence,
    }


def validate_blueprint(
    draft: BlueprintDraft, *, existing_ids: dict[int, str] | None = None
) -> tuple[dict[str, Any], list[str]]:
    """Returns Firestore-ready blueprint fields and non-fatal problems; raises BlueprintRejected."""
    problems: list[str] = []
    if not draft.rounds:
        raise BlueprintRejected(["the blueprint has no rounds"])
    if len(draft.rounds) > MAX_ROUNDS:
        raise BlueprintRejected([f"the blueprint has {len(draft.rounds)} rounds; at most {MAX_ROUNDS} are allowed"])

    sources = _sources(draft.sources, problems)
    ordered = sorted(draft.rounds, key=lambda r: r.order)
    rounds = [
        _round(r, index, sources, problems, (existing_ids or {}).get(index))
        for index, r in enumerate(ordered, start=1)
    ]
    summary = clean_text(draft.processSummary, 600)
    if summary and not summary.lower().startswith("likely"):
        summary = f"Likely interview process: {summary}"
    return (
        {
            "processSummary": summary,
            "companySummary": clean_text(draft.companySummary, 600),
            "roleSummary": clean_text(draft.roleSummary, 600),
            "rounds": rounds,
            "sources": list(sources.values()),
            "caveats": clean_list(draft.caveats, max_items=5, max_chars=240),
        },
        problems,
    )
