"""What may be said about a scholarship, and how firmly.

The research behind this module is unusually mixed. Some of it is a funder's own published
criteria. Most of the interesting part is strangers on Reddit, YouTube and personal blogs
describing an interview they sat, sometimes years ago, sometimes for a different track, and
almost always without saying whether they were selected. Treating those two as one kind of
fact is the single failure that would make the feature worse than useless: a candidate who
walks into a panel believing an invented requirement is worse off than one who never used us.

So every insight carries the tier it was learned at (`catalogs.EvidenceTier`) and the sources
it came from, and this module holds the rules that keeps those honest:

- anything above `INFERENCE` must name a source it was read in;
- an inference may never cite an external source, because it was not read anywhere;
- nothing may claim that any attribute *caused* a selection, however the model phrases it.

The last rule is enforced with a matcher rather than left to the prompt. A prompt instruction
is a request; a validator is a guarantee, and this is a claim the model has every incentive
to make because it reads as helpful.
"""

from __future__ import annotations

import re
from typing import Any

from pydantic import BaseModel, Field

from app.modules.admission.catalogs import TIER_VOICE, EvidenceTier, parse_tier

MAX_TEXT = 400
MAX_SOURCES_PER_INSIGHT = 6


class SourceDraft(BaseModel):
    """One thing the researcher actually read."""

    id: str = Field(description="Short id such as s1, referenced by insights")
    title: str
    domain: str = Field(description="Website domain, e.g. gks.go.kr")
    tier: str = Field(description="official, reported, secondary")
    published: str = Field(description="Year or cycle the source describes, e.g. '2026'; empty if unknown")


class InsightDraft(BaseModel):
    """One thing learned about the opportunity, with where it came from."""

    text: str
    tier: str
    sourceIds: list[str] = Field(default_factory=list)
    #: The application cycle this is true of. Kept per insight, not per profile: a page of
    #: 2026 requirements and a 2023 interview account routinely sit in the same research run.
    cycle: str = ""


class Insight(BaseModel):
    """A validated insight. Nothing reaches the candidate that is not one of these."""

    text: str
    tier: EvidenceTier
    sourceIds: tuple[str, ...] = ()
    cycle: str = ""

    def attributed(self) -> str:
        """The insight as it may be spoken to the candidate, with its hedge attached."""
        return f"{TIER_VOICE[self.tier]} {self.text[0].lower() + self.text[1:]}" if self.text else ""


#: Claims that selection was *caused* by something. The model reaches for these because they
#: are the most useful-sounding sentence it can write, and they are the one thing nobody can
#: know: the published accounts are self-selected, self-reported, and never include the people
#: who had the same profile and were rejected.
_CAUSAL = re.compile(
    r"\b("
    r"because (?:they|he|she|the candidate)s? (?:had|have|were|was|did)"
    r"|(?:that|this) is why (?:they|he|she) (?:were|was|got)"
    r"|led to (?:their|his|her) (?:selection|acceptance|award)"
    r"|(?:guarantee|guarantees|guaranteed|ensures?|ensured|secures?|secured) (?:you |your |their |a |an |the )?"
    r"(?:selection|acceptance|place|award|scholarship|admission|spot)"
    r"|(?:will|would) (?:get|win|secure) you (?:a |an |the )?(?:place|scholarship|award|spot)"
    r"|key to (?:being )?(?:selected|accepted|awarded)"
    r"|(?:selected|accepted|awarded) (?:because|due to|thanks to)"
    r")\b",
    re.IGNORECASE,
)

#: Telling a candidate to become someone else. The spec forbids it and so does the point of
#: the feature: a panel is interviewing them, and a borrowed story collapses on the first
#: follow-up question.
_IMITATION = re.compile(
    r"\b("
    r"(?:copy|imitate|emulate|mimic|replicate) (?:the |their |these |successful |selected )?"
    r"(?:selected |successful )?(?:candidates?|scholars?|recipients?|applicants?|profiles?|answers?)"
    r"|do what (?:they|the selected candidates?) did"
    r"|model yourself on"
    r")\b",
    re.IGNORECASE,
)


def integrity_problems(text: str) -> list[str]:
    """What is wrong with this sentence, if anything. Empty means it may be shown."""
    problems: list[str] = []
    if match := _CAUSAL.search(text):
        problems.append(
            f"claims selection was caused by an attribute ({match.group(0)!r}); "
            "published accounts cannot support causation"
        )
    if match := _IMITATION.search(text):
        problems.append(f"tells the candidate to imitate other applicants ({match.group(0)!r})")
    return problems


def validate_insight(draft: InsightDraft, known_sources: set[str]) -> tuple[Insight | None, list[str]]:
    """One insight, checked. Returns the insight and anything that had to be said about it.

    A problem is not always fatal. An insight that cites a source we did not retrieve is
    dropped, because the citation is the only thing making it more than a guess; an insight
    that merely carries an unknown tier is kept at `INFERENCE`, the weakest reading.
    """
    problems: list[str] = []
    text = " ".join(str(draft.text or "").split())[:MAX_TEXT]
    if not text:
        return None, ["empty insight"]

    if found := integrity_problems(text):
        return None, found

    tier = parse_tier(draft.tier)
    cited = tuple(dict.fromkeys(s for s in draft.sourceIds if s in known_sources))[:MAX_SOURCES_PER_INSIGHT]
    if unknown := [s for s in draft.sourceIds if s not in known_sources]:
        problems.append(f"insight cites sources that were never retrieved: {', '.join(sorted(set(unknown))[:3])}")

    if tier is EvidenceTier.INFERENCE:
        # An inference was not read anywhere; a citation on it would dress a guess as a finding.
        cited = ()
    elif not cited:
        # Nothing to stand on, so it is demoted rather than dropped: it may still be a useful
        # thing to prepare for, just not something we may attribute to the funder.
        problems.append(f"{tier} insight cites no retrievable source; kept as an inference")
        tier = EvidenceTier.INFERENCE

    return Insight(text=text, tier=tier, sourceIds=cited, cycle=" ".join(str(draft.cycle or "").split())[:16]), problems


def validate_sources(drafts: list[SourceDraft]) -> tuple[dict[str, dict[str, Any]], list[str]]:
    """The sources worth keeping, by id. A source with no domain is not a source."""
    kept: dict[str, dict[str, Any]] = {}
    problems: list[str] = []
    for draft in drafts:
        sid = " ".join(str(draft.id or "").split())[:16]
        domain = " ".join(str(draft.domain or "").split()).lower()[:253]
        if not sid or not domain:
            problems.append(f"source {sid or '(unnamed)'} has no domain and was dropped")
            continue
        tier = parse_tier(draft.tier)
        if tier is EvidenceTier.INFERENCE:
            # A source is something that was read. "Inference" is not a place.
            problems.append(f"source {sid} claimed tier 'inference'; recorded as secondary")
            tier = EvidenceTier.SECONDARY
        kept[sid] = {
            "id": sid,
            "title": " ".join(str(draft.title or "").split())[:200] or domain,
            "domain": domain,
            "tier": str(tier),
            "published": " ".join(str(draft.published or "").split())[:16],
        }
    return kept, problems
