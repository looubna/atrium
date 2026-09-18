"""The debate's state tracker, running turn by turn while the debate is live.

This is the loop §34 describes, minus the parts the platform already owns:

    the user speaks  →  transcribed by the live gateway
                     →  ARGUMENT ANALYZER          (agents/analyzer.py)
                     →  UPDATE DEBATE STATE        (state.py)
                     →  ORCHESTRATOR picks a move  (orchestrator.py)
                     →  the move becomes a note    (agents/debater.py)
                     →  the opponent speaks it     (Gemini Live)

The note is sent while the user is thinking rather than after they finish speaking, so
steering the opponent costs the conversation nothing. The gateway asks the model to stay
silent until the user speaks again and discards the reply if it does not (see
`TurnDirection.silent`).

Everything that must survive a dropped connection lives in the state dictionary the
gateway persists; this object holds nothing per-session except a cache of the prepared
brief, which is read-only.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

from app.modules.debate.agents import analyzer
from app.modules.debate.agents.debater import DebatePlan, director_note
from app.modules.debate.argument import (
    Argument,
    Challenge,
    ChallengeTarget,
    Concession,
    DebateAction,
    Side,
    parse_target,
)
from app.modules.debate.orchestrator import Move, decide, should_signal_closing
from app.modules.debate.plans import load_plan
from app.modules.debate.sources import Retriever
from app.modules.debate.state import DebateState
from app.platform.agents.live import Speaker, TurnDirection

log = logging.getLogger(__name__)

#: A turn shorter than this is a noise, a cough or "mm-hm": not an argument to analyse.
MIN_TURN_CHARS = 25
#: Briefs held in memory, keyed by session. Small, read-only, and dropped when a debate ends.
MAX_CACHED_PLANS = 32


def _questions_or_tail(text: str) -> str:
    """What the opponent actually put to the user, out of everything it said.

    An objection usually arrives as a question after a sentence or two of framing. The
    question is what must not be asked again, so that is what gets recorded — recording
    the whole turn would make every objection look unique and defeat the repeat check.
    """
    from app.platform.agents.panel import questions_in

    questions = questions_in(text)
    if questions:
        return " ".join(questions)[:600]
    sentences = [s for s in text.replace("!", ".").replace("?", ".").split(".") if s.strip()]
    return ". ".join(s.strip() for s in sentences[-2:])[:600]


@dataclass(slots=True)
class _Pending:
    """What the user said since the opponent last spoke, and the move it is answering."""

    text: str = ""
    at_ms: int = 0

    def to_doc(self) -> dict[str, Any]:
        return {"text": self.text, "atMs": self.at_ms}

    @classmethod
    def from_doc(cls, data: dict[str, Any] | None) -> _Pending:
        data = data or {}
        return cls(text=str(data.get("text", "")), at_ms=int(data.get("atMs", 0)))


def _move_to_doc(move: Move) -> dict[str, Any]:
    return {
        "action": move.action.value,
        "target": move.target.value if move.target else "",
        "against": move.against.id if move.against else "",
        "press": move.press.id if move.press else "",
        "contradiction": move.contradiction.id if move.contradiction else "",
    }


class DebateTurnObserver:
    """The debate module's `turn_observer` service."""

    def __init__(self) -> None:
        self._plans: dict[str, tuple[DebatePlan, Retriever]] = {}

    # -- the observer contract ------------------------------------------------

    async def on_turn(
        self,
        *,
        uid: str,
        session_id: str,
        session: dict[str, Any],
        speaker: Speaker,
        text: str,
        at_ms: int,
        time_remaining_ms: int,
        state: dict[str, Any] | None,
        dropped_last: bool,
    ) -> TurnDirection:
        carried = dict(state or {})
        if speaker == "candidate":
            # Held until the opponent finishes its own turn, which is when we steer it.
            pending = _Pending.from_doc(carried.get("pending"))
            joined = f"{pending.text} {text}".strip() if pending.text else text.strip()
            carried["pending"] = _Pending(text=joined[-4000:], at_ms=pending.at_ms or at_ms).to_doc()
            return TurnDirection(state=carried)

        plan, retriever = await self._plan(uid, session_id, session)
        debate = DebateState.from_doc(carried.get("debate"))

        # 1. Record what the opponent just said, as the move it was carrying out.
        self._record_ai_turn(debate, text, at_ms, carried.get("move"))

        # 2. Fold in what the user said before it, as structure.
        pending = _Pending.from_doc(carried.get("pending"))
        analysis = None
        if len(pending.text) >= MIN_TURN_CHARS:
            try:
                analysis = await analyzer.analyze_turn(
                    uid=uid,
                    motion=plan.motion,
                    speaker_position=plan.user_position.value,
                    state=debate,
                    turn_text=pending.text,
                )
            except Exception:
                # Without the analysis this turn simply leaves no structure behind; the
                # opponent still has the conversation itself, and the next turn tries again.
                log.warning("turn analysis failed", exc_info=True)
            else:
                analyzer.apply_analysis(analysis, debate, at_ms=pending.at_ms or at_ms)
                analyzer.apply_conceded_arguments(debate)
        carried.pop("pending", None)

        # 3. Decide what happens next, and 4. say it as a note.
        evaded = None
        if analysis is not None and analyzer.evaded(analysis) and analysis.answeredChallengeId:
            evaded = next((c for c in debate.challenges if c.id == analysis.answeredChallengeId), None)
        if should_signal_closing(debate, time_remaining_ms):
            debate.closing_signalled = True
        move = decide(
            debate,
            difficulty=plan.difficulty,
            fmt=plan.fmt,
            time_remaining_ms=time_remaining_ms,
            focus=plan.focus,
            last_turn_was_strong=analysis is not None and analyzer.strength_of(analysis),
            last_evaded_challenge=evaded,
        )
        debate.phase = move.phase
        note = director_note(
            move,
            debate,
            retriever=retriever,
            last_user_turn=pending.text,
            seconds_left=time_remaining_ms // 1000,
        )
        if dropped_last:
            note = note[:-1] + (
                " Nothing you said since the last note reached your opponent, so do not treat any point in it as "
                "made.]"
            )
        carried["debate"] = debate.to_doc()
        carried["move"] = _move_to_doc(move)
        log.info(
            "debate move",
            extra={
                "debateAction": move.action.value,
                "debateTarget": move.target.value if move.target else None,
                "debateWhy": move.because,
                **{f"debate_{k}": v for k, v in debate.summary().items()},
            },
        )
        # `silent`: the note is for the turn after the user speaks, not an invitation to talk.
        return TurnDirection(note=note, silent=True, state=carried)

    async def on_end(
        self, *, uid: str, session_id: str, state: dict[str, Any] | None
    ) -> dict[str, Any] | None:
        """The final argument state, for the evaluator and the argument map."""
        self._plans.pop(self._key(uid, session_id), None)
        carried = dict(state or {})
        debate = DebateState.from_doc(carried.get("debate"))
        # Anything the user said after the opponent's last turn never got analysed live.
        # It is in the transcript, so the evaluator sees it; the state simply stops there.
        return {"debate": debate.to_doc(), "summary": debate.summary()}

    # -- internals -----------------------------------------------------------

    @staticmethod
    def _key(uid: str, session_id: str) -> str:
        return f"{uid}/{session_id}"

    async def _plan(self, uid: str, session_id: str, session: dict[str, Any]) -> tuple[DebatePlan, Retriever]:
        key = self._key(uid, session_id)
        cached = self._plans.get(key)
        if cached is not None:
            return cached
        plan, retriever = await load_plan(uid, session)
        if len(self._plans) >= MAX_CACHED_PLANS:
            self._plans.clear()
        self._plans[key] = (plan, retriever)
        return plan, retriever

    @staticmethod
    def _record_ai_turn(
        debate: DebateState, text: str, at_ms: int, move_doc: dict[str, Any] | None
    ) -> None:
        """Write the opponent's turn into the state as what it actually was.

        Without this the opponent has no memory of its own objections and would ask the
        same thing again two turns later, which is the single most obvious way a debate
        partner stops being believable (§25).
        """
        debate.turn += 1
        move_doc = move_doc or {}
        action = str(move_doc.get("action", DebateAction.OPEN.value))
        said = _questions_or_tail(text)

        if action in (
            DebateAction.CHALLENGE.value, DebateAction.PRESS.value, DebateAction.COUNTEREXAMPLE.value
        ):
            press_id = str(move_doc.get("press", ""))
            if action == DebateAction.PRESS.value and press_id:
                # The same objection put again: it is not a new one.
                for challenge in debate.challenges:
                    if challenge.id == press_id:
                        challenge.pressed += 1
                        challenge.turn = debate.turn
                        break
            elif not debate.already_challenged(said):
                debate.add_challenge(
                    Challenge(
                        id=debate.next_id("c"),
                        by=Side.AI,
                        target=parse_target(move_doc.get("target")) or ChallengeTarget.CLAIM,
                        against=str(move_doc.get("against", "")),
                        text=said,
                        at_ms=at_ms,
                        turn=debate.turn,
                    )
                )
        elif action in (DebateAction.OPEN.value, DebateAction.ARGUE.value, DebateAction.REBUT.value):
            debate.add_argument(
                Argument(
                    id=debate.next_id("a"),
                    side=Side.AI,
                    claim=said,
                    at_ms=at_ms,
                    turn=debate.turn,
                )
            )
            debate.note_ai_point(said)
        elif action == DebateAction.CONCEDE.value:
            debate.add_concession(Concession(side=Side.AI, text=said, at_ms=at_ms, kept_position=True))

        contradiction_id = str(move_doc.get("contradiction", ""))
        if contradiction_id:
            for contradiction in debate.contradictions:
                if contradiction.id == contradiction_id:
                    contradiction.raised = True
                    break
        debate.note_ai_action(action)
