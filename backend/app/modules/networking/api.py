"""Networking conversations (`/api/v1/networking/...`).

A session is one conversation with one guest at the reception: the user taps a name
tag, the page creates a session for that guest, and the live socket plays them.
"""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, status
from google.api_core.exceptions import AlreadyExists
from pydantic import BaseModel, ConfigDict, Field

from app.core.errors import NotFound, ServiceUnavailable
from app.core.settings import get_settings
from app.modules.interview import livetalking
from app.modules.interview.api import GRACE_MS, EmailNotVerified
from app.modules.networking import MODULE_ID
from app.modules.networking.guests import GUESTS, guest_for
from app.platform.auth.dependencies import AuthUser
from app.platform.clients import clients
from app.platform.faces import face_server
from app.platform.firestore.paths import UserPaths, client_uuid, require_id
from app.platform.ratelimit import rate_limit
from app.platform.runtime_config import ai_enabled
from app.platform.sessions import new_session_document
from app.platform.usage import Metric, Period, UsageService
from app.platform.users import ConsentKind, plan_limits, require_consents

router = APIRouter(prefix="/networking", tags=["networking"])

#: A conversation at a reception runs a few minutes; this is the ceiling, not the aim.
MAX_MINUTES = 10


class CreateSession(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: Annotated[str, Field(description="Client-generated UUIDv4; retrying with the same id is safe.")]
    guestId: Annotated[str, Field(max_length=40)]
    #: Whether the user could read the guest's name tag.
    roleVisible: bool = True


class SessionCreated(BaseModel):
    id: str
    status: str
    maxDurationMs: int
    liveUrl: str


def _created(session_id: str, data: dict[str, Any]) -> SessionCreated:
    return SessionCreated(
        id=session_id,
        status=str(data.get("status", "")),
        maxDurationMs=int(data.get("maxDurationMs", 0)),
        liveUrl=f"/api/v1/sessions/{session_id}/live",
    )


@router.post("/sessions", status_code=status.HTTP_201_CREATED, response_model=SessionCreated)
async def create_session(
    body: CreateSession,
    user: Annotated[AuthUser, Depends(rate_limit("networking_sessions", limit=40, window_seconds=3600))],
) -> SessionCreated:
    session_id = client_uuid(body.id)
    if body.guestId not in GUESTS:
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
    minutes = min(MAX_MINUTES, limits.max_round_minutes)
    context = {"guestId": body.guestId, "roleVisible": body.roleVisible, "durationMinutes": minutes}

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
    """The guest's lip-synced face. A 503 simply means no face: the footage stays and the voice plays."""
    session_id = require_id(session_id)
    await require_consents(user, ConsentKind.AI_PROCESSING)

    snap = await clients.firestore().document(UserPaths(user.uid).session(session_id)).get()
    if not snap.exists:
        raise NotFound()
    guest = guest_for(((snap.to_dict() or {}).get("context") or {}).get("guestId"))
    if guest is None:
        raise NotFound()

    settings = get_settings()
    url = await face_server().ready_url()  # "" while it is still starting
    secret = settings.livetalking_secret.get_secret_value()
    # Only guests who have been filmed facing the user have a face; nobody borrows another's.
    face = livetalking.mapped_face(guest.avatar_id, settings.livetalking_faces)
    if not url or not secret or not face:
        raise ServiceUnavailable("no face for this guest")
    return {
        **livetalking.session(url, secret, face),
        "name": guest.name,
        "role": guest.role,
        "avatar": face,
        "panel": [],
    }
