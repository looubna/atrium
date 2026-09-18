"""Courses, their study materials, and the analysis of them (`/api/v1/exam/courses`).

The student gives two things: what they are preparing for, and whatever material
they have. Everything else — what each file is, what the exam covers, how it is
run — is worked out from the material by the analyst, so nothing here asks the
student to classify or configure anything.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any

from fastapi import APIRouter, Depends, File, Response, UploadFile, status
from google.api_core.exceptions import AlreadyExists
from google.cloud import firestore
from google.cloud.firestore_v1.base_query import FieldFilter
from pydantic import BaseModel, ConfigDict, Field, HttpUrl

from app.core.errors import Conflict, NotFound, PayloadTooLarge, QuotaExceeded, ServiceUnavailable, UnsupportedMedia
from app.core.settings import get_settings
from app.modules.exam import MODULE_ID
from app.modules.exam.catalogs import ExamStyle, parse_style
from app.modules.exam.materials import CONTENT_TYPES, EXTENSIONS, UnsupportedMaterial, detect_kind, guess_type
from app.modules.interview.api import EmailNotVerified
from app.modules.interview.sanitize import clean_phrase, clean_text
from app.platform.auth.dependencies import AuthUser, current_user
from app.platform.clients import clients
from app.platform.firestore.paths import UserPaths, client_uuid, new_id
from app.platform.jobs.module_tasks import enqueue_module_task
from app.platform.ratelimit import rate_limit
from app.platform.runtime_config import ai_enabled
from app.platform.storage.objects import user_content
from app.platform.storage.paths import StoragePaths
from app.platform.usage import Metric, Period, UsageService
from app.platform.users import ConsentKind, plan_limits, require_consents

log = logging.getLogger(__name__)

router = APIRouter(prefix="/exam/courses", tags=["exam"])

#: An analysis normally finishes in a couple of minutes; an older one lost its worker.
STALE_ANALYSIS = timedelta(minutes=15)
MAX_PASTED_CHARS = 50_000


class CourseCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    subject: Annotated[str, Field(min_length=1, max_length=160)]


class LinkMaterial(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    url: HttpUrl
    title: Annotated[str, Field(max_length=160)] = ""


class TextMaterial(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    text: Annotated[str, Field(min_length=1, max_length=MAX_PASTED_CHARS)]
    title: Annotated[str, Field(max_length=160)] = ""


class StyleAnswer(BaseModel):
    model_config = ConfigDict(extra="forbid")
    #: The one question the app may ask, and "unknown" is a valid answer to it.
    style: ExamStyle


def _course_view(course_id: str, data: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": course_id,
        "subject": data.get("subject"),
        "status": data.get("status"),
        "activeAnalysisId": data.get("activeAnalysisId"),
        "materialCount": data.get("materialCount", 0),
        "chosenStyle": data.get("chosenStyle"),
        "createdAt": data.get("createdAt"),
    }


def _material_view(material_id: str, data: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": material_id,
        "source": data.get("source"),
        "name": data.get("name"),
        "url": data.get("url"),
        "status": data.get("status"),
        "failureReason": data.get("failureReason"),
        # The provisional guess until the analyst has read everything, then its reading.
        "detectedType": data.get("detectedType"),
        "detectedTitle": data.get("detectedTitle"),
        "sizeBytes": data.get("sizeBytes"),
        "createdAt": data.get("createdAt"),
    }


async def _course_ref(uid: str, course_id: str):  # type: ignore[no-untyped-def]
    ref = clients.firestore().document(UserPaths(uid).course(course_id))
    if not (await ref.get()).exists:
        raise NotFound()
    return ref


async def _add_material(
    user: AuthUser, course_id: str, material_id: str, doc: dict[str, Any], *, extract: bool
) -> dict[str, Any]:
    """Creates the material and, for anything with text in it, queues the reading."""
    db, paths = clients.firestore(), UserPaths(user.uid)
    ref = db.document(paths.material(course_id, material_id))
    existing = await ref.get()
    if existing.exists:
        return _material_view(material_id, existing.to_dict() or {})
    _, limits = await plan_limits(user)
    count = len(
        [s async for s in db.collection(paths.materials(course_id)).limit(limits.materials_per_course_max + 1).stream()]
    )
    if count >= limits.materials_per_course_max:
        raise QuotaExceeded(extra={"metric": "materials", "limit": limits.materials_per_course_max})
    doc = {**doc, "createdAt": datetime.now(UTC)}
    try:
        await ref.create(doc)
    except AlreadyExists:
        return _material_view(material_id, (await ref.get()).to_dict() or doc)
    await db.document(paths.course(course_id)).update(
        # Incremented rather than written, so two uploads at once cannot lose one another.
        {"materialCount": firestore.Increment(1), "status": "draft", "updatedAt": datetime.now(UTC)}
    )
    if extract:
        await enqueue_module_task(
            MODULE_ID, "extract_material",
            {"uid": user.uid, "courseId": course_id, "materialId": material_id},
            name_parts=(course_id, material_id),
        )
    return _material_view(material_id, doc)


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_course(body: CourseCreate, user: current_user) -> dict[str, Any]:
    course_id = client_uuid(body.id)
    db, paths = clients.firestore(), UserPaths(user.uid)
    ref = db.document(paths.course(course_id))
    existing = await ref.get()
    if existing.exists:
        return _course_view(course_id, existing.to_dict() or {})
    _, limits = await plan_limits(user)
    count = len([s async for s in db.collection(paths.courses()).limit(limits.courses_max + 1).stream()])
    if count >= limits.courses_max:
        raise QuotaExceeded(extra={"metric": "courses", "limit": limits.courses_max})
    doc = {
        "subject": clean_phrase(body.subject, 160),
        "status": "draft",
        "activeAnalysisId": None,
        "chosenStyle": None,
        "materialCount": 0,
        "createdAt": datetime.now(UTC),
    }
    try:
        await ref.create(doc)
    except AlreadyExists:
        doc = (await ref.get()).to_dict() or doc
    return _course_view(course_id, doc)


@router.get("")
async def list_courses(user: current_user) -> list[dict[str, Any]]:
    query = clients.firestore().collection(UserPaths(user.uid).courses()).order_by("createdAt", direction="DESCENDING")
    return [_course_view(s.id, s.to_dict() or {}) async for s in query.limit(50).stream()]


@router.get("/{course_id}")
async def get_course(course_id: str, user: current_user) -> dict[str, Any]:
    snap = await clients.firestore().document(UserPaths(user.uid).course(course_id)).get()
    if not snap.exists:
        raise NotFound()
    return _course_view(course_id, snap.to_dict() or {})


@router.delete("/{course_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_course(course_id: str, user: current_user) -> Response:
    db = clients.firestore()
    ref = db.document(UserPaths(user.uid).course(course_id))
    if not (await ref.get()).exists:
        raise NotFound()
    await user_content().delete_prefix(StoragePaths(user.uid).course_prefix(course_id))
    await db.recursive_delete(ref)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{course_id}/materials")
async def list_materials(course_id: str, user: current_user) -> list[dict[str, Any]]:
    await _course_ref(user.uid, course_id)
    query = clients.firestore().collection(UserPaths(user.uid).materials(course_id)).order_by("createdAt")
    return [_material_view(s.id, s.to_dict() or {}) async for s in query.limit(200).stream()]


@router.post("/{course_id}/materials", status_code=status.HTTP_201_CREATED)
async def upload_material(
    course_id: str,
    file: Annotated[UploadFile, File()],
    user: Annotated[AuthUser, Depends(rate_limit("exam_material_upload", limit=120, window_seconds=3600))],
) -> dict[str, Any]:
    # Course material is read by AI to work out what the exam covers.
    await require_consents(user, ConsentKind.AI_PROCESSING)
    await _course_ref(user.uid, course_id)
    settings = get_settings()
    data = await file.read(settings.max_material_bytes + 1)
    if len(data) > settings.max_material_bytes:
        raise PayloadTooLarge(f"Each file can be up to {settings.max_material_bytes // 1_048_576} MB")
    try:
        kind = detect_kind(file.filename or "", data)
    except UnsupportedMaterial as exc:
        raise UnsupportedMedia("Upload a PDF, Word, PowerPoint, text file or image") from exc

    material_id = new_id()
    storage_path = StoragePaths(user.uid).material_original(course_id, material_id, EXTENSIONS[kind])
    await user_content().write(storage_path, data, CONTENT_TYPES[kind], create_only=True)
    doc = {
        "source": "file",
        "name": clean_phrase(file.filename or f"material.{kind}", 160),
        "kind": kind,
        "contentType": CONTENT_TYPES[kind],
        "sizeBytes": len(data),
        "storagePath": storage_path,
        "status": "processing",
        "detectedType": None,
    }
    return await _add_material(user, course_id, material_id, doc, extract=True)


@router.post("/{course_id}/materials/link", status_code=status.HTTP_201_CREATED)
async def add_link(
    course_id: str,
    body: LinkMaterial,
    user: Annotated[AuthUser, Depends(rate_limit("exam_material_upload", limit=120, window_seconds=3600))],
) -> dict[str, Any]:
    await require_consents(user, ConsentKind.AI_PROCESSING)
    await _course_ref(user.uid, course_id)
    url = str(body.url)
    if len(url) > 2_000:
        raise UnsupportedMedia("That link is too long")
    # Links are never fetched from here: they are given to the grounded analyst, which searches
    # the web itself. Nothing in this service ever requests a URL a user supplied.
    doc = {
        "source": "link",
        "name": clean_phrase(body.title, 160) or url[:160],
        "url": url,
        "status": "ready",
        "detectedType": "other",
    }
    return await _add_material(user, course_id, client_uuid(body.id), doc, extract=False)


@router.post("/{course_id}/materials/text", status_code=status.HTTP_201_CREATED)
async def add_text(
    course_id: str,
    body: TextMaterial,
    user: Annotated[AuthUser, Depends(rate_limit("exam_material_upload", limit=120, window_seconds=3600))],
) -> dict[str, Any]:
    await require_consents(user, ConsentKind.AI_PROCESSING)
    await _course_ref(user.uid, course_id)
    material_id = client_uuid(body.id)
    text = clean_text(body.text, MAX_PASTED_CHARS)
    if not text:
        raise UnsupportedMedia("That text has nothing readable in it")
    storage_path = StoragePaths(user.uid).material_text(course_id, material_id)
    await user_content().write(storage_path, text.encode(), "text/plain; charset=utf-8")
    doc = {
        "source": "text",
        "name": clean_phrase(body.title, 160) or "Pasted text",
        "kind": "txt",
        "sizeBytes": len(text.encode()),
        "textPath": storage_path,
        "status": "ready",
        "detectedType": guess_type(body.title, text),
    }
    return await _add_material(user, course_id, material_id, doc, extract=False)


@router.delete("/{course_id}/materials/{material_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_material(course_id: str, material_id: str, user: current_user) -> Response:
    db, paths = clients.firestore(), UserPaths(user.uid)
    ref = db.document(paths.material(course_id, material_id))
    if not (await ref.get()).exists:
        raise NotFound()
    await user_content().delete_prefix(StoragePaths(user.uid).material_prefix(course_id, material_id))
    await ref.delete()
    remaining = len([s async for s in db.collection(paths.materials(course_id)).limit(500).stream()])
    await db.document(paths.course(course_id)).update({"materialCount": remaining})
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.put("/{course_id}/style")
async def set_style(course_id: str, body: StyleAnswer, user: current_user) -> dict[str, Any]:
    """The student's own answer to how their exam is run. "unknown" leaves the decision to the analysis."""
    ref = await _course_ref(user.uid, course_id)
    style = None if body.style is ExamStyle.UNKNOWN else body.style.value
    await ref.update({"chosenStyle": style})
    return _course_view(course_id, (await ref.get()).to_dict() or {})


