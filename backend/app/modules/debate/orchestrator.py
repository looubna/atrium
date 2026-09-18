"""What the opponent should do next, decided by application code.

The live model is very good at *saying* the next thing and very bad at deciding it:
left alone it drifts into interrogation, re-asks what it already asked, and never
returns to the argument it dropped four turns ago. So the move is chosen here, from
the state, and the model is told which move to make and against what.

The choice is deterministic and pure: same state in, same move out. That makes the
opponent's behaviour testable, which is the only way to know a debate at "advanced"
really is harder than one at "beginner" rather than just wordier.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from app.modules.debate.argument import (
    Argument,
    Challenge,
    ChallengeTarget,
    Contradiction,
    DebateAction,
    Phase,
    Side,
    Support,
)
from app.modules.debate.catalogs import DebateFormat, Difficulty, Focus
from app.modules.debate.state import PRESS_LIMIT, DebateState


@dataclass(frozen=True, slots=True)
class Tuning:
    """How hard the opponent plays. This is what difficulty actually means (§20)."""

    #: Challenges in a row before it must advance its own case instead.
    max_consecutive_challenges: int
    #: Objections it may put in one turn. More than one at a time overwhelms a beginner.
    challenges_per_turn: int
    #: Whether it goes after contradictions between the user's own claims.
    tracks_contradictions: bool
    #: Whether it attacks assumptions the user never stated.
    attacks_implicit_assumptions: bool
    #: Whether it returns to arguments the user left unanswered several turns ago.
    revisits_dropped_arguments: bool
    #: Whether it asks the user to defend the cost of their own position.
    forces_tradeoffs: bool
    #: Targets it will not use at this level.
    excluded_targets: frozenset[ChallengeTarget] = frozenset()
    #: How often it checks the user has understood, rather than pressing on.
    clarifies_every: int = 0


TUNING: dict[Difficulty, Tuning] = {
    Difficulty.BEGINNER: Tuning(
        max_consecutive_challenges=1,
        challenges_per_turn=1,
        tracks_contradictions=False,
        attacks_implicit_assumptions=False,
        revisits_dropped_arguments=False,
        forces_tradeoffs=False,
        # A beginner is learning to make an argument at all; picking at causal inference comes later.
        excluded_targets=frozenset({ChallengeTarget.CAUSALITY, ChallengeTarget.CONSISTENCY, ChallengeTarget.SCOPE}),
        clarifies_every=4,
    ),
    Difficulty.INTERMEDIATE: Tuning(
        max_consecutive_challenges=2,
        challenges_per_turn=1,
        tracks_contradictions=True,
        attacks_implicit_assumptions=False,
        revisits_dropped_arguments=True,
        forces_tradeoffs=True,
        excluded_targets=frozenset(),
        clarifies_every=0,
    ),
    Difficulty.ADVANCED: Tuning(
        max_consecutive_challenges=3,
        challenges_per_turn=2,
        tracks_contradictions=True,
        attacks_implicit_assumptions=True,
        revisits_dropped_arguments=True,
        forces_tradeoffs=True,
        excluded_targets=frozenset(),
        clarifies_every=0,
    ),
}

#: Once this little time is left the opponent stops opening new ground and closes.
CLOSING_WINDOW_S = 90
#: And this much before that it starts drawing threads together instead of starting new ones.
FINAL_DEFENCE_WINDOW_S = 180
#: The opponent states its own case this early, so the user has something to argue against.
OPENING_ARGUMENT_TURNS = 2


@dataclass(slots=True)
class Move:
    """The opponent's next turn, as the application decided it."""

    action: DebateAction
    #: What is being attacked, when the move is an objection.
    target: ChallengeTarget | None = None
    against: Argument | None = None
    #: An objection being put again because it was dodged.
    press: Challenge | None = None
    #: A contradiction to put to the user.
    contradiction: Contradiction | None = None
    #: The point the opponent should grant before disagreeing.
    concede: str = ""
    phase: Phase = Phase.DEVELOPMENT
    #: Plain-language reason this move was chosen. Logged, and shown in the argument map.
    because: str = ""
    #: Extra instructions for the debater, in order.
    notes: list[str] = field(default_factory=list)


