"""Presentation sessions (`/api/v1/presentation/...`).

A session is one talk, with the user's own slides, in a small room, to a large audience or on a
video call. The audience is played live on `/sessions/{id}/live`: silent while the user presents,
then asking questions.
"""

from __future__ import annotations

import asyncio
import base64
import binascii
import logging
from typing import Annotated, Any

from fastapi import APIRouter, Depends, status
from google.api_core.exceptions import AlreadyExists
from pydantic import BaseModel, ConfigDict, Field

from app.core.errors import NotFound, ServiceUnavailable, ValidationFailed
from app.core.settings import get_settings
from app.modules.exam.materials import UnsupportedMaterial, detect_kind, extract_text
from app.modules.interview import livetalking
from app.modules.interview.api import GRACE_MS, EmailNotVerified
from app.modules.interview.sanitize import clean_phrase, clean_text
from app.modules.presentation import MODULE_ID
from app.modules.presentation.audience import Format, Questions, briefing, format_of, plan_of
from app.modules.presentation.world import DECK_CHARS, write_audience
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

router = APIRouter(prefix="/presentation", tags=["presentation"])

#: The slides, as the PDF the page already renders them from. Their text is kept with the session.
MAX_MATERIAL_BYTES = 20 * 1024 * 1024


class Material(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Annotated[str, Field(max_length=200)]
    #: The file itself, base64. PDF or PowerPoint; anything else (images) is ignored.
    data: Annotated[str, Field(max_length=MAX_MATERIAL_BYTES * 4 // 3 + 8)]


class CreateSession(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: Annotated[str, Field(description="Client-generated UUIDv4; retrying with the same id is safe.")]
    format: Format
    #: Questions on the talk and the slides (the audience listens), or on the slides alone.
    questions: Questions = Questions.TALK
    title: Annotated[str, Field(max_length=200)] = ""
    #: Who the talk is for, in the user's words.
    audience: Annotated[str, Field(max_length=300)] = ""
    durationMinutes: Annotated[int, Field(ge=3, le=60)] = 15
    slides: Material | None = None


class SessionCreated(BaseModel):
    id: str
    status: str
    maxDurationMs: int
    liveUrl: str
    #: The audience, the chair first: key, name, role.
    people: list[dict[str, str]]
    #: The user's pre-read: the audience, what it expects, tips, how questions work.
    briefing: dict[str, Any]


#: The sales cast's faces (`infra/livetalking/recordings/sales/`): the three at the boardroom table in a
#: small room, the 2x2 call grid online. The academic classroom's three askers are students in its own
#: footage (`recordings/academic/install_room.sh`), streamed as just the strip holding them
#: (`make_strip.sh`; the page lays it over the room). The company auditorium's askers are three people in
#: its front row (`recordings/theater/install_room.sh`), streamed the same way.
FACES: dict[Format, str] = {
    Format.SMALL_ROOM: "sp_investors",
    Format.VIRTUAL: "sl_investors",
    Format.ACADEMIC: "academic_strip",
    # At twice the size (`make_strip2x.sh`): the front-row faces are small, and the mouth keeps its detail.
    Format.LARGE_AUDIENCE: "theater_strip2x",
}
#: Where each person sits in the online stream, as (x, y) of their 640x360 tile.
CALL_TILES = {"robert": (0, 0), "priya": (640, 0), "kevin": (0, 360)}


def _people(context: dict[str, Any]) -> list[dict[str, str]]:
    return [{"key": p.key, "name": p.name, "role": p.role} for p in plan_of(context).people()]


def _created(session_id: str, data: dict[str, Any]) -> SessionCreated:
    context = data.get("context") or {}
    return SessionCreated(
        id=session_id,
        status=str(data.get("status", "")),
        maxDurationMs=int(data.get("maxDurationMs", 0)),
        liveUrl=f"/api/v1/sessions/{session_id}/live",
        people=_people(context),
        briefing=briefing(context),
    )


def read_material(material: Material) -> str:
    """The slides' text, or "" when they are not a readable document."""
    try:
        data = base64.b64decode(material.data, validate=True)
    except (binascii.Error, ValueError):
        raise ValidationFailed("the slides could not be read") from None
    if len(data) > MAX_MATERIAL_BYTES:
        raise ValidationFailed("the slides are larger than 20 MB")
    try:
        return extract_text(detect_kind(material.name, data), data)
    except UnsupportedMaterial as exc:
        log.info("presentation slides not readable", extra={"data": {"reason": str(exc)}})
        return ""


@router.post("/sessions", status_code=status.HTTP_201_CREATED, response_model=SessionCreated)
async def create_session(
    body: CreateSession,
    user: Annotated[AuthUser, Depends(rate_limit("presentation_sessions", limit=30, window_seconds=3600))],
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

    deck = await asyncio.to_thread(read_material, body.slides) if body.slides is not None else ""
    deck = deck[:DECK_CHARS]
    title, audience = clean_phrase(body.title, 200), clean_text(body.audience, 300)

    _, limits = await plan_limits(user)
    minutes = min(body.durationMinutes, limits.max_round_minutes)
    context: dict[str, Any] = {
        "format": body.format.value,
        "questions": body.questions.value,
        "title": title,
        "audience": audience,
        # Spelled as the platform reads it: the feedback judges eye contact against a room or a webcam.
        "mode": "online" if body.format is Format.VIRTUAL else "in_person",
        "durationMinutes": minutes,
        "deckText": deck,
    }
    context["plan"] = (await write_audience(user.uid, body.format.value, title, audience, deck)).to_doc()

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
    """The audience's live faces. A 503 means no faces: voices only."""
    session_id = require_id(session_id)
    await require_consents(user, ConsentKind.AI_PROCESSING)
    snap = await clients.firestore().document(UserPaths(user.uid).session(session_id)).get()
    if not snap.exists:
        raise NotFound()
    context = (snap.to_dict() or {}).get("context") or {}
    people = _people(context)

    face = FACES.get(format_of(context))
    if face is None:
        raise ServiceUnavailable("no faces for this room")
    url = await face_server().ready_url()  # "" while it is still starting
    secret = get_settings().livetalking_secret.get_secret_value()
    if not url or not secret:
        raise ServiceUnavailable("no face server")
    lead = people[0]
    reply: dict[str, Any] = {
        **livetalking.session(url, secret, face), "name": lead["name"], "role": lead["role"], "avatar": face,
        "panel": [],
        # One face paints whoever the page names, in this order (the chair first).
        "speakers": [p["name"] for p in people],
    }
    if format_of(context) is Format.VIRTUAL:
        reply["tiles"] = {p["name"]: CALL_TILES[p["key"]] for p in people}
    return reply