@router.post("/{course_id}/analyses:generate", status_code=status.HTTP_202_ACCEPTED)
async def generate_analysis(
    course_id: str,
    user: Annotated[AuthUser, Depends(rate_limit("exam_analysis", limit=20, window_seconds=3600))],
) -> dict[str, Any]:
    db, paths = clients.firestore(), UserPaths(user.uid)
    course_ref = await _course_ref(user.uid, course_id)
    if not user.verified_for_ai:
        raise EmailNotVerified()
    await require_consents(user, ConsentKind.AI_PROCESSING)
    if not await ai_enabled():
        raise ServiceUnavailable()

    running = db.collection(paths.exam_analyses(course_id)).where(
        filter=FieldFilter("status", "in", ["queued", "analyzing"])
    )
    now = datetime.now(UTC)
    async for snap in running.limit(5).stream():
        current = snap.to_dict() or {}
        started = current.get("startedAt") or current.get("createdAt")
        if started is not None and now - started < STALE_ANALYSIS:
            raise Conflict("your materials are already being read")
        await snap.reference.update({"status": "failed", "failureReason": "stalled"})

    _, limits = await plan_limits(user)
    await UsageService(db).reserve(
        user.uid, Metric.EXAM_ANALYSES, 1, limit=limits.exam_analyses_day, period=Period.DAY
    )
    analysis_id = new_id()
    versions = [s async for s in db.collection(paths.exam_analyses(course_id)).stream()]
    await db.document(paths.exam_analysis(course_id, analysis_id)).set(
        {"status": "queued", "version": len(versions) + 1, "attempts": 0, "createdAt": now}
    )
    await course_ref.update({"status": "analyzing"})
    await enqueue_module_task(
        MODULE_ID, "analyze_course", {"uid": user.uid, "courseId": course_id, "analysisId": analysis_id},
        name_parts=(course_id, analysis_id),
    )
    return {"analysisId": analysis_id, "status": "queued"}


@router.get("/{course_id}/analyses/{analysis_id}")
async def get_analysis(course_id: str, analysis_id: str, user: current_user) -> dict[str, Any]:
    snap = await clients.firestore().document(UserPaths(user.uid).exam_analysis(course_id, analysis_id)).get()
    if not snap.exists:
        raise NotFound()
    data = snap.to_dict() or {}
    data.pop("research", None)  # kept only so a retry of a failed analysis need not search again
    course = (await clients.firestore().document(UserPaths(user.uid).course(course_id)).get()).to_dict() or {}
    chosen = parse_style(course.get("chosenStyle")) if course.get("chosenStyle") else None
    return {
        "id": analysis_id,
        **data,
        # What the exam will actually run as: the student's own answer wins over the inference.
        "effectiveStyle": (chosen.value if chosen else data.get("examStyle")) or ExamStyle.UNKNOWN.value,
    }
