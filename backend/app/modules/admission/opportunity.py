"""The Opportunity Profile: what we know about one scholarship or programme, and how well.

This is the output of research and the input to everything else. It is written once per
opportunity *and cycle* and reused between candidates (`cache.py`), so it holds nothing about
any individual: only what the funder published, what the programme says it wants, what past
applicants reported about sitting the interview, and what recurs across the accounts of people
who said they were selected.

Two rules shape the schema.

The first is that every statement carries its tier and its sources (`evidence.py`), because a
requirement and a stranger's recollection are both useful and are not the same kind of thing.

The second is narrower and matters more. A pattern across selected candidates is the most
dangerous object in the module: it is what a candidate most wants to read, and it is derived
from a set that is self-selected (people who chose to write about it), self-reported (nobody
audits a blog post) and truncated (the rejected applicants with identical profiles never post).
So a selected-candidate pattern that cites no source is not demoted here, it is deleted, and
the profile carries a standing caveat saying what the set is, in the candidate's own reading.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

from app.modules.admission.catalogs import EvidenceTier, OpportunityKind, parse_kind
from app.modules.admission.evidence import Insight, InsightDraft, SourceDraft, validate_insight, validate_sources

MAX_PER_SECTION = 14
MAX_TOPICS = 20
MAX_CAVEATS = 8
PROFILE_VERSION = 1

#: Said in the candidate's own words wherever selected-candidate patterns are shown (§18). Not
#: a disclaimer bolted on afterwards: it is what the set actually is.
STANDING_CAVEAT = (
    "These are patterns in publicly shared, self-reported accounts, not a study of who is selected. "
    "Applicants who were not selected rarely write about it, so nothing here shows what made the "
    "difference for anyone."
)


class TopicDraft(BaseModel):
    """A subject that keeps coming up in the interview, and how firmly that is known."""

    text: str = Field(description="The topic as a panel would raise it, e.g. 'Why this country?'")
    tier: str
    sourceIds: list[str] = Field(default_factory=list)
    accounts: int = Field(description="How many separate accounts mention it; 0 when it is not from accounts")


class OpportunityDraft(BaseModel):
    """What the researcher is asked to produce. Validated before any of it is kept."""

    name: str
    kind: str
    cycle: str = Field(description="The application cycle this describes, e.g. '2026'")
    summary: str = Field(description="What this opportunity is, in two or three sentences")
    officialRequirements: list[InsightDraft] = Field(default_factory=list)
    selectionCriteria: list[InsightDraft] = Field(default_factory=list)
    programPriorities: list[InsightDraft] = Field(default_factory=list)
    interviewFormat: list[InsightDraft] = Field(default_factory=list)
    interviewTopics: list[TopicDraft] = Field(default_factory=list)
    selectedCandidatePatterns: list[InsightDraft] = Field(default_factory=list)
    sources: list[SourceDraft] = Field(default_factory=list)
    caveats: list[str] = Field(default_factory=list)


class Topic(BaseModel):
    text: str
    tier: EvidenceTier
    sourceIds: tuple[str, ...] = ()
    accounts: int = 0


class OpportunityProfile(BaseModel):
    """A validated profile. Everything downstream reads this and never the research notes."""

    name: str
    kind: OpportunityKind
    cycle: str
    summary: str
    officialRequirements: list[Insight] = Field(default_factory=list)
    selectionCriteria: list[Insight] = Field(default_factory=list)
    programPriorities: list[Insight] = Field(default_factory=list)
    interviewFormat: list[Insight] = Field(default_factory=list)
    interviewTopics: list[Topic] = Field(default_factory=list)
    selectedCandidatePatterns: list[Insight] = Field(default_factory=list)
    sources: dict[str, dict[str, Any]] = Field(default_factory=dict)
    caveats: list[str] = Field(default_factory=list)
    version: int = PROFILE_VERSION

    def is_thin(self) -> bool:
        """True when research found too little to prepare anyone with.

        Worth knowing explicitly: a small or new scholarship may have almost nothing written
        about it, and the candidate should be told that rather than shown three vague lines
        as though they were a briefing.
        """
        official = len(self.officialRequirements) + len(self.selectionCriteria)
        return official == 0 or not self.sources


class OpportunityRejected(ValueError):
    def __init__(self, problems: list[str]) -> None:
        super().__init__("; ".join(problems[:10]))
        self.problems = problems


def _insights(
    drafts: list[InsightDraft], known: set[str], problems: list[str], *, label: str, require_source: bool = False
) -> list[Insight]:
    kept: list[Insight] = []
    for draft in drafts[:MAX_PER_SECTION]:
        insight, found = validate_insight(draft, known)
        problems.extend(f"{label}: {p}" for p in found)
        if insight is None:
            continue
        if require_source and not insight.sourceIds:
            # See the module docstring: unsourced, this is an invention about real people.
            problems.append(f"{label}: dropped an unsourced claim about selected candidates")
            continue
        kept.append(insight)
    return kept


def validate_opportunity(draft: OpportunityDraft) -> tuple[OpportunityProfile, list[str]]:
    """The profile as it may be stored, plus everything that had to be corrected.

    Raises `OpportunityRejected` only when the result would be indistinguishable from a guess:
    no name, or nothing retrieved at all. Everything else is repaired in place and reported,
    because a thin profile honestly labelled is still worth more than no preparation.
    """
    problems: list[str] = []

    name = " ".join(str(draft.name or "").split())[:160]
    if not name:
        raise OpportunityRejected(["the profile has no opportunity name"])

    sources, source_problems = validate_sources(draft.sources)
    problems.extend(source_problems)
    if not sources:
        raise OpportunityRejected(["research retrieved no usable sources"])
    known = set(sources)

    official = _insights(draft.officialRequirements, known, problems, label="requirement")
    criteria = _insights(draft.selectionCriteria, known, problems, label="criterion")
    priorities = _insights(draft.programPriorities, known, problems, label="priority")
    interview = _insights(draft.interviewFormat, known, problems, label="interview")
    patterns = _insights(
        draft.selectedCandidatePatterns, known, problems, label="selected-candidate pattern", require_source=True
    )

    # A funder does not publish a profile of its winners, so a pattern claiming to be official
    # is a misread of whatever page it came from.
    for pattern in patterns:
        if pattern.tier is EvidenceTier.OFFICIAL:
            problems.append("selected-candidate pattern claimed to be official; recorded as reported")
    patterns = [
        p.model_copy(update={"tier": EvidenceTier.REPORTED}) if p.tier is EvidenceTier.OFFICIAL else p
        for p in patterns
    ]

    topics: list[Topic] = []
    for topic_draft in draft.interviewTopics[:MAX_TOPICS]:
        insight, found = validate_insight(
            InsightDraft(text=topic_draft.text, tier=topic_draft.tier, sourceIds=topic_draft.sourceIds), known
        )
        problems.extend(f"topic: {p}" for p in found)
        if insight is None:
            continue
        topics.append(
            Topic(
                text=insight.text,
                tier=insight.tier,
                sourceIds=insight.sourceIds,
                accounts=max(0, min(999, int(topic_draft.accounts or 0))),
            )
        )
    # The ones many people remember being asked come first; then the firmest evidence.
    topics.sort(key=lambda t: (-t.accounts, t.tier))

    caveats = [" ".join(str(c).split())[:300] for c in draft.caveats if str(c).strip()][: MAX_CAVEATS - 1]
    if patterns and STANDING_CAVEAT not in caveats:
        caveats.insert(0, STANDING_CAVEAT)

    profile = OpportunityProfile(
        name=name,
        kind=parse_kind(draft.kind),
        cycle=" ".join(str(draft.cycle or "").split())[:16],
        summary=" ".join(str(draft.summary or "").split())[:1200],
        officialRequirements=official,
        selectionCriteria=criteria,
        programPriorities=priorities,
        interviewFormat=interview,
        interviewTopics=topics,
        selectedCandidatePatterns=patterns,
        sources=sources,
        caveats=caveats,
    )
    if not profile.cycle:
        problems.append("the profile names no application cycle, so its requirements cannot be dated")
    return profile, problems
