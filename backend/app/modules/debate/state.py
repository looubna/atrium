"""The explicit state of a debate in progress.

The conversation history is not the state. A model reading back a transcript will
forget which objections it already made, which of its own it never answered, and
which of the user's claims contradict each other — and it will happily ask the same
question three ways. So the application keeps the state, deterministically, and
tells the opponent only what it needs for its next turn.

This object is written into `liveSessions/{id}` as the debate runs (so a dropped
connection resumes into the same debate, mid-argument) and copied onto the session
when it ends, where the evaluator and the argument map read it.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from app.modules.debate.argument import (
    Argument,
    Challenge,
    ChallengeTarget,
    Concession,
    Contradiction,
    Definition,
    Evidence,
    Phase,
    Side,
    Support,
    is_repeat,
    parse_phase,
)

#: Caps. A 20-minute debate produces perhaps 25 turns; these are generous, and they
#: keep the live-session document well inside Firestore's 1 MiB limit.
MAX_ARGUMENTS = 60
MAX_CHALLENGES = 80
MAX_CONTRADICTIONS = 20
MAX_CONCESSIONS = 20
MAX_DEFINITIONS = 16
MAX_TOPICS = 40
MAX_TEXT = 600

#: Putting the same objection more often than this is nagging, not pressing.
PRESS_LIMIT = 2


def _clip(text: str, limit: int = MAX_TEXT) -> str:
    return " ".join(str(text).split())[:limit]


@dataclass(slots=True)
class DebateState:
    """Everything the orchestrator needs, and everything feedback is drawn from."""

    phase: Phase = Phase.OPENING
    #: Numbered from 1, incremented for every substantive turn by either side.
    turn: int = 0
    arguments: list[Argument] = field(default_factory=list)
    challenges: list[Challenge] = field(default_factory=list)
    contradictions: list[Contradiction] = field(default_factory=list)
    concessions: list[Concession] = field(default_factory=list)
    definitions: list[Definition] = field(default_factory=list)
    #: Subject areas the debate has been through, so it broadens instead of circling.
    topics_covered: list[str] = field(default_factory=list)
    #: What the opponent has already argued for its own side, to stop it repeating itself.
    ai_points_made: list[str] = field(default_factory=list)
    #: The last action the opponent took, and how many turns in a row it has challenged.
    last_action: str = ""
    consecutive_challenges: int = 0
    #: Turn numbers on which the opponent conceded something — used to space concessions out.
    conceded_on_turns: list[int] = field(default_factory=list)
    #: True once the closing has been asked for, so the opponent stops opening new lines.
    closing_signalled: bool = False

    # -- reading the state ---------------------------------------------------

    def side_arguments(self, side: Side) -> list[Argument]:
        return [a for a in self.arguments if a.side is side]

    def argument(self, argument_id: str) -> Argument | None:
        return next((a for a in self.arguments if a.id == argument_id), None)

    def unanswered_challenges(self, by: Side) -> list[Challenge]:
        """Objections `by` made that the other side has not answered, oldest first.

        The opponent returns to these rather than opening new ground, which is what
        makes it feel like it is actually listening.
        """
        return [c for c in self.challenges if c.by is by and not c.answered]

    def unsupported_claims(self, side: Side) -> list[Argument]:
        return [a for a in self.side_arguments(side) if a.support is Support.UNSUPPORTED and not a.conceded]

    def unraised_contradictions(self, side: Side) -> list[Contradiction]:
        return [c for c in self.contradictions if c.side is side and not c.raised and not c.resolved]

    def challenges_against(self, argument_id: str) -> list[Challenge]:
        return [c for c in self.challenges if c.against == argument_id]

    def targets_used_against(self, argument_id: str) -> set[ChallengeTarget]:
        return {c.target for c in self.challenges_against(argument_id) if c.by is Side.AI}

    def open_lines_of_attack(self) -> list[tuple[Argument, ChallengeTarget]]:
        """Parts of the user's live arguments that have not been attacked yet.

        Ordered so the most telling objection comes first: an unsupported claim is a
        better target than a stated assumption, which is better than a scope quibble.
        Anything already attacked on this argument is excluded, so the opponent moves
        on instead of rephrasing.
        """
        order = (
            ChallengeTarget.CLAIM, ChallengeTarget.ASSUMPTION, ChallengeTarget.EVIDENCE, ChallengeTarget.CAUSALITY,
            ChallengeTarget.REASONING, ChallengeTarget.COUNTEREXAMPLE, ChallengeTarget.TRADEOFF,
            ChallengeTarget.SCOPE, ChallengeTarget.DEFINITION,
        )
        lines: list[tuple[Argument, ChallengeTarget]] = []
        # Newest arguments first: a debate that answers the last thing said feels live.
        for argument in reversed(self.side_arguments(Side.USER)):
            if argument.conceded:
                continue
            used = self.targets_used_against(argument.id)
            for target in order:
                if target in used or not self._applies(argument, target):
                    continue
                lines.append((argument, target))
        return lines

    def _applies(self, argument: Argument, target: ChallengeTarget) -> bool:
        """Whether attacking `target` on this argument would be a real objection.

        Asking for evidence that was already given, or naming an assumption the user
        stated themselves, is the sort of irrelevant objection §21 rules out.
        """
        match target:
            case ChallengeTarget.CLAIM:
                return argument.support is Support.UNSUPPORTED
            case ChallengeTarget.EVIDENCE:
                return bool(argument.evidence) and not all(e.specific for e in argument.evidence)
            case ChallengeTarget.ASSUMPTION:
                # Every argument rests on something. Whether the user *stated* it is what
                # decides who may go after it, and that is the orchestrator's call.
                return True
            case ChallengeTarget.REASONING:
                return bool(argument.reasons)
            case ChallengeTarget.CAUSALITY:
                # Only where something is actually claimed to cause something else.
                return any(
                    word in f"{argument.claim} {' '.join(argument.reasons)}".lower()
                    for word in ("cause", "because", "leads to", "results in", "drives", "reduces", "increases")
                )
            case ChallengeTarget.SCOPE:
                return any(
                    word in argument.claim.lower()
                    for word in ("all", "every", "always", "never", "none", "any", "everyone", "nobody")
                )
            case ChallengeTarget.DEFINITION:
                return not self.definitions
            case _:
                # A counterexample or a trade-off can be put to any claim.
                return True

    def already_challenged(self, text: str) -> bool:
        """True when the opponent has already made this objection, however it was worded."""
        return is_repeat(text, [c.text for c in self.challenges if c.by is Side.AI])

    def already_argued(self, text: str) -> bool:
        return is_repeat(text, self.ai_points_made)

    def ai_conceded_recently(self, within: int = 4) -> bool:
        """An opponent that concedes every other turn has no position left to defend."""
        return any(self.turn - turn < within for turn in self.conceded_on_turns)

    # -- writing the state ---------------------------------------------------

    def next_id(self, prefix: str) -> str:
        counts = {"a": len(self.arguments), "c": len(self.challenges), "x": len(self.contradictions)}
        return f"{prefix}{counts.get(prefix, 0) + 1}"

    def add_argument(self, argument: Argument) -> Argument:
        argument.claim = _clip(argument.claim)
        argument.reasons = [_clip(r) for r in argument.reasons][:6]
        argument.assumptions = [_clip(a) for a in argument.assumptions][:6]
        argument.conclusion = _clip(argument.conclusion)
        for item in argument.evidence:
            item.text = _clip(item.text)
        self.arguments.append(argument)
        del self.arguments[:-MAX_ARGUMENTS]
        return argument

    def add_challenge(self, challenge: Challenge) -> Challenge:
        challenge.text = _clip(challenge.text)
        self.challenges.append(challenge)
        del self.challenges[:-MAX_CHALLENGES]
        target = self.argument(challenge.against)
        if target is not None and challenge.id not in target.challenged_by:
            target.challenged_by.append(challenge.id)
        return challenge

    def answer_challenge(self, challenge_id: str, *, quality: str, by_argument: str = "") -> None:
        """Mark an objection answered. "evaded" and "ignored" still count as answered.

        Otherwise the opponent would press the same point forever; instead it presses
        up to `PRESS_LIMIT` times, and the evasion is recorded for feedback.
        """
        for challenge in self.challenges:
            if challenge.id != challenge_id:
                continue
            if quality in ("direct", "partial"):
                challenge.answered = True
            else:
                challenge.pressed += 1
                challenge.answered = challenge.pressed >= PRESS_LIMIT
            challenge.answer_quality = quality
            challenge.answered_by = by_argument
            return

    def note_topic(self, topic: str) -> None:
        topic = _clip(topic, 80)
        if topic and topic.lower() not in {t.lower() for t in self.topics_covered}:
            self.topics_covered.append(topic)
            del self.topics_covered[:-MAX_TOPICS]

    def note_ai_point(self, point: str) -> None:
        point = _clip(point, 240)
        if point:
            self.ai_points_made.append(point)
            del self.ai_points_made[:-30]

    def note_ai_action(self, action: str) -> None:
        from app.modules.debate.argument import DebateAction

        challenging = action in (
            DebateAction.CHALLENGE.value, DebateAction.PRESS.value, DebateAction.COUNTEREXAMPLE.value
        )
        self.consecutive_challenges = self.consecutive_challenges + 1 if challenging else 0
        if action == DebateAction.CONCEDE.value:
            self.conceded_on_turns.append(self.turn)
            del self.conceded_on_turns[:-6]
        self.last_action = action

    def add_contradiction(self, contradiction: Contradiction) -> Contradiction:
        """Record a contradiction unless the same pair is already known."""
        contradiction.earlier = _clip(contradiction.earlier)
        contradiction.later = _clip(contradiction.later)
        contradiction.why = _clip(contradiction.why)
        for known in self.contradictions:
            if known.side is contradiction.side and is_repeat(contradiction.later, [known.later]):
                return known
        self.contradictions.append(contradiction)
        del self.contradictions[:-MAX_CONTRADICTIONS]
        return contradiction

    def add_concession(self, concession: Concession) -> None:
        concession.text = _clip(concession.text)
        self.concessions.append(concession)
        del self.concessions[:-MAX_CONCESSIONS]

    def add_definition(self, definition: Definition) -> None:
        definition.term = _clip(definition.term, 80)
        definition.meaning = _clip(definition.meaning, 240)
        if definition.term and not any(d.term.lower() == definition.term.lower() for d in self.definitions):
            self.definitions.append(definition)
            del self.definitions[:-MAX_DEFINITIONS]

    # -- persistence ---------------------------------------------------------

    def to_doc(self) -> dict[str, Any]:
        return {
            "phase": self.phase.value,
            "turn": self.turn,
            "arguments": [a.to_doc() for a in self.arguments],
            "challenges": [c.to_doc() for c in self.challenges],
            "contradictions": [c.to_doc() for c in self.contradictions],
            "concessions": [c.to_doc() for c in self.concessions],
            "definitions": [d.to_doc() for d in self.definitions],
            "topicsCovered": self.topics_covered,
            "aiPointsMade": self.ai_points_made,
            "lastAction": self.last_action,
            "consecutiveChallenges": self.consecutive_challenges,
            "concededOnTurns": self.conceded_on_turns,
            "closingSignalled": self.closing_signalled,
        }

    @classmethod
    def from_doc(cls, data: dict[str, Any] | None) -> DebateState:
        data = data or {}
        return cls(
            phase=parse_phase(data.get("phase")),
            turn=int(data.get("turn", 0)),
            arguments=[Argument.from_doc(a) for a in data.get("arguments", []) if isinstance(a, dict)],
            challenges=[Challenge.from_doc(c) for c in data.get("challenges", []) if isinstance(c, dict)],
            contradictions=[Contradiction.from_doc(c) for c in data.get("contradictions", []) if isinstance(c, dict)],
            concessions=[Concession.from_doc(c) for c in data.get("concessions", []) if isinstance(c, dict)],
            definitions=[Definition.from_doc(d) for d in data.get("definitions", []) if isinstance(d, dict)],
            topics_covered=[str(t) for t in data.get("topicsCovered", [])],
            ai_points_made=[str(p) for p in data.get("aiPointsMade", [])],
            last_action=str(data.get("lastAction", "")),
            consecutive_challenges=int(data.get("consecutiveChallenges", 0)),
            conceded_on_turns=[int(t) for t in data.get("concededOnTurns", [])],
            closing_signalled=bool(data.get("closingSignalled", False)),
        )

    def summary(self) -> dict[str, int]:
        """Counts for logging and the session summary; never any of the content."""
        return {
            "turns": self.turn,
            "userArguments": len(self.side_arguments(Side.USER)),
            "aiArguments": len(self.side_arguments(Side.AI)),
            "challengesByAi": len([c for c in self.challenges if c.by is Side.AI]),
            "unansweredByUser": len(self.unanswered_challenges(Side.AI)),
            "contradictions": len(self.contradictions),
            "userConcessions": len([c for c in self.concessions if c.side is Side.USER]),
            "aiConcessions": len([c for c in self.concessions if c.side is Side.AI]),
        }


__all__ = ["PRESS_LIMIT", "DebateState", "Evidence"]
