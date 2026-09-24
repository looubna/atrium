"""Meeting sessions (`/api/v1/meeting/...`).

A session is one work meeting on the user's own topic, in the role they choose, with one person or
a group, online (a video call) or in person (around a table). The others are played live on
`/sessions/{id}/live`.
"""

from __future__ import annotations

import asyncio
import base64
import binascii
import logging
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, status
from google.api_core.exceptions import AlreadyExists
from pydantic import BaseModel, ConfigDict, Field

from app.core.errors import NotFound, ServiceUnavailable, ValidationFailed
from app.core.settings import get_settings
from app.modules.exam.materials import UnsupportedMaterial, detect_kind, extract_text
from app.modules.interview import livetalking
from app.modules.interview.api import GRACE_MS, EmailNotVerified
from app.modules.interview.sanitize import clean_phrase, clean_text
from app.modules.meeting import MODULE_ID
from app.modules.meeting.plan import Role, briefing, in_person, is_group, plan_of
from app.modules.meeting.world import write_plan
from app.platform.auth.dependencies import AuthUser
from app.platform.clients import clients
from app.platform.faces import face_server
from app.platform.firestore.paths import UserPaths, client_uuid, require_id
from app.platform.ratelimit import rate_limit
from app.platform.runtime_config import ai_enabled
from app.platform.sessions import new_session_document
from app.platform.usage import Metric, Period, UsageService
from app.platform.users import ConsentKind, plan_limits, require_consents

log = logging.getLogger(__name__)

router = APIRouter(prefix="/meeting", tags=["meeting"])

#: The material the user brings: a brief, a deck or a report. Read once, never stored.
MAX_MATERIAL_BYTES = 8 * 1024 * 1024


class Material(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Annotated[str, Field(max_length=200)]
    #: The file itself, base64. PDF, Word, PowerPoint, text or Markdown; anything else is ignored.
    data: Annotated[str, Field(max_length=MAX_MATERIAL_BYTES * 4 // 3 + 8)]


class CreateSession(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: Annotated[str, Field(description="Client-generated UUIDv4; retrying with the same id is safe.")]
    role: Role
    topic: Annotated[str, Field(min_length=1, max_length=1000)]
    group: bool = True
    mode: Literal["online", "in-person"] = "online"
    durationMinutes: Annotated[int, Field(ge=5, le=60)] = 20
    material: Material | None = None


class SessionCreated(BaseModel):
    id: str
    status: str
    maxDurationMs: int
    liveUrl: str
    #: Who else is in the meeting, the one who speaks most first: key, name, role.
    people: list[dict[str, str]]
    #: The user's pre-read: their role, the background and agenda, their aims, who is there.
    briefing: dict[str, Any]
    #: Whether the material could be read (false for a scan or an unsupported file).
    materialRead: bool = False


#: The sales cast's faces (`infra/livetalking/recordings/sales/`): Claire on her own, and Robert,
#: Priya and Kevin as a group — online a 2x2 grid in one stream, in person the boardroom.
FACES: dict[tuple[bool, bool], str] = {
    # (group, in person) -> face
    (False, False): "sl_buyer",
    (True, False): "sl_investors",
    (False, True): "sp_buyer",
    (True, True): "sp_investors",
}
#: Where each person sits in the online group stream, as (x, y) of their 640x360 tile.
CALL_TILES = {"robert": (0, 0), "priya": (640, 0), "kevin": (0, 360)}


def _people(context: dict[str, Any]) -> list[dict[str, str]]:
    return [{"key": p.key, "name": p.name, "role": p.role} for p in plan_of(context).people(is_group(context))]


def _created(session_id: str, data: dict[str, Any]) -> SessionCreated:
    context = data.get("context") or {}
    return SessionCreated(
        id=session_id,
        status=str(data.get("status", "")),
        maxDurationMs=int(data.get("maxDurationMs", 0)),
        liveUrl=f"/api/v1/sessions/{session_id}/live",
        people=_people(context),
        briefing=briefing(context),
        materialRead=bool(context.get("materialRead")),
    )


def read_material(material: Material) -> str:
    """The material's text, or "" when it is not a readable document."""
    try:
        data = base64.b64decode(material.data, validate=True)
    except (binascii.Error, ValueError):
        raise ValidationFailed("the material could not be read") from None
    if len(data) > MAX_MATERIAL_BYTES:
        raise ValidationFailed("the material is larger than 8 MB")
    try:
        return extract_text(detect_kind(material.name, data), data)
    except UnsupportedMaterial as exc:
        log.info("meeting material not readable", extra={"data": {"reason": str(exc)}})
        return ""


@router.post("/sessions", status_code=status.HTTP_201_CREATED, response_model=SessionCreated)
async def create_session(
    body: CreateSession,
    user: Annotated[AuthUser, Depends(rate_limit("meeting_sessions", limit=30, window_seconds=3600))],
) -> SessionCreated:
    session_id = client_uuid(body.id)
    topic = clean_text(body.topic, 1000)
    if not topic:
        raise ValidationFailed("say what the meeting is about")
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

    material_name, material = "", ""
    if body.material is not None:
        material_name = clean_phrase(body.material.name, 200)
        material = await asyncio.to_thread(read_material, body.material)

    _, limits = await plan_limits(user)
    minutes = min(body.durationMinutes, limits.max_round_minutes)
    context: dict[str, Any] = {
        "role": body.role.value,
        "topic": topic,
        "group": body.group,
        # Spelled as the platform reads it: the feedback judges eye contact against a room or a webcam.
        "mode": "in_person" if body.mode == "in-person" else "online",
        "durationMinutes": minutes,
        "materialName": material_name,
        "materialRead": bool(material),
    }
    context["plan"] = (await write_plan(user.uid, body.role, body.group, topic, material_name, material)).to_doc()

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
    """The others' live faces. A 503 means no faces: the meeting runs on voices and name tiles."""
    session_id = require_id(session_id)
    await require_consents(user, ConsentKind.AI_PROCESSING)
    snap = await clients.firestore().document(UserPaths(user.uid).session(session_id)).get()
    if not snap.exists:
        raise NotFound()
    context = (snap.to_dict() or {}).get("context") or {}
    people = _people(context)

    url = await face_server().ready_url()  # "" while it is still starting
    secret = get_settings().livetalking_secret.get_secret_value()
    if not url or not secret:
        raise ServiceUnavailable("no face server")
    group = is_group(context)
    face = FACES[(group, in_person(context))]
    lead = people[0]
    reply: dict[str, Any] = {
        **livetalking.session(url, secret, face), "name": lead["name"], "role": lead["role"], "avatar": face,
        "panel": [],
    }
    if group:
        # One face paints whoever the page names, in this order (the lead first).
        reply["speakers"] = [p["name"] for p in people]
        if not in_person(context):
            reply["tiles"] = {p["name"]: CALL_TILES[p["key"]] for p in people}
    return reply
