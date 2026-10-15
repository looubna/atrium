"""Park conversations (`/api/v1/emotional/...`).

Before they start, the page shows the situation's brief (`GET /emotional/briefs/{scenario}`): the
example, the goal and three techniques, and lets the user describe their own situation instead. A
session is then one conversation on the bench, created when they start: the live socket plays the
friend. The page's orientation at that moment picks which cut of the footage the face is painted on.
"""

from __future__ import annotations

import logging
from typing import Annotated, Any

from fastapi import APIRouter, Depends, status
from google.api_core.exceptions import AlreadyExists
from pydantic import BaseModel, ConfigDict, Field

from app.core.errors import NotFound, ServiceUnavailable
from app.core.settings import get_settings
from app.modules.emotional import MODULE_ID
from app.modules.emotional.partners import PARTNERS, SCENARIOS, Scenario, partner_for, scenario_for
from app.modules.interview import livetalking
from app.modules.interview.api import GRACE_MS, EmailNotVerified
from app.platform.auth.dependencies import AuthUser, current_user
from app.platform.clients import clients
from app.platform.faces import face_server
from app.platform.firestore.paths import UserPaths, client_uuid, require_id
from app.platform.ratelimit import rate_limit
from app.platform.runtime_config import ai_enabled
from app.platform.sessions import new_session_document
from app.platform.usage import Metric, Period, UsageService
from app.platform.users import ConsentKind, plan_limits, require_consents

router = APIRouter(prefix="/emotional", tags=["emotional"])
log = logging.getLogger(__name__)

#: The longest conversation the setup offers (its picker goes to 60): the time the user chose is the
#: time they get. The plan's own round limit still applies.
MAX_MINUTES = 60


class CreateSession(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: Annotated[str, Field(description="Client-generated UUIDv4; retrying with the same id is safe.")]
    partner: Annotated[str, Field(max_length=20)]
    scenario: Annotated[str, Field(max_length=40)]
    minutes: Annotated[int, Field(ge=1, le=60)] = 10
    #: The page was wider than tall when the user sat down.
    landscape: bool = True
    #: The user's own situation of this kind, in their words, to practise instead of the example.
    ownSituation: Annotated[str, Field(max_length=1500)] = ""


class Brief(BaseModel):
    """What the user is there to do, and three techniques for it: shown before the friend speaks."""

    #: The example situation, from the user's side.
    example: str
    #: The goal in the example, and in a situation of their own.
    goal: str
    ownGoal: str
    tips: list[str]


def _brief(scenario: Scenario) -> Brief:
    return Brief(example=scenario.example, goal=scenario.goal, ownGoal=scenario.own_goal, tips=list(scenario.tips))


class SessionCreated(BaseModel):
    id: str
    status: str
    maxDurationMs: int
    liveUrl: str
    brief: Brief | None = None


def _created(session_id: str, data: dict[str, Any]) -> SessionCreated:
    scenario = scenario_for((data.get("context") or {}).get("scenario"))
    return SessionCreated(
        id=session_id,
        status=str(data.get("status", "")),
        maxDurationMs=int(data.get("maxDurationMs", 0)),
        liveUrl=f"/api/v1/sessions/{session_id}/live",
        brief=_brief(scenario) if scenario else None,
    )


@router.get("/briefs/{scenario_id}", response_model=Brief)
async def brief(scenario_id: str, user: current_user) -> Brief:
    """The situation's brief, read before the conversation starts (it costs nothing and creates nothing)."""
    scenario = scenario_for(scenario_id)
    if scenario is None:
        raise NotFound()
    return _brief(scenario)


@router.post("/sessions", status_code=status.HTTP_201_CREATED, response_model=SessionCreated)
async def create_session(
    body: CreateSession,
    user: Annotated[AuthUser, Depends(rate_limit("emotional_sessions", limit=30, window_seconds=3600))],
) -> SessionCreated:
    session_id = client_uuid(body.id)
    if body.partner not in PARTNERS or body.scenario not in SCENARIOS:
        raise NotFound()
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

    _, limits = await plan_limits(user)
    minutes = min(body.minutes, MAX_MINUTES, limits.max_round_minutes)
    context = {
        "partner": body.partner,
        "scenario": body.scenario,
        "landscape": body.landscape,
        "ownSituation": body.ownSituation.strip(),
        "durationMinutes": minutes,
    }

    await UsageService(db).reserve(user.uid, Metric.SESSIONS, 1, limit=limits.sessions_day, period=Period.DAY)
    doc = new_session_document(module=MODULE_ID, context=context, max_duration_ms=minutes * 60_000 + GRACE_MS)
    try:
        await ref.create(doc)
    except AlreadyExists:
        await UsageService(db).record(user.uid, {Metric.SESSIONS: -1}, period=Period.DAY)
        doc = (await ref.get()).to_dict() or doc
    return _created(session_id, doc)


@router.post("/sessions/{session_id}/avatar-session")
async def avatar_session(
    session_id: str,
    user: Annotated[AuthUser, Depends(rate_limit("avatar_session", limit=30, window_seconds=3600))],
) -> dict[str, Any]:
    """The friend's lip-synced face. A 503 simply means no face: the footage stays and the voice plays."""
    session_id = require_id(session_id)
    await require_consents(user, ConsentKind.AI_PROCESSING)

    snap = await clients.firestore().document(UserPaths(user.uid).session(session_id)).get()
    if not snap.exists:
        raise NotFound()
    context = (snap.to_dict() or {}).get("context") or {}
    partner = partner_for(context.get("partner"))
    if partner is None:
        raise NotFound()

    settings = get_settings()
    url = await face_server().ready_url()  # "" while it is still starting
    secret = settings.livetalking_secret.get_secret_value()
    if not url or not secret:
        raise ServiceUnavailable("no face server")
    face = partner.face(bool(context.get("landscape", True)))
    return {**livetalking.session(url, secret, face), "name": partner.name, "role": "", "avatar": face, "panel": []}


class FaceDiagnostics(BaseModel):
    """What the page saw of the friend's face over the last few seconds (see ParkTalk's LiveFriend)."""

    model_config = ConfigDict(extra="forbid")

    #: Seconds since the face joined.
    atS: Annotated[float, Field(ge=0, le=7200)]
    #: The face video: frames decoded and dropped so far, whether frames are arriving now, and how far
    #: its clock has moved in the window (a frozen picture stops it).
    decoded: Annotated[int, Field(ge=0)]
    dropped: Annotated[int, Field(ge=0)]
    stalled: bool
    playedS: Annotated[float, Field(ge=-1, le=3600)]
    #: The video track as the browser sees it.
    trackState: Annotated[str, Field(max_length=16)]
    trackMuted: bool
    #: The page itself: its longest main-thread block in the window, and the voice playing now.
    longestTaskMs: Annotated[int, Field(ge=0, le=600_000)]
    speaking: bool
    #: Recoveries so far (the face reconnected after a frozen picture).
    recoveries: Annotated[int, Field(ge=0, le=100)]


@router.post("/sessions/{session_id}/diagnostics", status_code=status.HTTP_204_NO_CONTENT)
async def face_diagnostics(
    session_id: str,
    body: FaceDiagnostics,
    user: Annotated[AuthUser, Depends(rate_limit("emotional_diagnostics", limit=900, window_seconds=3600))],
) -> None:
    """Logged only: how the face looked in the user's browser, to find why a picture freezes."""
    log.info("park face", extra={"data": {"sessionId": require_id(session_id), **body.model_dump()}})
