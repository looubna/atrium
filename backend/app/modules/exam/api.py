"""Oral exam sessions (`/api/v1/exam/...`).

A session is one attempt at an oral exam for one course. The style it runs in is
settled here, on the server: the student's own answer first, then what the
analysis inferred, and a spoken exam if neither says.
"""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, status
from google.api_core.exceptions import AlreadyExists
from pydantic import BaseModel, ConfigDict, Field

from app.core.errors import Conflict, NotFound, ServiceUnavailable
from app.core.settings import get_settings
from app.modules.exam import MODULE_ID
from app.modules.exam.catalogs import ExamStyle, parse_style
from app.modules.exam.examiners import examiner_for
from app.modules.exam.knowledge import style_from_materials
from app.modules.interview import livetalking
from app.modules.interview.api import GRACE_MS, EmailNotVerified
from app.modules.interview.sanitize import clean_phrase
from app.platform.auth.dependencies import AuthUser
from app.platform.clients import clients
from app.platform.firestore.paths import UserPaths, client_uuid, require_id
from app.platform.ratelimit import rate_limit
from app.platform.runtime_config import ai_enabled
from app.platform.sessions import new_session_document
from app.platform.usage import Metric, Period, UsageService
from app.platform.users import ConsentKind, plan_limits, require_consents

router = APIRouter(prefix="/exam", tags=["exam"])

#: An oral exam is short; the university ones people practise for run 15-30 minutes.
DEFAULT_MINUTES = 20


class CreateSession(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: Annotated[str, Field(description="Client-generated UUIDv4; retrying with the same id is safe.")]
    courseId: str | None = None
    analysisId: str | None = None
    #: What the student answered, when they were asked at all. "unknown" leaves it to the analysis.
    style: ExamStyle = ExamStyle.UNKNOWN
    durationMinutes: Annotated[int, Field(ge=5, le=60)] = DEFAULT_MINUTES


class SessionCreated(BaseModel):
    id: str
    status: str
    maxDurationMs: int
    liveUrl: str
    examStyle: str


def _created(session_id: str, data: dict[str, Any]) -> SessionCreated:
    return SessionCreated(
        id=session_id,
        status=str(data.get("status", "")),
        maxDurationMs=int(data.get("maxDurationMs", 0)),
        liveUrl=f"/api/v1/sessions/{session_id}/live",
        examStyle=str((data.get("context") or {}).get("examStyle", ExamStyle.ORAL_QUESTIONS.value)),
    )


async def _exam_context(uid: str, body: CreateSession) -> dict[str, Any]:
    """The course, the analysis it was built from, and the style the exam will run in."""
    asked: ExamStyle = body.style
    style: ExamStyle
    if not body.courseId:
        # Nothing uploaded: the exam still runs, on the subject the student typed alone.
        style = ExamStyle.ORAL_QUESTIONS if asked is ExamStyle.UNKNOWN else asked
        return {"subject": "", "examStyle": style.value, "topics": []}

    db, paths = clients.firestore(), UserPaths(uid)
    course_snap = await db.document(paths.course(body.courseId)).get()
    if not course_snap.exists:
        raise NotFound()
    course = course_snap.to_dict() or {}
    analysis_id = body.analysisId or course.get("activeAnalysisId")
    if not analysis_id:
        raise Conflict("your materials haven't been analysed yet")
    analysis_snap = await db.document(paths.exam_analysis(body.courseId, require_id(str(analysis_id)))).get()
    if not analysis_snap.exists:
        raise NotFound()
    analysis = analysis_snap.to_dict() or {}
    if analysis.get("status") != "ready":
        raise Conflict("your materials are still being read")

    chosen = parse_style(course.get("chosenStyle")) if course.get("chosenStyle") else ExamStyle.UNKNOWN
    inferred = parse_style(analysis.get("examStyle"))
    # The student's own answer wins; then what the material and the web research decided; and
    # when the student said "I'm not sure" and neither settled it, the material decides.
    settled = next((s for s in (asked, chosen, inferred) if s is not ExamStyle.UNKNOWN), None)
    style = settled or style_from_materials(analysis)
    source = (
        "student" if asked is not ExamStyle.UNKNOWN or chosen is not ExamStyle.UNKNOWN
        else "analysis" if settled is not None
        else "materials"
    )
    return {
        "courseId": body.courseId,
        "analysisId": str(analysis_id),
        "subject": clean_phrase(str(course.get("subject", "")), 160),
        "examStyle": style.value,
        "styleSource": source,
        "topics": [clean_phrase(str(t.get("name", "")), 90) for t in analysis.get("topics", [])][:14],
    }


@router.post("/sessions", status_code=status.HTTP_201_CREATED, response_model=SessionCreated)
async def create_session(
    body: CreateSession,
    user: Annotated[AuthUser, Depends(rate_limit("exam_sessions", limit=30, window_seconds=3600))],
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

    context = await _exam_context(user.uid, body)
    _, limits = await plan_limits(user)
    minutes = min(body.durationMinutes, limits.max_round_minutes)
    context["durationMinutes"] = minutes
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


class RetrySession(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: Annotated[str, Field(description="Client-generated UUIDv4 for the new attempt.")]


@router.post("/sessions/{session_id}/retry", status_code=status.HTTP_201_CREATED, response_model=SessionCreated)
async def retry_session(
    session_id: str,
    body: RetrySession,
    user: Annotated[AuthUser, Depends(rate_limit("exam_sessions", limit=30, window_seconds=3600))],
) -> SessionCreated:
    """Sit the same exam again: the same course, new questions, aimed at what went weakest."""
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

    _, limits = await plan_limits(user)
    await UsageService(db).reserve(user.uid, Metric.SESSIONS, 1, limit=limits.sessions_day, period=Period.DAY)
    doc = new_session_document(
        module=MODULE_ID,
        context=dict(source.get("context") or {}),
        max_duration_ms=int(source.get("maxDurationMs", DEFAULT_MINUTES * 60_000)),
        attempt_no=int(source.get("attemptNo", 1)) + 1,
        retry_of=session_id,
        # Only a graded attempt has a plan; sitting it again straight away simply brings new questions.
        retry_targets=source.get("retryPlan") or {},
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
    """A face for the examiner. A 503 simply means no face: the exam runs on voice alone."""
    session_id = require_id(session_id)
    await require_consents(user, ConsentKind.AI_PROCESSING)

    snap = await clients.firestore().document(UserPaths(user.uid).session(session_id)).get()
    if not snap.exists:
        raise NotFound()
    context = (snap.to_dict() or {}).get("context") or {}
    person = examiner_for(context.get("examStyle"))

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
