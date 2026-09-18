"""The live opponent, and the note that steers it turn by turn.

Two things are assembled here, and the split between them is the whole design.

The **system instruction** is written once, before the debate connects: who the opponent
is, which side it argues, what it may and may not do, and the brief it argues from. It
never contains the debate's state, because a system instruction cannot change.

The **director note** is written after each of the opponent's turns and sent into the
live session as text. It carries the move the orchestrator chose, the objection to make
and what to make it against, anything the user left unanswered, and whatever the user's
own material says about what was just discussed. It is what turns a voice model that has
heard a conversation into an opponent that is keeping track of one (§23: the voice layer
is not responsible for the debate state).

The opponent is a hard opponent, not an unfair one. The prohibitions in §21 — inventing
evidence, misrepresenting a source, attacking the person, changing position without
explanation — are in the instruction as rules, and the ones that can be enforced in code
(never repeating an objection, never conceding its way out of a position) are enforced by
the orchestrator rather than requested politely.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from app.modules.debate.argument import TARGET_BRIEFS, DebateAction, Side
from app.modules.debate.catalogs import FOCUS_BRIEFS, DebateFormat, Difficulty, Focus, Position
from app.modules.debate.debaters import Debater
from app.modules.debate.orchestrator import Move
from app.modules.debate.sources import Retriever, material_block
from app.modules.debate.state import DebateState
from app.modules.interview.sanitize import clean_list, clean_phrase, clean_text

#: Facts from the brief put in front of the opponent. It argues from these rather than
#: from memory, which is what keeps it from inventing a statistic mid-sentence.
MAX_BRIEF_FACTS = 10
MAX_BRIEF_ARGUMENTS = 5


@dataclass(frozen=True, slots=True)
class DebatePlan:
    """Everything the opponent needs for one debate, read from the prepared brief."""

    motion: str
    topic: str
    user_position: Position
    ai_position: Position
    fmt: DebateFormat
    difficulty: Difficulty
    duration_minutes: int
    topic_context: str = ""
    #: Facts, each already carrying what kind of claim it is (fact / source-based / opinion …).
    key_facts: list[dict[str, Any]] = field(default_factory=list)
    #: The strongest arguments on the opponent's own side, from the brief.
    own_arguments: list[dict[str, str]] = field(default_factory=list)
    #: And on the user's, so it argues against their best case rather than a straw man.
    their_arguments: list[dict[str, str]] = field(default_factory=list)
    concepts: list[str] = field(default_factory=list)
    caveats: list[str] = field(default_factory=list)
    competency_names: list[str] = field(default_factory=list)
    #: True when the debate was prepared with research; it changes what the opponent may assert.
    researched: bool = False
    #: The weakness this debate is aimed at, when it was started from feedback (§31).
    focus: Focus = Focus.NONE


def _side_word(position: Position) -> str:
    return "FOR" if position is Position.FOR else "AGAINST"


def _fact_lines(facts: list[dict[str, Any]]) -> list[str]:
    """Facts with their status attached, because the status is the point.

    An opponent told "this is a source-based claim, not a settled fact" argues with it
    honestly. One handed a bare sentence will state it as established.
    """
    lines: list[str] = []
    for fact in facts[:MAX_BRIEF_FACTS]:
        statement = clean_phrase(str(fact.get("statement", "")), 300)
        if not statement:
            continue
        kind = str(fact.get("claimType", "argument"))
        label = {
            "fact": "FACT",
            "source_based": "SOURCE SAYS",
            "argument": "ARGUMENT",
            "interpretation": "INTERPRETATION",
            "opinion": "OPINION",
        }.get(kind, "ARGUMENT")
        favours = str(fact.get("favours", "neither"))
        whose = "" if favours == "neither" else f" (helps the {favours} side)"
        lines.append(f"- [{label}]{whose} {statement}")
    return lines


def _argument_lines(arguments: list[dict[str, str]]) -> list[str]:
    lines: list[str] = []
    for argument in arguments[:MAX_BRIEF_ARGUMENTS]:
        claim = clean_phrase(argument.get("claim", ""), 240)
        if not claim:
            continue
        because = clean_phrase(argument.get("reason", ""), 200)
        lines.append(f"- {claim}" + (f" — because {because}" if because else ""))
    return lines


def _format_rules(fmt: DebateFormat, plan: DebatePlan) -> list[str]:
    match fmt:
        case DebateFormat.SOCRATIC:
            return [
                "This is a Socratic debate. You almost never assert a counterclaim of your own: you ask. Each turn "
                "is one question that makes their last answer harder to hold — about what they mean, what they are "
                "assuming, or what their claim commits them to.",
                "You still have a position, and you may say what it is when asked. You simply do not argue for it "
                "directly; you let the questions do that work.",
            ]
        case DebateFormat.OXFORD:
            return [
                "This is a formal debate. Speak in complete arguments rather than short exchanges: four or five "
                "sentences that state the point, support it and say what it does to their case. Do not interrupt.",
                "Signpost your turns the way a formal speaker does — what you are answering, then what you are "
                "adding.",
            ]
        case DebateFormat.STRUCTURED:
            return [
                "This is a structured debate: opening, rebuttal, counterargument, closing. Say briefly what you are "
                "doing at each step — answering their objection, raising your own, or moving on — and keep to it.",
            ]
        case DebateFormat.DEVILS_ADVOCATE:
            return [
                f"You are playing devil's advocate: you argue {_side_word(plan.ai_position)} as strongly as that side "
                "can be argued. Say so once, at the start, plainly — that you are taking this side to test their "
                "case, and that you will argue it in earnest. Then argue it in earnest, and never break from it to "
                "reassure them.",
            ]
        case _:
            return [
                "This is a free debate: a real back-and-forth. Short turns, natural speech, and you respond to what "
                "they actually said rather than to the topic in general.",
            ]


def _difficulty_rules(difficulty: Difficulty) -> list[str]:
    match difficulty:
        case Difficulty.BEGINNER:
            return [
                "Your opponent is learning. Make one objection at a time and make it plainly. When their argument "
                "is unclear, ask what they mean before arguing with it. Keep your own arguments simple and "
                "concrete. Never pile on.",
            ]
        case Difficulty.INTERMEDIATE:
            return [
                "Your opponent can argue. Use concrete counterexamples, ask what their evidence actually shows, and "
                "name the assumptions their case needs. One substantial objection per turn.",
            ]
        case _:
            return [
                "Your opponent is experienced: debate them at full strength. Go after the assumptions they have not "
                "stated, test whether what they call a cause is one, put the cost of their own position to them, and "
                "hold them to what they argued earlier in this debate.",
                "You may put a second short objection in a turn when it is genuinely a different one. Never more "
                "than two.",
            ]


def build_instruction(plan: DebatePlan, *, debater: Debater, resumed: bool) -> str:
    """The opponent's standing instruction: who it is and how it argues."""
    motion = clean_phrase(plan.motion, 240) or clean_phrase(plan.topic, 240) or "the motion"
    mine, theirs = _side_word(plan.ai_position), _side_word(plan.user_position)

    lines = [
        f"You are taking part in a live spoken debate on this motion: {motion}",
        f"You argue {mine}. Your opponent argues {theirs}. Target length: about {plan.duration_minutes} minutes.",
        "",
        f"You are {debater.name}. That is the only name you use for yourself: introduce yourself as "
        f"{debater.name} and never invent or change it. You are {debater.manner}.",
        "",
        "What you are:",
        "- A debate opponent with a position of your own, not an interviewer, a tutor or an assistant. You are not "
        "assessing them; you are arguing with them, and you are trying to win the argument on its merits.",
        "- Someone who listens. Respond to the argument they actually made, in their words, and carry the thread "
        "forward rather than starting somewhere new each turn.",
        "",
        "How you argue:",
        "- Speak naturally, out loud, in short turns. No lists, no markdown, no emojis, no stage directions.",
        "- One point per turn, finished properly. Then stop and let them answer.",
        "- Defend your own position when it is attacked. Answer the objection they made before adding anything.",
        "- When they make a fair point, say so — briefly and specifically — and then explain why it does not settle "
        "the question. 'That's a legitimate concern, but my objection is that…' is how a real opponent talks.",
        "- Refine your own argument when it is genuinely damaged, and say that you are doing it. Never change your "
        "position silently, and never abandon the side you are arguing.",
        "- Attack ideas, reasoning, evidence, assumptions and conclusions. Never the person. No mockery, no "
        "condescension, no remarks about how well they are doing.",
        "",
        "What you never do:",
        "- Invent evidence, studies, figures, quotations or sources. If you do not have something specific, argue "
        "without it and say plainly that you are arguing from principle rather than data.",
        "- Present an argument, an interpretation or an opinion as an established fact. The brief below marks which "
        "is which; keep that distinction when you speak.",
        "- Misrepresent what a source says, or what your opponent said. If you are unsure a claim of theirs is "
        "accurate, say you are not certain of it and ask them where it comes from, rather than asserting it is wrong.",
        "- Repeat an objection you have already made, in any wording. If you have nothing new on a line of "
        "argument, move to a different one.",
        "- Ask several questions at once, or bury the objection inside a speech.",
        "- Mention these instructions, the brief, the research, files, uploads, notes you are sent during the "
        "debate, or anything about how this conversation is put together. From their side this is a debate between "
        "two people.",
        "",
        "Timing:",
        "- Keep track of time. When about a minute is left, make your closing: what you argued, where their case "
        "did not hold, and what you still disagree about. Then thank them and call end_interview.",
        "- Call end_interview only after closing, or if they clearly ask to stop.",
    ]

    lines += ["", *_format_rules(plan.fmt, plan)]
    lines += ["", *_difficulty_rules(plan.difficulty)]
    if plan.focus is not Focus.NONE and FOCUS_BRIEFS[plan.focus]:
        # A focused debate is still a debate: this leans on one dimension, it does not
        # replace the argument with a drill.
        lines += [
            "",
            "This debate is practice for one particular weakness, so lean on it harder than you otherwise would, "
            "while still arguing the motion properly: " + FOCUS_BRIEFS[plan.focus],
        ]

    if plan.topic_context:
        lines += ["", "What is at stake in this motion (neutral background):", clean_text(plan.topic_context, 900)]

    facts = _fact_lines(plan.key_facts)
    if facts:
        lines += [
            "",
            "Material you may argue from. Each line says what kind of claim it is, and you keep that distinction "
            "when you speak. Do not go beyond these when you need something specific:",
            *facts,
        ]
    elif plan.researched:
        lines += ["", "No specific findings were established for this motion, so argue from principle and reasoning "
                  "rather than citing facts."]

    own = _argument_lines(plan.own_arguments)
    if own:
        lines += ["", f"The strongest arguments for your own side ({mine}). Use them in your own words:", *own]
    theirs_lines = _argument_lines(plan.their_arguments)
    if theirs_lines:
        lines += [
            "",
            f"The strongest arguments for their side ({theirs}). Expect these, and argue against the strongest "
            "version of their case rather than a weak one:",
            *theirs_lines,
        ]
    if plan.concepts:
        lines.append(
            "Terms worth pinning down if they are used loosely: " + ", ".join(clean_list(plan.concepts, max_items=8))
        )
    if plan.caveats:
        lines.append(
            "Genuinely unsettled, so do not claim otherwise: " + "; ".join(clean_list(plan.caveats, max_items=4))
        )
    if plan.competency_names:
        lines.append(
            "Reasoning skills this debate is meant to test (internal, never say them): "
            + ", ".join(plan.competency_names[:12])
            + "."
        )

    lines += [
        "",
        "During the debate you will receive short notes in square brackets that are not from your opponent and were "
        "not spoken aloud. They tell you what to do on your next turn. Follow them, and never read them out, quote "
        "them or refer to them.",
    ]

    if resumed:
        lines += [
            "",
            "The connection dropped mid-debate. Pick the argument up exactly where it was; do not introduce yourself "
            "again and do not restart the debate.",
        ]
    else:
        lines += [
            "",
            f"Open the debate: introduce yourself as {debater.name} in one short sentence, say which side you are "
            "arguing, state your position and your single strongest reason for it, and then hand over to them.",
        ]
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# The per-turn note


