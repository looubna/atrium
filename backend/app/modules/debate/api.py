"""Debate sessions (`/api/v1/debate/...`).

A session is one debate. Its context is settled here, on the server: the motion, both
positions, the format, the difficulty and the length. Two ways in:

  * From a prepared debate — the brief decides the motion and the positions.
  * From a topic alone — no preparation, no research, straight into the argument. §32 is
    explicit that the user must be able to enter a real debate immediately, so this path
    is a first-class one rather than a degraded mode.

Starting again afterwards is §31: the same motion, the other side of it, a harder opponent,
or a debate aimed at one weakness.
"""

from __future__ import annotations

from enum import StrEnum
from typing import Annotated, Any

from fastapi import APIRouter, Depends, status
from google.api_core.exceptions import AlreadyExists
from pydantic import BaseModel, ConfigDict, Field

from app.core.errors import BadRequest, Conflict, NotFound, ServiceUnavailable
from app.core.settings import get_settings
from app.modules.debate import MODULE_ID
from app.modules.debate.catalogs import (
    DebateFormat,
    Difficulty,
    Focus,
    Position,
    PositionMode,
    assign_positions,
    parse_difficulty,
    parse_focus,
    parse_format,
    parse_position,
)
from app.modules.debate.debaters import debater_for
from app.modules.debate.retry import harder
from app.modules.debate.topics import needs_research, normalise_motion
from app.modules.interview import livetalking
from app.modules.interview.api import GRACE_MS, EmailNotVerified
from app.platform.auth.dependencies import AuthUser
from app.platform.clients import clients
from app.platform.firestore.paths import UserPaths, client_uuid, require_id
from app.platform.ratelimit import rate_limit
from app.platform.runtime_config import ai_enabled
from app.platform.sessions import new_session_document
from app.platform.usage import Metric, Period, UsageService
from app.platform.users import ConsentKind, plan_limits, require_consents

router = APIRouter(prefix="/debate", tags=["debate"])

#: Long enough for a real argument to develop, short enough to hold attention.
DEFAULT_MINUTES = 15


