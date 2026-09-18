"""Turning a session into the plan the opponent argues from.

Read by both the live agent factory (once, at connect) and the turn observer (once,
cached). A debate that was prepared reads its brief; a debate the user started straight
from a topic reads nothing and still works — the opponent argues from reasoning rather
than from facts, and says so.
"""

from __future__ import annotations

from typing import Any

from app.modules.debate.agents.debater import DebatePlan
from app.modules.debate.catalogs import (
    Position,
    competencies_for_format,
    parse_difficulty,
    parse_focus,
    parse_format,
    parse_position,
)
from app.modules.debate.sources import NoMaterial, Retriever, build_retriever
from app.platform.clients import clients
from app.platform.firestore.paths import UserPaths, is_valid_id

DEFAULT_MINUTES = 15


async def load_plan(uid: str, session: dict[str, Any]) -> tuple[DebatePlan, Retriever]:
    """The plan and the material retriever for one debate session."""
    context = session.get("context") or {}
    fmt = parse_format(context.get("format"))
    user_position = parse_position(context.get("userPosition")) or Position.FOR
    ai_position = parse_position(context.get("aiPosition")) or user_position.opposite

    prep: dict[str, Any] = {}
    debate_id, prep_id = str(context.get("debateId", "")), str(context.get("prepId", ""))
    if debate_id and prep_id and is_valid_id(debate_id) and is_valid_id(prep_id):
        snap = await clients.firestore().document(UserPaths(uid).debate_prep(debate_id, prep_id)).get()
        if snap.exists:
            prep = snap.to_dict() or {}

    # Which side's arguments are the opponent's own, and which are the ones it argues against.
    for_side = [a for a in prep.get("argumentsFor", []) if isinstance(a, dict)]
    against_side = [a for a in prep.get("argumentsAgainst", []) if isinstance(a, dict)]
    own, theirs = (
        (for_side, against_side) if ai_position is Position.FOR else (against_side, for_side)
    )

    plan = DebatePlan(
        motion=str(prep.get("motion") or context.get("motion") or context.get("topic") or ""),
        topic=str(context.get("topic", "")),
        user_position=user_position,
        ai_position=ai_position,
        fmt=fmt,
        difficulty=parse_difficulty(context.get("difficulty")),
        duration_minutes=int(context.get("durationMinutes", DEFAULT_MINUTES)),
        topic_context=str(prep.get("topicContext", "")),
        key_facts=[f for f in prep.get("keyFacts", []) if isinstance(f, dict)],
        own_arguments=own,
        their_arguments=theirs,
        concepts=[str(c) for c in prep.get("concepts", [])],
        caveats=[str(c) for c in prep.get("caveats", [])],
        competency_names=[c.name for c in competencies_for_format(fmt)],
        researched=bool(context.get("researchEnabled")),
        focus=parse_focus(context.get("focus")),
    )

    claims = [c for c in prep.get("materialClaims", []) if isinstance(c, dict)]
    if not claims:
        return plan, NoMaterial()
    names = {str(k): str(v) for k, v in (prep.get("materialNames") or {}).items()}
    return plan, build_retriever(claims, names)