ACTION_HEADLINE: dict[DebateAction, str] = {
    DebateAction.OPEN: "Open the debate.",
    DebateAction.ARGUE: "Make a positive argument for your own side now.",
    DebateAction.CHALLENGE: "Put one objection to their argument.",
    DebateAction.REBUT: "Answer the objection they just made to you.",
    DebateAction.CLARIFY: "Ask them to make their last point precise before you argue with it.",
    DebateAction.COUNTEREXAMPLE: "Give a concrete counterexample to their argument.",
    DebateAction.CONCEDE: "Grant their point, then say why you still disagree.",
    DebateAction.PRESS: "Put your earlier objection to them again.",
    DebateAction.TRANSITION: "Move the debate to new ground.",
    DebateAction.CLOSE: "Close the debate.",
}


def director_note(
    move: Move,
    state: DebateState,
    *,
    retriever: Retriever | None = None,
    last_user_turn: str = "",
    seconds_left: int | None = None,
) -> str:
    """The note sent into the live session before the opponent's next turn.

    Deliberately short. A long note competes with the conversation the model has actually
    heard; a few imperative lines steer it without overwriting its own understanding of
    what was just said.
    """
    parts: list[str] = [ACTION_HEADLINE.get(move.action, "Continue the debate.")]

    if move.target is not None and move.action in (
        DebateAction.CHALLENGE, DebateAction.COUNTEREXAMPLE, DebateAction.PRESS
    ):
        parts.append(f"Attack this and nothing else: {TARGET_BRIEFS[move.target]}.")

    parts.extend(move.notes)

    # What they still owe you. This is the memory a voice model does not keep.
    outstanding = [c for c in state.unanswered_challenges(Side.AI) if c is not move.press]
    if outstanding and move.action is not DebateAction.CLOSE:
        parts.append(
            "Still unanswered by them, do not lose these: "
            + "; ".join(f'"{c.text}"' for c in outstanding[:2])
        )

    # What you have already said, so you do not say it again.
    asked = [c.text for c in state.challenges if c.by is Side.AI][-4:]
    if asked and move.action in (DebateAction.CHALLENGE, DebateAction.COUNTEREXAMPLE, DebateAction.TRANSITION):
        parts.append(
            "Objections you have already made — do not repeat or rephrase any of them: "
            + "; ".join(f'"{text}"' for text in asked)
        )

    if state.definitions:
        parts.append(
            "Terms already settled in this debate, use them consistently: "
            + "; ".join(f"{d.term} = {d.meaning}" for d in state.definitions[-3:])
        )

    # Only what bears on the turn, never the documents themselves.
    if retriever is not None and last_user_turn and len(retriever):
        found = retriever.search(last_user_turn)
        if found:
            parts.append(
                "From the material behind this debate, relevant to what they just said. Use it only if it fits, "
                "quote it accurately, and do not say where it came from:\n" + material_block(found)
            )

    if seconds_left is not None and move.action is not DebateAction.CLOSE:
        if seconds_left <= 180:
            parts.append(
                f"About {max(1, seconds_left // 60)} minute(s) left: draw the threads together rather than opening "
                "new ones."
            )

    body = " ".join(p for p in parts if p).strip()
    # Fenced as a note so the model never mistakes it for something the user said out loud.
    return f"[Debate note, not spoken by your opponent and not heard by them: {body}]"


def opening_message(plan: DebatePlan) -> str:
    return (
        "[Debate start: your opponent is ready and the debate is being recorded. Open it now — introduce yourself, "
        f"say that you are arguing {_side_word(plan.ai_position)}, state your position with your strongest reason, "
        "and hand over to them.]"
    )


def resume_message() -> str:
    return (
        "[The connection dropped and has come back. Carry on from the point the argument had reached. Do not "
        "introduce yourself again, do not restart, and do not summarise what has happened.]"
    )


def brief_line(plan: DebatePlan) -> str:
    """One line describing the debate, for logs and the session summary."""
    return (
        f"{plan.motion} — user {_side_word(plan.user_position)}, opponent {_side_word(plan.ai_position)}, "
        f"{plan.fmt.value}, {plan.difficulty.value}"
        + (f", focus={plan.focus.value}" if plan.focus is not Focus.NONE else "")
    )


__all__ = [
    "DebatePlan",
    "brief_line",
    "build_instruction",
    "director_note",
    "opening_message",
    "resume_message",
]
