"""Resume upload and management (`/api/v1/interview/resumes`)."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, File, Response, UploadFile, status

from app.core.errors import NotFound, PayloadTooLarge, QuotaExceeded, UnsupportedMedia
from app.core.settings import get_settings
from app.modules.interview import MODULE_ID
from app.modules.interview.resumes import CONTENT_TYPES, UnsupportedResume, detect_kind
from app.modules.interview.sanitize import clean_phrase
from app.platform.auth.dependencies import AuthUser, current_user
from app.platform.clients import clients
from app.platform.firestore.paths import UserPaths, new_id, require_id
from app.platform.jobs.module_tasks import enqueue_module_task
from app.platform.ratelimit import rate_limit
from app.platform.storage.objects import user_content
from app.platform.storage.paths import StoragePaths
from app.platform.users import ConsentKind, plan_limits, require_consents

router = APIRouter(prefix="/interview/resumes", tags=["interview"])


def _view(resume_id: str, data: dict[str, Any]) -> dict[str, Any]:
    profile = data.get("profile") or {}
    return {
        "id": resume_id,
        "fileName": data.get("fileName"),
        "status": data.get("status"),
        "stage": data.get("stage"),
        "failureReason": data.get("failureReason"),
        "createdAt": data.get("createdAt"),
        "currentTitle": profile.get("currentTitle"),
        "summary": profile.get("summary"),
    }


@router.post("", status_code=status.HTTP_201_CREATED)
async def upload_resume(
    file: Annotated[UploadFile, File()],
    user: Annotated[AuthUser, Depends(rate_limit("resume_upload", limit=20, window_seconds=3600))],
) -> dict[str, Any]:
    # Resumes are processed with AI to build the interview journey.
    await require_consents(user, ConsentKind.AI_PROCESSING)
    settings = get_settings()
    data = await file.read(settings.max_resume_bytes + 1)
    if len(data) > settings.max_resume_bytes:
        raise PayloadTooLarge("Resumes can be up to 10 MB")
    try:
        kind = detect_kind(file.filename or "", data)
    except UnsupportedResume as exc:
        raise UnsupportedMedia("Upload a PDF, Word (.docx) or text resume") from exc

    db = clients.firestore()
    paths = UserPaths(user.uid)
    _, limits = await plan_limits(user)
    existing = [s async for s in db.collection(paths.resumes()).limit(limits.resumes_max + 1).stream()]
    if len(existing) >= limits.resumes_max:
        raise QuotaExceeded(extra={"metric": "resumes", "limit": limits.resumes_max})

    resume_id = new_id()
    storage_path = StoragePaths(user.uid).resume_original(resume_id, kind)
    await user_content().write(storage_path, data, CONTENT_TYPES[kind], create_only=True)
    doc = {
        "fileName": clean_phrase(file.filename or f"resume.{kind}", 120),
        "kind": kind,
        "contentType": CONTENT_TYPES[kind],
        "sizeBytes": len(data),
        "storagePath": storage_path,
        "status": "processing",
        "stage": "reading",
        "createdAt": datetime.now(UTC),
    }
    await db.document(paths.resume(resume_id)).set(doc)
    await enqueue_module_task(MODULE_ID, "extract_resume", {"uid": user.uid, "resumeId": resume_id},
                              name_parts=(resume_id,))
    return _view(resume_id, doc)


@router.get("")
async def list_resumes(user: current_user) -> list[dict[str, Any]]:
    query = clients.firestore().collection(UserPaths(user.uid).resumes()).order_by("createdAt", direction="DESCENDING")
    return [_view(s.id, s.to_dict() or {}) async for s in query.limit(50).stream()]


@router.delete("/{resume_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_resume(resume_id: str, user: current_user) -> Response:
    resume_id = require_id(resume_id)
    ref = clients.firestore().document(UserPaths(user.uid).resume(resume_id))
    if not (await ref.get()).exists:
        raise NotFound()
    await user_content().delete_prefix(StoragePaths(user.uid).resume_prefix(resume_id))
    await ref.delete()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
