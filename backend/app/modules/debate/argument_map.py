"""The argument map shown after the debate (§27).

Built from the state the system kept while the debate ran, not generated afterwards by
a model. That matters twice over: the map is exactly what the opponent was reasoning
about, so it cannot disagree with the debate the user just had; and every mark on it —
"unsupported", "you never answered this", "this contradicted what you said earlier" — is
a fact the application recorded at the time rather than a judgement made in hindsight.

    YOUR POSITION
    │
    ├── Argument 1
    │   ├── Evidence ✓
    │   └── Opponent's challenge
    │       └── Your response
    │
    ├── Argument 2
    │   ├── Assumption ⚠
    │   └── Opponent's counterexample
    │
    └── Argument 3
        └── Unsupported claim ⚠
"""

from __future__ import annotations

import re
from typing import Any

from app.modules.debate.argument import Side, Support
from app.modules.debate.state import DebateState

#: Marks the app renders next to a part of an argument.
FLAG_UNSUPPORTED = "unsupported"
FLAG_ASSUMPTION = "assumption"
FLAG_EVIDENCE_OK = "evidence_ok"
FLAG_EVIDENCE_VAGUE = "evidence_vague"
FLAG_UNANSWERED = "unanswered"
FLAG_EVADED = "evaded"
FLAG_CONTRADICTED = "contradicted"
FLAG_CONCEDED = "conceded"


def _argument_node(state: DebateState, argument: Any) -> dict[str, Any]:
    flags: list[str] = []
    if argument.support is Support.UNSUPPORTED:
        flags.append(FLAG_UNSUPPORTED)
    if argument.evidence:
        flags.append(FLAG_EVIDENCE_OK if any(e.specific for e in argument.evidence) else FLAG_EVIDENCE_VAGUE)
    if argument.assumptions:
        flags.append(FLAG_ASSUMPTION)
    if argument.conceded:
        flags.append(FLAG_CONCEDED)

    challenges: list[dict[str, Any]] = []
    for challenge in state.challenges_against(argument.id):
        if challenge.by is not Side.AI:
            continue
        response = state.argument(challenge.answered_by) if challenge.answered_by else None
        if not challenge.answered:
            flags.append(FLAG_UNANSWERED)
        elif challenge.answer_quality in ("evaded", "ignored"):
            flags.append(FLAG_EVADED)
        challenges.append(
            {
                "id": challenge.id,
                "target": challenge.target.value,
                "text": challenge.text,
                "atMs": challenge.at_ms,
                "answered": challenge.answered,
                "quality": challenge.answer_quality,
                "pressed": challenge.pressed,
                "response": (
                    {"claim": response.claim, "atMs": response.at_ms} if response is not None else None
                ),
            }
        )

    if any(
        c.side is Side.USER and (c.later == argument.claim or c.earlier == argument.claim)
        for c in state.contradictions
    ):
        flags.append(FLAG_CONTRADICTED)

    return {
        "id": argument.id,
        "claim": argument.claim,
        "atMs": argument.at_ms,
        "turn": argument.turn,
        "support": argument.support.value,
        "reasons": argument.reasons,
        "evidence": [e.to_doc() for e in argument.evidence],
        "assumptions": argument.assumptions,
        "conclusion": argument.conclusion,
        # Order-stable and de-duplicated: the app renders one badge per distinct mark.
        "flags": list(dict.fromkeys(flags)),
        "challenges": challenges,
    }


def build(state: DebateState, *, motion: str, user_position: str, ai_position: str) -> dict[str, Any]:
    """The map, as the app renders it. Plain data: no model, no scores, no prose."""
    return {
        "motion": motion,
        "userPosition": user_position,
        "aiPosition": ai_position,
        "arguments": [_argument_node(state, a) for a in state.side_arguments(Side.USER)],
        "opponentArguments": [
            {"id": a.id, "claim": a.claim, "atMs": a.at_ms, "turn": a.turn}
            for a in state.side_arguments(Side.AI)
        ],
        "contradictions": [
            c.to_doc() for c in state.contradictions if c.side is Side.USER
        ],
        "concessions": [c.to_doc() for c in state.concessions],
        "definitions": [d.to_doc() for d in state.definitions],
        "unansweredChallenges": [
            {"id": c.id, "text": c.text, "target": c.target.value, "atMs": c.at_ms}
            for c in state.unanswered_challenges(Side.AI)
        ],
        "topicsCovered": state.topics_covered,
        "counts": state.summary(),
    }


def patterns(state: DebateState) -> list[str]:
    """The habits the debate actually showed, counted rather than inferred (§30).

    Each of these is a pattern the evaluator is told to look for and explain with
    examples; deriving them here means the evaluator cannot invent one that did not
    happen, or miss one that did.
    """
    found: list[str] = []
    user_arguments = state.side_arguments(Side.USER)
    ai_challenges = [c for c in state.challenges if c.by is Side.AI]

    unsupported = [a for a in user_arguments if a.support is Support.UNSUPPORTED]
    if user_arguments and len(unsupported) >= max(2, len(user_arguments) // 3):
        found.append("claims_without_evidence")

    evaded = [c for c in ai_challenges if c.answer_quality in ("evaded", "ignored")]
    if len(evaded) >= 2:
        found.append("answering_a_different_question")

    if state.unanswered_challenges(Side.AI):
        found.append("ignored_objections")

    if any(c.pressed >= 1 for c in ai_challenges):
        found.append("weak_rebuttals")

    if len(state.contradictions) >= 1:
        found.append("contradictions")

    if any(a.assumptions and a.support is not Support.SUPPORTED for a in user_arguments):
        found.append("unexamined_assumptions")

    sweeping = re.compile(r"\b(all|every|always|never|none|nobody|everyone|everything|no one)\b", re.I)
    broad = [a for a in user_arguments if sweeping.search(a.claim)]
    if broad:
        found.append("overgeneralisation")

    if not any(e.specific for a in user_arguments for e in a.evidence):
        found.append("no_specific_examples")

    if not [c for c in state.concessions if c.side is Side.USER]:
        found.append("never_conceded_a_point")

    # Repetition: two of their own arguments that say the same thing.
    from app.modules.debate.argument import similarity

    for index, argument in enumerate(user_arguments):
        if any(similarity(argument.claim, other.claim) >= 0.55 for other in user_arguments[index + 1 :]):
            found.append("repeating_the_same_argument")
            break

    return found


#: What each pattern means, for the evaluator's prompt and the app's labels.
PATTERN_LABELS: dict[str, str] = {
    "claims_without_evidence": "Making claims without evidence",
    "answering_a_different_question": "Answering a different question",
    "ignored_objections": "Leaving objections unanswered",
    "weak_rebuttals": "Rebuttals that had to be asked for twice",
    "contradictions": "Contradicting an earlier claim",
    "unexamined_assumptions": "Leaving assumptions unexamined",
    "overgeneralisation": "Overgeneralising",
    "no_specific_examples": "No specific examples",
    "never_conceded_a_point": "Never conceding a reasonable point",
    "repeating_the_same_argument": "Repeating the same argument",
}
