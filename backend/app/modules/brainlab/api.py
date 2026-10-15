"""Brain Lab consultations (`/api/v1/brainlab/...`).

A session is one consultation: created when the user starts talking, played live on the socket.
Her face joins when she has been filmed (`expert.FACE_ID`); until then the consultation is voice only.
The Brain Plan is written after the report and read here, for the session or as the latest one.
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, status
from google.api_core.exceptions import AlreadyExists
from pydantic import BaseModel, ConfigDict, Field

from app.core.errors import NotFound, ServiceUnavailable
from app.core.settings import get_settings
from app.modules.brainlab import MODULE_ID
from app.modules.brainlab.expert import FACE_ID, FOCUSES, NAME
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

router = APIRouter(prefix="/brainlab", tags=["brainlab"])

#: The longest conversation the setup offers (its picker goes to 60): the time the user chose is the
#: time they get. The plan's own round limit still applies.
MAX_MINUTES = 60


class CreateSession(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: Annotated[str, Field(description="Client-generated UUIDv4; retrying with the same id is safe.")]
    focus: Annotated[str, Field(max_length=40)]
    #: What the user wants to change, in their words (the "own" focus; optional for the others).
    own: Annotated[str, Field(max_length=1500)] = ""
    minutes: Annotated[int, Field(ge=1, le=60)] = 15
    landscape: bool = True


class SessionCreated(BaseModel):
    id: str
    status: str
    maxDurationMs: int
    liveUrl: str


@router.post("/sessions", status_code=status.HTTP_201_CREATED, response_model=SessionCreated)
async def create_session(
    body: CreateSession,
    user: Annotated[AuthUser, Depends(rate_limit("brainlab_sessions", limit=30, window_seconds=3600))],
) -> SessionCreated:
    session_id = client_uuid(body.id)
    if body.focus not in FOCUSES:
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
        context = {"focus": body.focus, "own": body.own.strip(), "landscape": body.landscape,
                   "durationMinutes": minutes}
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
    """Her lip-synced face. A 503 means no face (not filmed yet, or the server is off): the voice plays."""
    session_id = require_id(session_id)
    await require_consents(user, ConsentKind.AI_PROCESSING)
    snap = await clients.firestore().document(UserPaths(user.uid).session(session_id)).get()
    if not snap.exists:
        raise NotFound()
    if not FACE_ID:
        raise ServiceUnavailable("no face yet")
    settings = get_settings()
    url = await face_server().ready_url()
    secret = settings.livetalking_secret.get_secret_value()
    if not url or not secret:
        raise ServiceUnavailable("no face server")
    landscape = bool(((snap.to_dict() or {}).get("context") or {}).get("landscape", True))
    face = f"{FACE_ID}_{'land' if landscape else 'port'}"
    return {**livetalking.session(url, secret, face), "name": NAME, "role": "Neuroscientist", "avatar": face,
            "panel": []}


def _plan_view(plan: dict[str, Any] | None) -> dict[str, Any] | None:
    if not plan:
        return None
    created = plan.get("createdAt")
    return {**plan, "createdAt": created.isoformat() if isinstance(created, datetime) else created}


@router.get("/sessions/{session_id}/plan")
async def session_plan(session_id: str, user: current_user) -> dict[str, Any]:
    """The consultation's Brain Plan once written, and where the report is (the page polls this)."""
    snap = await clients.firestore().document(UserPaths(user.uid).session(require_id(session_id))).get()
    if not snap.exists:
        raise NotFound()
    data = snap.to_dict() or {}
    return {"processingStatus": data.get("processingStatus"), "plan": _plan_view(data.get("brainPlan"))}


@router.get("/plan")
async def latest_plan(user: current_user) -> dict[str, Any]:
    """The user's latest Brain Plan, for the Lab's start screen."""
    snap = await clients.firestore().document(f"{UserPaths(user.uid).user()}/brainlab/plan").get()
    return {"plan": _plan_view(snap.to_dict() if snap.exists else None)}
