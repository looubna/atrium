"""Café & Restaurant conversations (`/api/v1/cafe/...`).

Before they start, the page lists the area's situations with their briefs (`GET /cafe/scenarios`):
the example, the goal and the techniques with their studies; the user can describe their own
situation instead. A session is one conversation, created when they start and played live on the
socket. No face yet: the avatar session answers 503 until the café is filmed, and the voice plays.
"""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, status
from google.api_core.exceptions import AlreadyExists
from pydantic import BaseModel, ConfigDict, Field

from app.core.errors import NotFound, ServiceUnavailable
from app.core.settings import get_settings
from app.modules.cafe import MODULE_ID
from app.modules.cafe.evidence import SOURCES, TECHNIQUES
from app.modules.cafe.people import AREAS, SCENARIOS, Scenario, partner_for
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

router = APIRouter(prefix="/cafe", tags=["cafe"])

#: The longest conversation the setup offers (its picker goes to 60): the time the user chose is the
#: time they get. The plan's own round limit still applies.
MAX_MINUTES = 60


class Study(BaseModel):
    cite: str
    title: str
    url: str


class Tip(BaseModel):
    name: str
    how: str
    evidence: str
    studies: list[Study]


class ScenarioView(BaseModel):
    id: str
    label: str
    #: Who the user talks with (one person per situation).
    name: str
    example: str
    goal: str
    tips: list[Tip]


def _view(s: Scenario) -> ScenarioView:
    tips = [
        Tip(name=t.name, how=t.how, evidence=t.evidence,
            studies=[Study(cite=SOURCES[k].short, title=SOURCES[k].title, url=SOURCES[k].url) for k in t.sources])
        for t in (TECHNIQUES[k] for k in s.techniques)
    ]
    person = partner_for(s.id)
    return ScenarioView(id=s.id, label=s.label, name=person.name if person else "", example=s.example, goal=s.goal,
                        tips=tips)


@router.get("/scenarios", response_model=list[ScenarioView])
async def scenarios(area: str, user: current_user) -> list[ScenarioView]:
    """The area's situations and their briefs (read before starting; creates nothing)."""
    if area not in AREAS:
        raise NotFound()
    return [_view(s) for s in SCENARIOS.values() if s.area == area]


class CreateSession(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: Annotated[str, Field(description="Client-generated UUIDv4; retrying with the same id is safe.")]
    scenario: Annotated[str, Field(max_length=40)]
    #: Ignored: each situation has its own person (kept so older pages still start).
    partner: Annotated[str, Field(max_length=20)] = ""
    #: The user's own situation of this kind, in their words, to practise instead of the example.
    own: Annotated[str, Field(max_length=1500)] = ""
    minutes: Annotated[int, Field(ge=1, le=60)] = 5
    landscape: bool = True


class SessionCreated(BaseModel):
    id: str
    status: str
    maxDurationMs: int
    liveUrl: str


@router.post("/sessions", status_code=status.HTTP_201_CREATED, response_model=SessionCreated)
async def create_session(
    body: CreateSession,
    user: Annotated[AuthUser, Depends(rate_limit("cafe_sessions", limit=30, window_seconds=3600))],
) -> SessionCreated:
    session_id = client_uuid(body.id)
    if body.scenario not in SCENARIOS:
        raise NotFound()
    if not user.verified_for_ai:
        raise EmailNotVerified()
    await require_consents(user, ConsentKind.AI_PROCESSING, ConsentKind.RECORDING)
    if not await ai_enabled():
        raise ServiceUnavailable()

    db = clients.firestore()
    ref = db.document(UserPaths(user.uid).session(session_id))
    existing = await ref.get()
    if not existing.exists:
        _, limits = await plan_limits(user)
        minutes = min(body.minutes, MAX_MINUTES, limits.max_round_minutes)
        context = {"scenario": body.scenario, "area": SCENARIOS[body.scenario].area, "partner": body.scenario,
                   "own": body.own.strip(), "landscape": body.landscape, "durationMinutes": minutes}
        await UsageService(db).reserve(user.uid, Metric.SESSIONS, 1, limit=limits.sessions_day, period=Period.DAY)
        doc = new_session_document(module=MODULE_ID, context=context, max_duration_ms=minutes * 60_000 + GRACE_MS)
        try:
            await ref.create(doc)
        except AlreadyExists:
            await UsageService(db).record(user.uid, {Metric.SESSIONS: -1}, period=Period.DAY)
            doc = (await ref.get()).to_dict() or doc
    else:
        doc = existing.to_dict() or {}
    return SessionCreated(id=session_id, status=str(doc.get("status", "")),
                          maxDurationMs=int(doc.get("maxDurationMs", 0)),
                          liveUrl=f"/api/v1/sessions/{session_id}/live")


@router.post("/sessions/{session_id}/avatar-session")
async def avatar_session(
    session_id: str,
    user: Annotated[AuthUser, Depends(rate_limit("avatar_session", limit=30, window_seconds=3600))],
) -> dict[str, Any]:
    """Their lip-synced face. A 503 means no face (not filmed yet, or the server is off): the voice plays."""
    session_id = require_id(session_id)
    await require_consents(user, ConsentKind.AI_PROCESSING)
    snap = await clients.firestore().document(UserPaths(user.uid).session(session_id)).get()
    if not snap.exists:
        raise NotFound()
    context = (snap.to_dict() or {}).get("context") or {}
    partner = partner_for(context.get("scenario"))
    if partner is None:
        raise NotFound()
    if not partner.face_id:
        raise ServiceUnavailable("no face yet")
    settings = get_settings()
    url = await face_server().ready_url()
    secret = settings.livetalking_secret.get_secret_value()
    if not url or not secret:
        raise ServiceUnavailable("no face server")
    face = f"{partner.face_id}_{'land' if context.get('landscape', True) else 'port'}"
    return {**livetalking.session(url, secret, face), "name": partner.name, "role": "", "avatar": face, "panel": []}
