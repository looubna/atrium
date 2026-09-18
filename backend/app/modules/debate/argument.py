"""The structural model of an argument, and how two arguments are told apart.

A debate is not a list of utterances. Every substantive turn is an argument with
parts that can each be attacked on their own:

    Claim
    ├── Reason
    │   ├── Evidence
    │   └── Example
    ├── Assumption
    └── Conclusion

Representing that explicitly is what lets the opponent attack the assumption behind
a claim rather than the claim itself, come back to a reason nobody answered, and
notice that a new claim contradicts an old one. It is also what the argument map
after the debate is drawn from.

Nothing here calls a model. The analyzer (`agents/analyzer.py`) fills these
structures in; the orchestrator reads them.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any


class Side(StrEnum):
    USER = "user"
    AI = "ai"

    @property
    def other(self) -> Side:
        return Side.AI if self is Side.USER else Side.USER


class ClaimType(StrEnum):
    """What kind of thing a statement is — never blurred, in either direction (§7, §22).

    An opinion presented as a fact is the single most common way a debate coach
    misleads someone, so the distinction is carried in the data rather than left to
    the wording of a prompt.
    """

    FACT = "fact"
    SOURCE_BASED = "source_based"
    ARGUMENT = "argument"
    INTERPRETATION = "interpretation"
    OPINION = "opinion"


def parse_claim_type(value: str | None) -> ClaimType:
    try:
        return ClaimType(str(value))
    except ValueError:
        # Unrecognised means "we don't know it's a fact", which is the safe direction.
        return ClaimType.ARGUMENT


class ChallengeTarget(StrEnum):
    """What part of an argument an objection goes after (§15).

    The orchestrator picks one of these per turn, so the opponent makes the single
    most telling objection instead of spraying every possible one.
    """

    CLAIM = "claim"
    EVIDENCE = "evidence"
    REASONING = "reasoning"
    ASSUMPTION = "assumption"
    DEFINITION = "definition"
    SCOPE = "scope"
    CAUSALITY = "causality"
    COUNTEREXAMPLE = "counterexample"
    TRADEOFF = "tradeoff"
    CONSISTENCY = "consistency"


def parse_target(value: str | None) -> ChallengeTarget | None:
    try:
        return ChallengeTarget(str(value))
    except ValueError:
        return None


#: How each target is put to the user, in the opponent's own terms. The debater agent
#: is told which one to make; this is the instruction it gets, not a script to read out.
TARGET_BRIEFS: dict[ChallengeTarget, str] = {
    ChallengeTarget.CLAIM: "the claim is asserted but never supported — ask what supports it",
    ChallengeTarget.EVIDENCE: "the evidence is vague, second-hand or does not bear on the claim — press on what it "
    "actually shows",
    ChallengeTarget.REASONING: "the conclusion does not follow from the reasons — show the step that is missing",
    ChallengeTarget.ASSUMPTION: "the argument only works if something unstated is true — name that assumption and "
    "ask why it holds",
    ChallengeTarget.DEFINITION: "the two of you are using a key term differently — pin the term down before going on",
    ChallengeTarget.SCOPE: "the claim is broader than the support — ask whether it holds everywhere or only in the "
    "case they described",
    ChallengeTarget.CAUSALITY: "a correlation is being treated as a cause — ask what rules out the other explanation",
    ChallengeTarget.COUNTEREXAMPLE: "there is a concrete case the claim does not survive — give it, specifically",
    ChallengeTarget.TRADEOFF: "the argument ignores a cost or an unintended consequence — put that cost to them",
    ChallengeTarget.CONSISTENCY: "this conflicts with something they argued earlier — quote both and ask them to "
    "reconcile it",
}


class DebateAction(StrEnum):
    """What the opponent does on its next turn (§13).

    Chosen by application code from the state, not by the live model, so the debate
    has a shape someone decided on rather than whatever the model felt like doing.
    """

    OPEN = "open"
    ARGUE = "argue"
    CHALLENGE = "challenge"
    REBUT = "rebut"
    CLARIFY = "clarify"
    COUNTEREXAMPLE = "counterexample"
    CONCEDE = "concede"
    PRESS = "press"
    TRANSITION = "transition"
    CLOSE = "close"


class Phase(StrEnum):
    """Where the debate has got to (§18). Flexible: the orchestrator can skip or revisit."""

    OPENING = "opening"
    POSITIONS = "positions"
    DEVELOPMENT = "development"
    CHALLENGE = "challenge"
    REBUTTAL = "rebuttal"
    DEEP_CHALLENGE = "deep_challenge"
    COUNTERARGUMENT = "counterargument"
    FINAL_DEFENCE = "final_defence"
    CLOSING = "closing"


def parse_phase(value: str | None) -> Phase:
    try:
        return Phase(str(value))
    except ValueError:
        return Phase.OPENING


class Support(StrEnum):
    SUPPORTED = "supported"
    UNSUPPORTED = "unsupported"
    #: Backed by something, but by an appeal or an anecdote rather than evidence.
    ASSERTED = "asserted"


def parse_support(value: str | None) -> Support:
    try:
        return Support(str(value))
    except ValueError:
        return Support.ASSERTED


@dataclass(slots=True)
class Evidence:
    """Something offered in support. `kind` is how good it is, not how it was phrased."""

    text: str
    claim_type: ClaimType = ClaimType.ARGUMENT
    #: Where it came from, if the speaker said: "a Stanford study", "my own team". Empty when nobody said.
    attribution: str = ""
    specific: bool = False

    def to_doc(self) -> dict[str, Any]:
        return {
            "text": self.text, "claimType": self.claim_type.value,
            "attribution": self.attribution, "specific": self.specific,
        }

    @classmethod
    def from_doc(cls, data: dict[str, Any]) -> Evidence:
        return cls(
            text=str(data.get("text", "")),
            claim_type=parse_claim_type(data.get("claimType")),
            attribution=str(data.get("attribution", "")),
            specific=bool(data.get("specific", False)),
        )


@dataclass(slots=True)
class Argument:
    """One argument, as its parts."""

    id: str
    side: Side
    claim: str
    #: The media-clock millisecond the claim was made at, so feedback can link to the recording.
    at_ms: int = 0
    turn: int = 0
    reasons: list[str] = field(default_factory=list)
    evidence: list[Evidence] = field(default_factory=list)
    assumptions: list[str] = field(default_factory=list)
    conclusion: str = ""
    support: Support = Support.ASSERTED
    claim_type: ClaimType = ClaimType.ARGUMENT
    #: Ids of challenges made against this argument.
    challenged_by: list[str] = field(default_factory=list)
    #: True once its own side has been forced to give it up.
    conceded: bool = False

    def to_doc(self) -> dict[str, Any]:
        return {
            "id": self.id, "side": self.side.value, "claim": self.claim, "atMs": self.at_ms, "turn": self.turn,
            "reasons": self.reasons, "evidence": [e.to_doc() for e in self.evidence],
            "assumptions": self.assumptions, "conclusion": self.conclusion, "support": self.support.value,
            "claimType": self.claim_type.value, "challengedBy": self.challenged_by, "conceded": self.conceded,
        }

    @classmethod
    def from_doc(cls, data: dict[str, Any]) -> Argument:
        return cls(
            id=str(data.get("id", "")),
            side=Side(str(data.get("side", Side.USER.value))),
            claim=str(data.get("claim", "")),
            at_ms=int(data.get("atMs", 0)),
            turn=int(data.get("turn", 0)),
            reasons=[str(r) for r in data.get("reasons", [])],
            evidence=[Evidence.from_doc(e) for e in data.get("evidence", []) if isinstance(e, dict)],
            assumptions=[str(a) for a in data.get("assumptions", [])],
            conclusion=str(data.get("conclusion", "")),
            support=parse_support(data.get("support")),
            claim_type=parse_claim_type(data.get("claimType")),
            challenged_by=[str(c) for c in data.get("challengedBy", [])],
            conceded=bool(data.get("conceded", False)),
        )


@dataclass(slots=True)
class Challenge:
    """An objection one side put to the other, and what became of it."""

    id: str
    by: Side
    target: ChallengeTarget
    #: The argument being attacked.
    against: str
    text: str
    at_ms: int = 0
    turn: int = 0
    answered: bool = False
    #: How well it was answered once it was: "direct", "partial", "evaded", "ignored".
    answer_quality: str = ""
    #: The argument id of the answer, when the reply was itself an argument.
    answered_by: str = ""
    #: How many times it has been put again without a direct answer. Caps at PRESS_LIMIT.
    pressed: int = 0

    def to_doc(self) -> dict[str, Any]:
        return {
            "id": self.id, "by": self.by.value, "target": self.target.value, "against": self.against,
            "text": self.text, "atMs": self.at_ms, "turn": self.turn, "answered": self.answered,
            "answerQuality": self.answer_quality, "answeredBy": self.answered_by, "pressed": self.pressed,
        }

    @classmethod
    def from_doc(cls, data: dict[str, Any]) -> Challenge:
        return cls(
            id=str(data.get("id", "")),
            by=Side(str(data.get("by", Side.AI.value))),
            target=parse_target(data.get("target")) or ChallengeTarget.CLAIM,
            against=str(data.get("against", "")),
            text=str(data.get("text", "")),
            at_ms=int(data.get("atMs", 0)),
            turn=int(data.get("turn", 0)),
            answered=bool(data.get("answered", False)),
            answer_quality=str(data.get("answerQuality", "")),
            answered_by=str(data.get("answeredBy", "")),
            pressed=int(data.get("pressed", 0)),
        )


@dataclass(slots=True)
class Contradiction:
    """Two things the same side argued that cannot both be true."""

    id: str
    side: Side
    earlier: str
    later: str
    why: str
    at_ms: int = 0
    #: True once it has been put to them, so it is never raised twice.
    raised: bool = False
    resolved: bool = False

    def to_doc(self) -> dict[str, Any]:
        return {
            "id": self.id, "side": self.side.value, "earlier": self.earlier, "later": self.later,
            "why": self.why, "atMs": self.at_ms, "raised": self.raised, "resolved": self.resolved,
        }

    @classmethod
    def from_doc(cls, data: dict[str, Any]) -> Contradiction:
        return cls(
            id=str(data.get("id", "")),
            side=Side(str(data.get("side", Side.USER.value))),
            earlier=str(data.get("earlier", "")),
            later=str(data.get("later", "")),
            why=str(data.get("why", "")),
            at_ms=int(data.get("atMs", 0)),
            raised=bool(data.get("raised", False)),
            resolved=bool(data.get("resolved", False)),
        )


@dataclass(slots=True)
class Concession:
    """A point one side granted. Granting one is a strength, not a loss (§14, §30)."""

    side: Side
    text: str
    at_ms: int = 0
    #: True when the side conceded the point but kept its overall position, which is what good looks like.
    kept_position: bool = True

    def to_doc(self) -> dict[str, Any]:
        return {"side": self.side.value, "text": self.text, "atMs": self.at_ms, "keptPosition": self.kept_position}

    @classmethod
    def from_doc(cls, data: dict[str, Any]) -> Concession:
        return cls(
            side=Side(str(data.get("side", Side.AI.value))),
            text=str(data.get("text", "")),
            at_ms=int(data.get("atMs", 0)),
            kept_position=bool(data.get("keptPosition", True)),
        )


@dataclass(slots=True)
class Definition:
    """A term one side pinned down, so neither can quietly change it later."""

    term: str
    meaning: str
    agreed: bool = False

    def to_doc(self) -> dict[str, Any]:
        return {"term": self.term, "meaning": self.meaning, "agreed": self.agreed}

    @classmethod
    def from_doc(cls, data: dict[str, Any]) -> Definition:
        return cls(
            term=str(data.get("term", "")), meaning=str(data.get("meaning", "")), agreed=bool(data.get("agreed", False))
        )


# ---------------------------------------------------------------------------
# Telling two objections apart
#
# "But what about jobs?", "What about employment?" and "Could jobs be affected?"
# are one objection asked three times, and an opponent that does that stops being
# worth debating (§25). Comparing the strings does not catch it; comparing their
# content words does.

_STOPWORDS = frozenset(
    """
    a about above after again against all also am an and any are as at be because been before being below between
    both but by can cannot could did do does doing down during each few for from further had has have having he her
    here hers him his how i if in into is it its itself just me might more most must my no nor not now of off on once
    only or other our out over own same she should so some such than that the their them then there these they this
    those through to too under until up very was we were what when where which while who whom why will with would you
    your yours isn didn doesn won wouldn couldn shouldn really actually maybe perhaps think thing things lot bit sort
    kind point sure mean say said says well okay yeah yes right
    """.split()
)

#: Suffixes stripped so "employment"/"employ", "jobs"/"job" and "regulating"/"regulate"
#: collapse. Applied repeatedly, because the interesting cases stack: "regulating" loses
#: "ing" to leave "regulat", which then loses "at" to meet "regulation"'s "regul".
_SUFFIXES = ("ationally", "ization", "isation", "ational", "ments", "ingly", "ation", "ement", "ness", "ing",
             "ies", "ers", "est", "ed", "es", "ly", "er", "at", "s")

#: A stem never drops below this, so "gas" does not become "ga".
MIN_STEM = 3
#: Passes of suffix stripping. Two reaches "regulating" -> "regulat" -> "regul"; more would
#: start eroding real words.
_STEM_PASSES = 2

#: Two objections this similar are the same objection. Deliberately conservative: a false
#: "same" makes the application forget an objection the opponent actually made, which is
#: worse than missing a reworded one. The exact guarantee against repetition is structural
#: — the orchestrator never attacks the same part of the same argument twice
#: (`DebateState.targets_used_against`) — and this is the net underneath it, for when the
#: model words a new objection so closely that it would read as a repeat anyway.
#:
#: It compares vocabulary, so it cannot know that "jobs" and "employment" are the same
#: subject. Nothing here pretends otherwise; that case is caught structurally instead.
SAME_CHALLENGE_SIMILARITY = 0.62


def _stem(word: str) -> str:
    for _ in range(_STEM_PASSES):
        for suffix in _SUFFIXES:
            if len(word) - len(suffix) >= MIN_STEM and word.endswith(suffix):
                word = word[: -len(suffix)]
                break
        else:
            break
    return word


def content_words(text: str) -> frozenset[str]:
    """The words that carry the meaning of an utterance, stemmed crudely on purpose.

    Crude is right here: this decides whether two objections are the same, and the cost of
    being wrong is bounded in both directions (see `SAME_CHALLENGE_SIMILARITY`).
    """
    words = re.findall(r"[a-z]+", text.lower())
    return frozenset(_stem(w) for w in words if w not in _STOPWORDS and len(w) > 2)


def similarity(left: str, right: str) -> float:
    """How much two utterances say the same thing, 0..1.

    The Dice coefficient rather than Jaccard, because objections differ wildly in length:
    "What about jobs?" and "Could jobs be affected?" share everything the shorter one has,
    and Jaccard would score that pair below a pair of long sentences that merely share a
    subject.
    """
    a, b = content_words(left), content_words(right)
    if not a or not b:
        return 0.0
    return 2 * len(a & b) / (len(a) + len(b))


def is_repeat(text: str, previous: list[str], threshold: float = SAME_CHALLENGE_SIMILARITY) -> bool:
    """True when `text` says what one of `previous` already said."""
    return any(similarity(text, earlier) >= threshold for earlier in previous)
