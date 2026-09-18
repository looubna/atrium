"""The debate brief: everything settled before anybody speaks, and the rules it must pass.

Research, the user's own material and the topic itself are folded into one structured
document (§8). The live debate then runs off this brief instead of searching the web
mid-sentence (§36), and the preparation screen the user sees is a subset of it (§10).

Nothing the model returns is trusted as written: every field is cleaned, capped, and —
for anything presented as a fact — required to name where it came from. A claim with no
source is demoted to an argument rather than shown to the user as established (§7, §22).
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

from app.modules.debate.argument import ClaimType, parse_claim_type
from app.modules.interview.sanitize import clean_list, clean_phrase, clean_text

MAX_FACTS = 16
MAX_ARGUMENTS_PER_SIDE = 8
MAX_CHALLENGES = 10
MAX_CONCEPTS = 10
MAX_MATERIAL_CLAIMS = 40
MAX_SOURCES = 20

Confidence = Literal["high", "medium", "low"]


class SourceTier:
    """Where a source sits in the order §7 asks for. Lower is better."""

    PRIMARY = 1
    ACADEMIC = 2
    INSTITUTIONAL = 3
    JOURNALISM = 4
    OTHER = 5

    #: Domain suffixes and hosts that place a source without having to ask a model.
    BY_SUFFIX: tuple[tuple[str, int], ...] = (
        (".gov", INSTITUTIONAL), (".gov.uk", INSTITUTIONAL), (".europa.eu", INSTITUTIONAL),
        (".who.int", INSTITUTIONAL), (".un.org", INSTITUTIONAL), (".oecd.org", INSTITUTIONAL),
        (".edu", ACADEMIC), (".ac.uk", ACADEMIC),
    )
    BY_HOST: tuple[tuple[str, int], ...] = (
        ("nature.com", ACADEMIC), ("science.org", ACADEMIC), ("arxiv.org", ACADEMIC), ("pubmed", ACADEMIC),
        ("nejm.org", ACADEMIC), ("thelancet.com", ACADEMIC), ("jstor.org", ACADEMIC), ("doi.org", ACADEMIC),
        ("reuters.com", JOURNALISM), ("apnews.com", JOURNALISM), ("bbc.co", JOURNALISM), ("ft.com", JOURNALISM),
        ("economist.com", JOURNALISM), ("nytimes.com", JOURNALISM), ("wsj.com", JOURNALISM),
        ("theguardian.com", JOURNALISM), ("bloomberg.com", JOURNALISM),
    )


def source_tier(domain: str) -> int:
    """How much weight a domain's claims carry, from its name alone.

    Deterministic on purpose: a model asked to rank its own sources rates whatever it
    found most useful highest, which is exactly the judgement we do not want it making.
    """
    host = domain.strip().lower().removeprefix("www.")
    for suffix, tier in SourceTier.BY_SUFFIX:
        if host.endswith(suffix):
            return tier
    for needle, tier in SourceTier.BY_HOST:
        if needle in host:
            return tier
    return SourceTier.OTHER


def rank_sources(sources: list[dict[str, str]]) -> list[dict[str, Any]]:
    """Sources with their tier, best first, so the prep screen shows the good ones."""
    ranked = [{**s, "tier": source_tier(str(s.get("domain", "")))} for s in sources[:MAX_SOURCES]]
    return sorted(ranked, key=lambda s: int(s["tier"]))


# ---------------------------------------------------------------------------
# What the models return


class KeyFactDraft(BaseModel):
    statement: str = Field(description="One sentence, as neutral as it can be made")
    claimType: str = Field(
        description="fact (settled and checkable), source_based (a specific source says it), argument (a position "
        "someone argues), interpretation (a reading of evidence), or opinion (a value judgement)"
    )
    sourceIds: list[str] = Field(description="Ids of the sources this rests on, from the list given; empty if none")
    #: Which side of the motion the fact is inconvenient for. Both sides get theirs.
    favours: str = Field(description="for, against, or neither")
    confidence: str = Field(description="high, medium or low")


class SideArgumentDraft(BaseModel):
    claim: str = Field(description="The argument in one sentence, as its side would put it")
    reason: str = Field(description="Why it holds")
    evidence: str = Field(description="What supports it, specifically; empty when nothing does")
    weakness: str = Field(description="The best objection to it")


class ChallengeAreaDraft(BaseModel):
    area: str = Field(description="Short name for the line of attack, e.g. 'Pace of the transition'")
    question: str = Field(description="The hardest question in this area, as an opponent would ask it")
    why: str = Field(description="One sentence on why it is hard to answer")


class DebateBriefDraft(BaseModel):
    """The whole brief, as one structured answer."""

    motion: str = Field(description="The motion as it will be debated, phrased so a side can be taken on it")
    topicContext: str = Field(description="Three or four sentences on what is actually at stake, taking no side")
    concepts: list[str] = Field(description="Terms that must be pinned down for the debate to make sense")
    keyFacts: list[KeyFactDraft]
    argumentsFor: list[SideArgumentDraft]
    argumentsAgainst: list[SideArgumentDraft]
    challengeAreas: list[ChallengeAreaDraft] = Field(
        description="Where the user's own side is weakest, so they can prepare — not your plan of attack"
    )
    caveats: list[str] = Field(description="What is genuinely unsettled or unknown about the topic")


class BriefRejected(ValueError):
    def __init__(self, problems: list[str]) -> None:
        super().__init__("; ".join(problems[:10]))
        self.problems = problems


def _favours(value: str) -> str:
    return value if value in ("for", "against", "neither") else "neither"


def _confidence(value: str) -> Confidence:
    return value if value in ("high", "medium", "low") else "low"  # type: ignore[return-value]


def validate_brief(
    draft: DebateBriefDraft, *, topic: str, source_ids: set[str]
) -> tuple[dict[str, Any], list[str]]:
    """Cleaned, storable fields plus the problems found. Non-fatal problems drop content.

    The one rule enforced hard: nothing keeps the label "fact" without a source behind
    it. An unsourced fact becomes an argument, which is what it actually is.
    """
    problems: list[str] = []

    facts: list[dict[str, Any]] = []
    for fact in draft.keyFacts[:MAX_FACTS]:
        statement = clean_phrase(fact.statement, 300)
        if not statement:
            continue
        cited = [sid for sid in fact.sourceIds if sid in source_ids][:4]
        claim_type = parse_claim_type(fact.claimType)
        if claim_type in (ClaimType.FACT, ClaimType.SOURCE_BASED) and not cited:
            # Presenting this as established would be exactly the failure §22 forbids.
            problems.append(f"no source for the claimed fact {statement[:60]!r}")
            claim_type = ClaimType.ARGUMENT
        facts.append(
            {
                "statement": statement,
                "claimType": claim_type.value,
                "sourceIds": cited,
                "favours": _favours(fact.favours),
                "confidence": _confidence(fact.confidence),
            }
        )

    def side(items: list[SideArgumentDraft]) -> list[dict[str, str]]:
        out: list[dict[str, str]] = []
        for item in items[:MAX_ARGUMENTS_PER_SIDE]:
            claim = clean_phrase(item.claim, 240)
            if not claim:
                continue
            out.append(
                {
                    "claim": claim,
                    "reason": clean_phrase(item.reason, 240),
                    "evidence": clean_phrase(item.evidence, 240),
                    "weakness": clean_phrase(item.weakness, 240),
                }
            )
        return out

    challenges: list[dict[str, str]] = []
    for area in draft.challengeAreas[:MAX_CHALLENGES]:
        name = clean_phrase(area.area, 90)
        question = clean_phrase(area.question, 240)
        if not name or not question:
            continue
        challenges.append({"area": name, "question": question, "why": clean_phrase(area.why, 200)})

    fields = {
        "motion": clean_phrase(draft.motion, 240) or clean_phrase(topic, 240),
        "topicContext": clean_text(draft.topicContext, 900),
        "concepts": clean_list(draft.concepts, max_items=MAX_CONCEPTS, max_chars=90),
        "keyFacts": facts,
        "argumentsFor": side(draft.argumentsFor),
        "argumentsAgainst": side(draft.argumentsAgainst),
        "challengeAreas": challenges,
        "caveats": clean_list(draft.caveats, max_items=6, max_chars=200),
    }
    if not fields["argumentsFor"] or not fields["argumentsAgainst"]:
        # A one-sided brief makes a one-sided debate, whichever side the user takes.
        problems.append("the brief does not have arguments on both sides")
    if not fields["topicContext"]:
        problems.append("the topic context is empty")
    return fields, problems


# ---------------------------------------------------------------------------
# What the user's own material yields


class MaterialClaimDraft(BaseModel):
    """One retrievable thing found in a document the user handed over (§9)."""

    text: str = Field(description="The claim, argument, definition or piece of evidence, in one or two sentences")
    kind: str = Field(description="claim, evidence, definition, assumption, contradiction or fact")
    #: The material it came from, so the user can be told where it is.
    materialId: str
    #: A short verbatim quote, so nothing is attributed to a document that is not in it.
    quote: str = Field(description="A few words copied exactly from the material")
    topic: str = Field(description="Short topic label, for retrieving it later")


class MaterialTopicDraft(BaseModel):
    motion: str = Field(description="A debatable motion this material supports arguing about, phrased for/against")
    why: str = Field(description="One sentence on what in the material makes this debatable")
    #: Whether the material itself takes a side, which changes how the debate should be set up.
    materialTakesSide: str = Field(description="for, against or neither")


class MaterialReadingDraft(BaseModel):
    summary: str = Field(description="Two or three sentences on what these documents are about")
    topics: list[MaterialTopicDraft] = Field(description="Motions worth debating, best first")
    claims: list[MaterialClaimDraft]
    contradictions: list[str] = Field(description="Places the material argues against itself")


_CLAIM_KINDS = frozenset({"claim", "evidence", "definition", "assumption", "contradiction", "fact"})


def validate_material_reading(
    draft: MaterialReadingDraft, material_ids: set[str]
) -> tuple[dict[str, Any], list[str]]:
    problems: list[str] = []
    claims: list[dict[str, str]] = []
    for claim in draft.claims[:MAX_MATERIAL_CLAIMS]:
        text = clean_phrase(claim.text, 400)
        if not text:
            continue
        if claim.materialId not in material_ids:
            problems.append(f"claim attributed to unknown material {claim.materialId[:40]!r}")
            continue
        claims.append(
            {
                "text": text,
                "kind": claim.kind if claim.kind in _CLAIM_KINDS else "claim",
                "materialId": claim.materialId,
                "quote": clean_phrase(claim.quote, 200),
                "topic": clean_phrase(claim.topic, 80),
            }
        )

    topics: list[dict[str, str]] = []
    for topic in draft.topics[:6]:
        motion = clean_phrase(topic.motion, 240)
        if not motion:
            continue
        topics.append(
            {
                "motion": motion,
                "why": clean_phrase(topic.why, 200),
                "materialTakesSide": _favours(topic.materialTakesSide),
            }
        )
    if not topics:
        problems.append("no debatable motion was found in the material")

    return (
        {
            "summary": clean_text(draft.summary, 700),
            "topics": topics,
            "claims": claims,
            "contradictions": clean_list(draft.contradictions, max_items=8, max_chars=240),
        },
        problems,
    )
