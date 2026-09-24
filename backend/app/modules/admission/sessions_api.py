"""The interview itself (`/api/v1/admission/sessions`).

A session is one mock interview for one preparation. It is created only once the preparation
is ready, because the professor questions the candidate *from* it: without the predicted
questions and the read application, this would be a generic interview wearing the
scholarship's name.
"""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, status
from google.api_core.exceptions import AlreadyExists
from pydantic import BaseModel, ConfigDict, Field

from app.core.errors import Conflict, NotFound, ServiceUnavailable
from app.core.settings import get_settings
from app.modules.admission import MODULE_ID
from app.modules.admission.agents.interviewer import DEFAULT_MINUTES, MAX_CLAIMS, PROFESSOR, application_claims
from app.modules.admission.catalogs import parse_kind
from app.modules.admission.preparations import Status
from app.modules.interview import livetalking
from app.modules.interview.api import GRACE_MS, EmailNotVerified
from app.modules.interview.sanitize import clean_phrase
from app.platform.auth.dependencies import AuthUser
from app.platform.clients import clients
from app.platform.faces import face_server
from app.platform.firestore.paths import UserPaths, client_uuid, require_id
from app.platform.ratelimit import rate_limit
from app.platform.runtime_config import ai_enabled
from app.platform.sessions import new_session_document
from app.platform.usage import Metric, Period, UsageService
from app.platform.users import ConsentKind, plan_limits, require_consents

router = APIRouter(prefix="/admission", tags=["admission"])


class CreateSession(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: Annotated[str, Field(description="Client-generated UUIDv4; retrying with the same id is safe.")]
    prepId: str
    durationMinutes: Annotated[int, Field(ge=5, le=60)] = DEFAULT_MINUTES


class SessionCreated(BaseModel):
    id: str
    status: str
    maxDurationMs: int
    liveUrl: str
    professor: str


def _created(session_id: str, data: dict[str, Any]) -> SessionCreated:
    return SessionCreated(
        id=session_id,
        status=str(data.get("status", "")),
        maxDurationMs=int(data.get("maxDurationMs", 0)),
        liveUrl=f"/api/v1/sessions/{session_id}/live",
        professor=PROFESSOR.name,
    )


async def _context(uid: str, prep_id: str) -> dict[str, Any]:
    """What the session carries: which preparation it runs on, and enough to write the report."""
    snap = await clients.firestore().document(UserPaths(uid).admission_preparation(require_id(prep_id))).get()
    if not snap.exists:
        raise NotFound()
    prep = snap.to_dict() or {}
    if str(prep.get("status")) != str(Status.READY) or not prep.get("plan"):
        raise Conflict("your preparation isn't ready yet")
    return {
        "prepId": prep_id,
        "opportunity": clean_phrase(str(prep.get("name", "")), 160),
        "program": clean_phrase(str(prep.get("program", "")), 160),
        "kind": parse_kind(str(prep.get("kind", ""))).value,
        # The application as the committee read it, for checking answers against it afterwards.
        "application": [
            f"{c.section}: {c.text}" + (f' ("{c.quote}")' if c.quote else "")
            for c in application_claims(prep.get("candidateProfile") or {})
        ][:MAX_CLAIMS],
    }


@router.post("/sessions", status_code=status.HTTP_201_CREATED, response_model=SessionCreated)
async def create_session(
    body: CreateSession,
    user: Annotated[AuthUser, Depends(rate_limit("admission_sessions", limit=30, window_seconds=3600))],
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

    context = await _context(user.uid, body.prepId)
    _, limits = await plan_limits(user)
    minutes = min(body.durationMinutes, limits.max_round_minutes)
    context["durationMinutes"] = minutes

    await UsageService(db).reserve(user.uid, Metric.SESSIONS, 1, limit=limits.sessions_day, period=Period.DAY)
    doc = new_session_document(module=MODULE_ID, context=context, max_duration_ms=minutes * 60_000 + GRACE_MS)
    try:
        await ref.create(doc)
    except AlreadyExists:
        # A concurrent retry created it first; the quota unit was already counted for that request.
        await UsageService(db).record(user.uid, {Metric.SESSIONS: -1}, period=Period.DAY)
        doc = (await ref.get()).to_dict() or doc
    return _created(session_id, doc)


@router.post("/sessions/{session_id}/avatar-session")
async def avatar_session(
    session_id: str,
    user: Annotated[AuthUser, Depends(rate_limit("avatar_session", limit=30, window_seconds=3600))],
) -> dict[str, Any]:
    """The professor's face. A 503 simply means no face: the interview runs on voice alone."""
    session_id = require_id(session_id)
    await require_consents(user, ConsentKind.AI_PROCESSING)

    snap = await clients.firestore().document(UserPaths(user.uid).session(session_id)).get()
    if not snap.exists:
        raise NotFound()

    settings = get_settings()
    url = await face_server().ready_url()  # "" while it is still starting
    secret = settings.livetalking_secret.get_secret_value()
    if not url or not secret:
        raise ServiceUnavailable("no face server is configured")
    override = settings.livetalking_avatar.strip()
    return {
        **livetalking.session(
            url, secret, livetalking.face_for(PROFESSOR.avatar_id, settings.livetalking_faces, override)
        ),
        "name": PROFESSOR.name,
        "role": PROFESSOR.role,
        "panel": [],
    }
