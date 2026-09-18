"""Interview module HTTP API (`/api/v1/interview/...`)."""

from __future__ import annotations

from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, status
from google.api_core.exceptions import AlreadyExists
from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.core.errors import Conflict, Forbidden, NotFound, ServiceUnavailable
from app.modules.interview import MODULE_ID
from app.modules.interview.agents.live_interviewer import GENERAL_BEHAVIORAL
from app.modules.interview.catalogs import RoundType
from app.platform.auth.dependencies import AuthUser
from app.platform.clients import clients
from app.platform.firestore.paths import UserPaths, client_uuid, require_id
from app.platform.ratelimit import rate_limit
from app.platform.runtime_config import ai_enabled
from app.platform.sessions import new_session_document
from app.platform.usage import Metric, Period, UsageService
from app.platform.users import ConsentKind, plan_limits, require_consents

router = APIRouter(prefix="/interview", tags=["interview"])

GRACE_MS = 3 * 60_000


class EmailNotVerified(Forbidden):
    code = "email_not_verified"
    title = "Verify your email address to use AI practice"


class CreateSession(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: Annotated[str, Field(description="Client-generated UUIDv4; retrying with the same id is safe.")]
    practice: Literal["general_behavioral"] | None = None
    applicationId: str | None = None
    blueprintId: str | None = None
    roundId: str | None = None
    mode: Literal["online", "in_person"] = "online"
    panel: Literal["one_to_one", "panel"] = "one_to_one"
    durationMinutes: Annotated[int, Field(ge=5, le=60)] = 30

    @model_validator(mode="after")
    def _one_source(self) -> CreateSession:
        blueprint = (self.applicationId, self.blueprintId, self.roundId)
        if self.practice is None and not all(blueprint):
            raise ValueError("choose a practice type or a blueprint round")
        if self.practice is not None and any(blueprint):
            raise ValueError("practice sessions don't reference a blueprint")
        return self


class SessionCreated(BaseModel):
    id: str
    status: str
    maxDurationMs: int
    liveUrl: str


async def _round_context(uid: str, body: CreateSession) -> dict[str, Any]:
    if body.practice == GENERAL_BEHAVIORAL:
        return {"practice": GENERAL_BEHAVIORAL, "roundType": RoundType.BEHAVIORAL.value}
    assert body.applicationId and body.blueprintId and body.roundId
    db = clients.firestore()
    paths = UserPaths(uid)
    # Every referenced ID is resolved under the caller's own documents.
    bp_snap = await db.document(paths.blueprint(body.applicationId, body.blueprintId)).get()
    if not bp_snap.exists:
        raise NotFound()
    blueprint = bp_snap.to_dict() or {}
    if blueprint.get("status") != "ready":
        raise Conflict("the interview journey is not ready yet")
    round_id = require_id(body.roundId)
    round_doc = next((r for r in blueprint.get("rounds", []) if r.get("id") == round_id), None)
    if round_doc is None:
        raise NotFound()
    return {
        "applicationId": body.applicationId,
        "blueprintId": body.blueprintId,
        "roundId": round_id,
        "roundType": RoundType(round_doc.get("type", RoundType.OTHER.value)).value,
        "roundTitle": str(round_doc.get("title", ""))[:120],
    }


@router.post("/sessions", status_code=status.HTTP_201_CREATED, response_model=SessionCreated)
async def create_session(
    body: CreateSession,
    user: Annotated[AuthUser, Depends(rate_limit("interview_sessions", limit=30, window_seconds=3600))],
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
        data = existing.to_dict() or {}
        return SessionCreated(id=session_id, status=data.get("status", ""), maxDurationMs=data.get("maxDurationMs", 0),
                              liveUrl=f"/api/v1/sessions/{session_id}/live")

    context = await _round_context(user.uid, body)
    context.update({"mode": body.mode, "panel": body.panel, "durationMinutes": body.durationMinutes})
    _, limits = await plan_limits(user)
    minutes = min(body.durationMinutes, limits.max_round_minutes)
    max_duration_ms = minutes * 60_000 + GRACE_MS

    await UsageService(db).reserve(user.uid, Metric.SESSIONS, 1, limit=limits.sessions_day, period=Period.DAY)
    doc = new_session_document(module=MODULE_ID, context=context, max_duration_ms=max_duration_ms)
    try:
        await ref.create(doc)
    except AlreadyExists:
        # A concurrent retry created it first; the quota unit was already counted for that request.
        await UsageService(db).record(user.uid, {Metric.SESSIONS: -1}, period=Period.DAY)
        snap = await ref.get()
        doc = snap.to_dict() or doc
    return SessionCreated(id=session_id, status=str(doc.get("status")), maxDurationMs=int(doc["maxDurationMs"]),
                          liveUrl=f"/api/v1/sessions/{session_id}/live")


class RetrySession(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: Annotated[str, Field(description="Client-generated UUIDv4 for the new attempt.")]


@router.post("/sessions/{session_id}/retry", status_code=status.HTTP_201_CREATED, response_model=SessionCreated)
async def retry_session(
    session_id: str,
    body: RetrySession,
    user: Annotated[AuthUser, Depends(rate_limit("interview_sessions", limit=30, window_seconds=3600))],
) -> SessionCreated:
    """A new attempt at the same round that targets the weak competencies with different questions."""
    new_session_id = client_uuid(body.id)
    db = clients.firestore()
    paths = UserPaths(user.uid)
    source_snap = await db.document(paths.session(session_id)).get()
    if not source_snap.exists:
        raise NotFound()
    source = source_snap.to_dict() or {}
    if source.get("processingStatus") != "completed":
        raise Conflict("feedback for this attempt isn't ready yet")
    if not user.verified_for_ai:
        raise EmailNotVerified()
    await require_consents(user, ConsentKind.AI_PROCESSING, ConsentKind.RECORDING)
    if not await ai_enabled():
        raise ServiceUnavailable()

    ref = db.document(paths.session(new_session_id))
    existing = await ref.get()
    if existing.exists:
        data = existing.to_dict() or {}
        return SessionCreated(id=new_session_id, status=data.get("status", ""),
                              maxDurationMs=data.get("maxDurationMs", 0),
                              liveUrl=f"/api/v1/sessions/{new_session_id}/live")

    _, limits = await plan_limits(user)
    await UsageService(db).reserve(user.uid, Metric.SESSIONS, 1, limit=limits.sessions_day, period=Period.DAY)
    doc = new_session_document(
        module=MODULE_ID,
        context=dict(source.get("context") or {}),
        max_duration_ms=int(source.get("maxDurationMs", 30 * 60_000)),
        attempt_no=int(source.get("attemptNo", 1)) + 1,
        retry_of=session_id,
        retry_targets=source.get("retryPlan") or {},
    )
    try:
        await ref.create(doc)
    except AlreadyExists:
        await UsageService(db).record(user.uid, {Metric.SESSIONS: -1}, period=Period.DAY)
    return SessionCreated(id=new_session_id, status="created", maxDurationMs=int(doc["maxDurationMs"]),
                          liveUrl=f"/api/v1/sessions/{new_session_id}/live")