def _seconds_left(time_remaining_ms: int) -> int:
    return max(0, time_remaining_ms // 1000)


def _phase_for(state: DebateState, seconds_left: int, fmt: DebateFormat) -> Phase:
    """Where the debate is. Derived, not advanced by a counter, so it can move backwards.

    A debate that goes back to establishing what a term means after twelve minutes is
    behaving correctly; a rigid script could not do that (§18).
    """
    if state.turn == 0:
        return Phase.OPENING
    if seconds_left <= CLOSING_WINDOW_S:
        return Phase.CLOSING
    if seconds_left <= FINAL_DEFENCE_WINDOW_S:
        return Phase.FINAL_DEFENCE
    if state.turn <= OPENING_ARGUMENT_TURNS:
        return Phase.POSITIONS
    if fmt is DebateFormat.SOCRATIC:
        # There are no counterclaims to develop: it is challenge and rebuttal throughout.
        return Phase.DEEP_CHALLENGE if state.turn > 6 else Phase.CHALLENGE
    if state.unanswered_challenges(Side.USER):
        # The user has put something to the opponent that it owes an answer to.
        return Phase.REBUTTAL
    if state.turn > 8:
        return Phase.DEEP_CHALLENGE
    return Phase.DEVELOPMENT


#: Objections a focused debate reaches for first. It only reorders: an objection that does
#: not apply is still never made, so a focus cannot turn the opponent into a broken record.
FOCUS_TARGETS: dict[Focus, tuple[ChallengeTarget, ...]] = {
    Focus.EVIDENCE: (ChallengeTarget.EVIDENCE, ChallengeTarget.CLAIM, ChallengeTarget.SCOPE),
    Focus.REBUTTALS: (ChallengeTarget.REASONING, ChallengeTarget.COUNTEREXAMPLE, ChallengeTarget.CLAIM),
    Focus.CRITICAL_THINKING: (
        ChallengeTarget.ASSUMPTION, ChallengeTarget.CAUSALITY, ChallengeTarget.TRADEOFF, ChallengeTarget.SCOPE
    ),
    Focus.CONCISENESS: (),
    Focus.INTERRUPTIONS: (),
    Focus.NONE: (),
}


def _best_line(
    state: DebateState, tuning: Tuning, focus: Focus = Focus.NONE
) -> tuple[Argument, ChallengeTarget] | None:
    """The strongest objection still available, or None when the ground is exhausted."""
    lines = state.open_lines_of_attack()
    preferred = FOCUS_TARGETS.get(focus, ())
    if preferred:
        # Stable sort: within the focus order the usual ranking still decides.
        lines.sort(key=lambda line: preferred.index(line[1]) if line[1] in preferred else len(preferred))
    for argument, target in lines:
        if target in tuning.excluded_targets:
            continue
        if target is ChallengeTarget.TRADEOFF and not tuning.forces_tradeoffs:
            continue
        # Naming an assumption the user never stated is the hardest thing an opponent
        # does, and the one that most often misfires: only the top level attempts it.
        if target is ChallengeTarget.ASSUMPTION and not argument.assumptions:
            if not tuning.attacks_implicit_assumptions:
                continue
        return argument, target
    return None


def _dropped_argument(state: DebateState, tuning: Tuning) -> Challenge | None:
    """An objection the user walked away from several turns ago (§14: return to it)."""
    if not tuning.revisits_dropped_arguments:
        return None
    for challenge in state.unanswered_challenges(Side.AI):
        if challenge.pressed >= PRESS_LIMIT:
            continue
        if state.turn - challenge.turn >= 4:
            return challenge
    return None


def decide(
    state: DebateState,
    *,
    difficulty: Difficulty,
    fmt: DebateFormat,
    time_remaining_ms: int,
    focus: Focus = Focus.NONE,
    #: What the analyzer thought of the user's last turn, when there was one.
    last_turn_was_strong: bool = False,
    last_evaded_challenge: Challenge | None = None,
) -> Move:
    """Pick the opponent's next move.

    The order of these rules is the debate's personality: answer what was put to you,
    finish what you started, don't only attack, and don't pretend a good point is bad.
    """
    tuning = TUNING[difficulty]
    seconds_left = _seconds_left(time_remaining_ms)
    phase = _phase_for(state, seconds_left, fmt)

    # 1. Open. State a position so there is something to argue with.
    if state.turn == 0 or phase is Phase.OPENING:
        return Move(
            action=DebateAction.OPEN, phase=Phase.OPENING,
            because="the debate has not started",
            notes=["State your own position in two or three sentences and give your single strongest reason for it."],
        )

    # 2. Close. Never start a new line of attack in the last minute and a half.
    if phase is Phase.CLOSING or state.closing_signalled:
        unanswered = state.unanswered_challenges(Side.AI)
        notes = ["Sum up in a few sentences: what you argued, and where you think their case did not hold."]
        if unanswered:
            notes.append(
                "Say plainly which of your objections went unanswered: "
                + "; ".join(f'"{c.text}"' for c in unanswered[:2])
            )
        notes.append("Then thank them for the debate and call end_interview.")
        return Move(action=DebateAction.CLOSE, phase=Phase.CLOSING, because="time is nearly up", notes=notes)

    # 3. Answer what the user put to you first. An opponent that ignores objections
    #    is not modelling anything worth practising against.
    owed = state.unanswered_challenges(Side.USER)
    if owed:
        challenge = owed[0]
        return Move(
            action=DebateAction.REBUT, phase=Phase.REBUTTAL, target=challenge.target,
            press=challenge,
            because="the user made an objection you have not answered",
            notes=[
                f'They objected: "{challenge.text}". Answer that objection directly and in its own terms before '
                "you say anything else. If it lands, say so and narrow your position rather than pretending it did "
                "not.",
            ],
        )

    # 4. Grant a genuinely good point — then keep disagreeing (§14). Spaced out, because
    #    an opponent that concedes constantly has no position left.
    if last_turn_was_strong and not state.ai_conceded_recently() and state.turn > 2:
        return Move(
            action=DebateAction.CONCEDE, phase=phase,
            because="the user's last point was strong and has not been acknowledged",
            notes=[
                "Their last point was a fair one. Say so briefly and specifically — name what they got right — then "
                "explain why it does not settle the question, and where your disagreement now sits.",
            ],
        )

    # 5. Press an objection they dodged, up to a point.
    if last_evaded_challenge is not None and last_evaded_challenge.pressed < PRESS_LIMIT:
        return Move(
            action=DebateAction.PRESS, phase=phase, target=last_evaded_challenge.target,
            press=last_evaded_challenge,
            because="the user answered a different question",
            notes=[
                f'You asked: "{last_evaded_challenge.text}" — they answered something else. Say briefly what you '
                "asked, and ask it once more, more precisely. Do not simply repeat the sentence.",
            ],
        )

    # 6. A contradiction between two of their own claims is the most telling thing
    #    available, and it is the thing only an opponent with memory can do (§17).
    if tuning.tracks_contradictions:
        contradictions = state.unraised_contradictions(Side.USER)
        if contradictions:
            contradiction = contradictions[0]
            return Move(
                action=DebateAction.CHALLENGE, phase=Phase.DEEP_CHALLENGE,
                target=ChallengeTarget.CONSISTENCY, contradiction=contradiction,
                because="the user has contradicted an earlier claim",
                notes=[
                    f'Earlier they argued: "{contradiction.earlier}". Just now they argued: "{contradiction.later}". '
                    f"Those pull against each other ({contradiction.why}). Quote both back to them and ask how they "
                    "reconcile it. Be even-handed: if there is a reading where both hold, they will say so.",
                ],
            )

    # 7. Don't only attack. Advance your own case when you have been challenging for a while,
    #    or when the user has never had a counterclaim to answer.
    socratic = fmt is DebateFormat.SOCRATIC
    must_argue = state.consecutive_challenges >= tuning.max_consecutive_challenges
    if not socratic and (must_argue or not state.side_arguments(Side.AI)):
        return Move(
            action=DebateAction.ARGUE, phase=Phase.COUNTERARGUMENT,
            because="you have been challenging without advancing your own case",
            notes=[
                "Make a positive argument for your own position now, not another question. One claim, the reason it "
                "holds, and something concrete behind it.",
                "It must be a point you have not made before: "
                + ("; ".join(f'"{p}"' for p in state.ai_points_made[-4:]) or "(none yet)"),
            ],
        )

    # 8. Return to something they abandoned.
    dropped = _dropped_argument(state, tuning)
    if dropped is not None:
        return Move(
            action=DebateAction.PRESS, phase=Phase.DEEP_CHALLENGE, target=dropped.target, press=dropped,
            because="an earlier objection was left behind",
            notes=[
                f'Several turns ago you put this and it was never answered: "{dropped.text}". Bring it back — say '
                "that you want to return to it, and put it again in the light of what they have argued since.",
            ],
        )

    # 9. Check they are with you, at the level where that matters.
    if tuning.clarifies_every and state.turn % tuning.clarifies_every == 0:
        return Move(
            action=DebateAction.CLARIFY, phase=phase,
            because="a beginner benefits from being asked what they meant",
            notes=[
                "Ask them to make their last point more precise before you argue with it — what exactly they are "
                "claiming, and what would count as it being true.",
            ],
        )

    # 10. The main line: the best objection still open.
    line = _best_line(state, tuning, focus)
    if line is not None:
        argument, target = line
        action = (
            DebateAction.COUNTEREXAMPLE if target is ChallengeTarget.COUNTEREXAMPLE else DebateAction.CHALLENGE
        )
        extra = []
        if tuning.challenges_per_turn > 1 and target is not ChallengeTarget.DEFINITION:
            extra.append(
                "You may add one short second objection if it is genuinely different from the first; never more."
            )
        return Move(
            action=action, phase=phase, target=target, against=argument,
            because="the strongest objection still open",
            notes=[
                f'Their argument: "{argument.claim}".',
                *( [f"They rest it on: {'; '.join(argument.reasons[:2])}."] if argument.reasons else [] ),
                *extra,
            ],
        )

    # 11. Nothing left on the table here: move the debate somewhere new rather than circling.
    return Move(
        action=DebateAction.TRANSITION, phase=phase,
        because="this line of argument is exhausted",
        notes=[
            "This thread is done. Say in one sentence where it leaves the two of you, then move the debate onto an "
            "aspect of the motion you have not touched.",
            "Already covered, so pick something else: " + ("; ".join(state.topics_covered[-8:]) or "(nothing yet)"),
        ],
    )


def should_signal_closing(state: DebateState, time_remaining_ms: int) -> bool:
    return _seconds_left(time_remaining_ms) <= CLOSING_WINDOW_S and not state.closing_signalled


def unsupported_summary(state: DebateState) -> list[str]:
    """The user's claims that never got support — used in the closing and in feedback."""
    return [a.claim for a in state.side_arguments(Side.USER) if a.support is Support.UNSUPPORTED][:5]