class CreateSession(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: Annotated[str, Field(description="Client-generated UUIDv4; retrying with the same id is safe.")]
    #: A prepared debate. Without one, everything below settles the debate instead.
    debateId: str | None = None
    prepId: str | None = None
    #: Straight-in path: the motion the user typed, and optional settings.
    topic: Annotated[str, Field(max_length=300)] = ""
    format: DebateFormat | None = None
    difficulty: Difficulty | None = None
    positionMode: PositionMode | None = None
    position: Position | None = None
    durationMinutes: Annotated[int, Field(ge=5, le=60)] | None = None
    focus: Focus = Focus.NONE
    camera: bool = False


class SessionCreated(BaseModel):
    id: str
    status: str
    maxDurationMs: int
    liveUrl: str
    motion: str
    userPosition: str
    aiPosition: str
    format: str
    difficulty: str
    opponentName: str


def _created(session_id: str, data: dict[str, Any]) -> SessionCreated:
    context = data.get("context") or {}
    fmt = parse_format(context.get("format"))
    return SessionCreated(
        id=session_id,
        status=str(data.get("status", "")),
        maxDurationMs=int(data.get("maxDurationMs", 0)),
        liveUrl=f"/api/v1/sessions/{session_id}/live",
        motion=str(context.get("motion") or context.get("topic", "")),
        userPosition=str(context.get("userPosition", Position.FOR.value)),
        aiPosition=str(context.get("aiPosition", Position.AGAINST.value)),
        format=fmt.value,
        difficulty=str(context.get("difficulty", Difficulty.INTERMEDIATE.value)),
        opponentName=debater_for(fmt).name,
    )


async def _prepared_context(uid: str, body: CreateSession) -> dict[str, Any]:
    """The context of a debate that was prepared: the brief settled the motion and the sides."""
    db, paths = clients.firestore(), UserPaths(uid)
    debate_id = require_id(str(body.debateId))
    debate_snap = await db.document(paths.debate(debate_id)).get()
    if not debate_snap.exists:
        raise NotFound()
    debate = debate_snap.to_dict() or {}
    prep_id = body.prepId or debate.get("activePrepId")
    if not prep_id:
        raise Conflict("this debate hasn't been prepared yet")
    prep_snap = await db.document(paths.debate_prep(debate_id, require_id(str(prep_id)))).get()
    if not prep_snap.exists:
        raise NotFound()
    prep = prep_snap.to_dict() or {}
    if prep.get("status") != "ready":
        raise Conflict("this debate is still being prepared")

    user_position = parse_position(prep.get("userPosition")) or Position.FOR
    return {
        "debateId": debate_id,
        "prepId": str(prep_id),
        "topic": str(debate.get("topic", "")),
        "motion": str(prep.get("motion") or debate.get("topic", "")),
        "userPosition": user_position.value,
        "aiPosition": user_position.opposite.value,
        "positionMode": str(prep.get("positionMode") or debate.get("positionMode") or PositionMode.USER.value),
        "format": parse_format(body.format.value if body.format else debate.get("format")).value,
        "difficulty": parse_difficulty(
            body.difficulty.value if body.difficulty else debate.get("difficulty")
        ).value,
        "researchEnabled": bool(prep.get("researchEnabled")),
        "hasMaterial": bool(prep.get("materialClaims")),
        "focus": body.focus.value,
    }


def _immediate_context(body: CreateSession) -> dict[str, Any]:
    """The context of a debate started from a topic alone, with nothing looked up first."""
    topic = normalise_motion(body.topic)
    if not topic:
        raise BadRequest("give a topic to debate, or prepare a debate first")
    mode = body.positionMode or PositionMode.USER
    user_position, ai_position = assign_positions(mode, body.position or Position.FOR)
    fmt = body.format or DebateFormat.FREE
    return {
        "topic": topic,
        "motion": topic,
        "userPosition": user_position.value,
        "aiPosition": ai_position.value,
        "positionMode": mode.value,
        "format": fmt.value,
        "difficulty": (body.difficulty or Difficulty.INTERMEDIATE).value,
        # Nothing was looked up, and the opponent is told to argue from principle instead of
        # citing facts it cannot have. Preparing the debate is what turns this on.
        "researchEnabled": False,
        "researchSkipped": needs_research(topic),
        "hasMaterial": False,
        "focus": body.focus.value,
    }


@router.post("/sessions", status_code=status.HTTP_201_CREATED, response_model=SessionCreated)
async def create_session(
    body: CreateSession,
    user: Annotated[AuthUser, Depends(rate_limit("debate_sessions", limit=30, window_seconds=3600))],
) -> SessionCreated:
    session_id = client_uuid(body.id)
    if not user.verified_for_ai:
        raise EmailNotVerified()
    await require_consents(user, ConsentKind.AI_PROCESSING, ConsentKind.RECORDING)
    if not await ai_enabled():
        raise ServiceUnavailable()

    db = clients.firestore()
    ref = db.document(UserPaths(user.uid).session(session_id))
    existing = await ref.get()
    if existing.exists:
        return _created(session_id, existing.to_dict() or {})

    context = (
        await _prepared_context(user.uid, body) if body.debateId else _immediate_context(body)
    )
    _, limits = await plan_limits(user)
    asked = body.durationMinutes or DEFAULT_MINUTES
    minutes = min(asked, limits.max_round_minutes)
    context["durationMinutes"] = minutes
    context["camera"] = body.camera
    max_duration_ms = minutes * 60_000 + GRACE_MS

    await UsageService(db).reserve(user.uid, Metric.SESSIONS, 1, limit=limits.sessions_day, period=Period.DAY)
    doc = new_session_document(module=MODULE_ID, context=context, max_duration_ms=max_duration_ms)
    try:
        await ref.create(doc)
    except AlreadyExists:
        # A concurrent retry created it first; the quota unit was already counted for that request.
        await UsageService(db).record(user.uid, {Metric.SESSIONS: -1}, period=Period.DAY)
        doc = (await ref.get()).to_dict() or doc
    return _created(session_id, doc)


class AgainMode(StrEnum):
    """The four ways to debate again after feedback (§31)."""

    #: The same motion, the same side, a new attempt aimed at what went weakest.
    AGAIN = "again"
    #: The same motion from the other side. The best test of whether the case was understood.
    SWITCH = "switch"
    #: One step harder.
    HARDER = "harder"
    #: The same motion, with the opponent leaning on one weakness.
    FOCUS = "focus"


class AgainSession(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: Annotated[str, Field(description="Client-generated UUIDv4 for the new debate.")]
    mode: AgainMode = AgainMode.AGAIN
    #: Which weakness, for `focus`. Ignored otherwise.
    focus: Focus = Focus.NONE


@router.post("/sessions/{session_id}/again", status_code=status.HTTP_201_CREATED, response_model=SessionCreated)
async def debate_again(
    session_id: str,
    body: AgainSession,
    user: Annotated[AuthUser, Depends(rate_limit("debate_sessions", limit=30, window_seconds=3600))],
) -> SessionCreated:
    new_session_id = client_uuid(body.id)
    db, paths = clients.firestore(), UserPaths(user.uid)
    source_snap = await db.document(paths.session(session_id)).get()
    if not source_snap.exists:
        raise NotFound()
    source = source_snap.to_dict() or {}
    if source.get("module") != MODULE_ID:
        raise NotFound()
    if not user.verified_for_ai:
        raise EmailNotVerified()
    await require_consents(user, ConsentKind.AI_PROCESSING, ConsentKind.RECORDING)
    if not await ai_enabled():
        raise ServiceUnavailable()

    ref = db.document(paths.session(new_session_id))
    existing = await ref.get()
    if existing.exists:
        return _created(new_session_id, existing.to_dict() or {})

    context = dict(source.get("context") or {})
    next_practice = source.get("nextPractice") or {}
    match body.mode:
        case AgainMode.SWITCH:
            # The brief already holds both sides, so switching needs no new preparation.
            user_position = parse_position(context.get("userPosition")) or Position.FOR
            context["userPosition"] = user_position.opposite.value
            context["aiPosition"] = user_position.value
            context["positionMode"] = PositionMode.ASSIGNED.value
            context["focus"] = Focus.NONE.value
        case AgainMode.HARDER:
            context["difficulty"] = harder(str(context.get("difficulty", ""))).value
            context["focus"] = Focus.NONE.value
        case AgainMode.FOCUS:
            chosen = body.focus if body.focus is not Focus.NONE else parse_focus(next_practice.get("suggestedFocus"))
            if chosen is Focus.NONE:
                raise BadRequest("say which weakness to practise")
            context["focus"] = chosen.value
        case _:
            context["focus"] = Focus.NONE.value

    _, limits = await plan_limits(user)
    await UsageService(db).reserve(user.uid, Metric.SESSIONS, 1, limit=limits.sessions_day, period=Period.DAY)
    doc = new_session_document(
        module=MODULE_ID,
        context=context,
        max_duration_ms=int(source.get("maxDurationMs", DEFAULT_MINUTES * 60_000)),
        attempt_no=int(source.get("attemptNo", 1)) + 1,
        retry_of=session_id,
        # Switching sides or changing the opponent makes the previous attempt's targets the
        # wrong ones to aim at; debating the same thing again keeps them.
        retry_targets=(source.get("retryPlan") or {}) if body.mode is AgainMode.AGAIN else {},
    )
    try:
        await ref.create(doc)
    except AlreadyExists:
        await UsageService(db).record(user.uid, {Metric.SESSIONS: -1}, period=Period.DAY)
        doc = (await ref.get()).to_dict() or doc
    return _created(new_session_id, doc)


@router.post("/sessions/{session_id}/avatar-session")
async def avatar_session(
    session_id: str,
    user: Annotated[AuthUser, Depends(rate_limit("avatar_session", limit=30, window_seconds=3600))],
) -> dict[str, Any]:
    """A face for the opponent. A 503 simply means no face: the debate runs on voice alone."""
    session_id = require_id(session_id)
    await require_consents(user, ConsentKind.AI_PROCESSING)

    snap = await clients.firestore().document(UserPaths(user.uid).session(session_id)).get()
    if not snap.exists:
        raise NotFound()
    context = (snap.to_dict() or {}).get("context") or {}
    person = debater_for(parse_format(context.get("format")))

    settings = get_settings()
    url = settings.livetalking_url.strip()
    secret = settings.livetalking_secret.get_secret_value()
    if not url or not secret:
        raise ServiceUnavailable("no face server is configured")
    override = settings.livetalking_avatar.strip()
    return {
        **livetalking.session(url, secret, override or person.avatar_id),
        "name": person.name,
        "role": person.role,
        "panel": [],
    }
