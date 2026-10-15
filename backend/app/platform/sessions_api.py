"""Session read and media access API (`/api/v1/sessions/...`), shared by all modules."""

from __future__ import annotations

import asyncio
import os
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Query
from fastapi.responses import FileResponse
from google.cloud import firestore

from app.core.errors import Conflict, NotFound
from app.core.settings import Env, get_settings
from app.modules.registry import registry
from app.platform.auth.dependencies import AuthUser, current_user
from app.platform.clients import clients
from app.platform.firestore.paths import UserPaths, job_path, new_id, require_id
from app.platform.jobs.pipeline import PREPARE, enqueue_step
from app.platform.jobs.processing import session_job_id
from app.platform.ratelimit import rate_limit
from app.platform.sessions import ProcessingStatus
from app.platform.storage.paths import StoragePaths
from app.platform.storage.signing import signed_get_url, verify_local_signature
from app.platform.usage import Metric, Period, UsageService
from app.platform.users import plan_limits

router = APIRouter(prefix="/sessions", tags=["sessions"])

PLAYBACK_TTL = timedelta(minutes=90)
DOWNLOAD_TTL = timedelta(minutes=10)
PUBLIC_FIELDS = (
    "module", "context", "status", "processingStatus", "failure", "attemptNo", "retryOfSessionId",
    "maxDurationMs", "endReason", "currentEvaluationRunId", "summary", "retryPlan",
)


async def _session(uid: str, session_id: str) -> dict[str, Any]:
    snap = await clients.firestore().document(UserPaths(uid).session(session_id)).get()
    if not snap.exists:
        raise NotFound()
    return snap.to_dict() or {}


def _public(session_id: str, data: dict[str, Any]) -> dict[str, Any]:
    media = data.get("media") or {}
    video = media.get("video") or None
    return {
        "id": session_id,
        **{k: data.get(k) for k in PUBLIC_FIELDS},
        "media": {"durationMs": media.get("durationMs", 0), "hasAudio": bool(media.get("audioPath")),
                  "deleted": bool(media.get("deleted")),
                  "video": {"state": video.get("state"), "startedAtMediaMs": int(video.get("startedAtMediaMs", 0))}
                  if video else None},
        "createdAt": data.get("createdAt"),
    }


MediaKind = Literal["audio", "video"]


def _media_object(uid: str, session_id: str, media: dict[str, Any], kind: MediaKind) -> tuple[str, str, int]:
    """Object name, content type and media-clock offset of a session's recording."""
    if media.get("deleted"):
        raise NotFound("recording not available")
    paths = StoragePaths(uid)
    if kind == "video":
        video = media.get("video") or {}
        name = str(video.get("path") or "")
        if video.get("state") != "ready" or not name.startswith(paths.session_prefix(session_id)):
            raise NotFound("video not available")
        return name, str(video.get("contentType")), int(video.get("startedAtMediaMs", 0))
    if not media.get("audioPath"):
        raise NotFound("recording not available")
    return paths.session_audio(session_id), "audio/mp4", 0


@router.get("/{session_id}")
async def get_session(session_id: str, user: current_user) -> dict[str, Any]:
    return _public(require_id(session_id), await _session(user.uid, session_id))


@router.get("/{session_id}/feedback")
async def get_feedback(session_id: str, user: current_user) -> dict[str, Any]:
    session_id = require_id(session_id)
    data = await _session(user.uid, session_id)
    run_id = data.get("currentEvaluationRunId")
    if data.get("processingStatus") != ProcessingStatus.COMPLETED.value or not run_id:
        return {"session": _public(session_id, data), "evaluation": None, "events": []}

    db, paths = clients.firestore(), UserPaths(user.uid)
    run = (await db.document(paths.evaluation(session_id, run_id)).get()).to_dict() or {}
    events = [snap.to_dict() or {} async for snap in db.collection(paths.events(session_id, run_id)).stream()]
    events.sort(key=lambda e: int(e.get("timestampStart", 0)))
    settings = get_settings()
    transcript_url = await signed_get_url(
        settings.user_content_bucket, StoragePaths(user.uid).transcript(session_id),
        expires_in=PLAYBACK_TTL, content_type="application/json",
    )
    ids = {str(e.get("competencyId")) for e in events}
    ids.update(str(s.get("competencyId")) for s in ((data.get("summary") or {}).get("scores") or []))
    try:
        namer = registry.service(str(data.get("module")), "competency_name")
        names = {cid: str(namer(cid)) for cid in ids}
    except LookupError:
        names = {cid: cid for cid in ids}
    return {
        "session": _public(session_id, data),
        "evaluation": {k: run.get(k) for k in ("overallScore", "strengths", "improvements", "catalogVersion")},
        "events": events,
        "transcriptUrl": transcript_url,
        "competencyNames": names,
    }


@router.get("/{session_id}/media/playback-url")
async def playback_url(
    session_id: str, user: current_user, kind: Annotated[MediaKind, Query()] = "audio"
) -> dict[str, Any]:
    session_id = require_id(session_id)
    media = (await _session(user.uid, session_id)).get("media") or {}
    name, content_type, offset_ms = _media_object(user.uid, session_id, media, kind)
    url = await signed_get_url(
        get_settings().user_content_bucket, name, expires_in=PLAYBACK_TTL, content_type=content_type
    )
    return {"url": url, "kind": kind, "startedAtMediaMs": offset_ms,
            "expiresAt": (datetime.now(UTC) + PLAYBACK_TTL).isoformat()}


@router.get("/{session_id}/media/download-url")
async def download_url(
    session_id: str, user: current_user, kind: Annotated[MediaKind, Query()] = "audio"
) -> dict[str, Any]:
    session_id = require_id(session_id)
    media = (await _session(user.uid, session_id)).get("media") or {}
    name, content_type, _ = _media_object(user.uid, session_id, media, kind)
    file_name = f"interview-{session_id[:8]}{'-video' if kind == 'video' else ''}.{name.rsplit('.', 1)[-1]}"
    url = await signed_get_url(
        get_settings().user_content_bucket, name,
        expires_in=DOWNLOAD_TTL, content_type=content_type, download_filename=file_name,
    )
    return {"url": url, "fileName": file_name, "expiresAt": (datetime.now(UTC) + DOWNLOAD_TTL).isoformat()}


@router.post("/{session_id}/reprocess", status_code=202)
async def reprocess(
    session_id: str,
    user: Annotated[AuthUser, Depends(rate_limit("session_reprocess", limit=5, window_seconds=3600))],
) -> dict[str, str]:
    session_id = require_id(session_id)
    data = await _session(user.uid, session_id)
    if data.get("processingStatus") not in (ProcessingStatus.FAILED.value, ProcessingStatus.COMPLETED.value):
        raise Conflict("this session is not ready to be processed again")
    # Feedback on a session already held, not new practice: allowed after the trial too.
    _, limits = await plan_limits(user, practice=False)
    await UsageService(clients.firestore()).reserve(
        user.uid, Metric.REPROCESS, 1, limit=limits.reprocess_day, period=Period.DAY
    )
    job_id, run_id, now = session_job_id(session_id), new_id(), datetime.now(UTC)
    job_ref = clients.firestore().document(job_path(job_id))
    await job_ref.set(
        {"uid": user.uid, "sessionId": session_id, "module": data.get("module"), "kind": "session_processing",
         "runId": run_id, "step": PREPARE, "status": "queued", "failures": 0, "leaseUntil": None,
         "createdAt": firestore.SERVER_TIMESTAMP, "updatedAt": now, "expireAt": None},
        merge=True,
    )
    await clients.firestore().document(UserPaths(user.uid).session(session_id)).update(
        {"processingStatus": ProcessingStatus.QUEUED.value, "failure": None}
    )
    await enqueue_step(job_id, run_id, PREPARE)
    return {"status": "queued"}


# -- local development only: serves HMAC-signed links from the filesystem store ----

local_router = APIRouter(prefix="/local-objects", include_in_schema=False)


def _resolve_local_object(bucket: str, name: str) -> Path | None:
    root = Path(os.environ.get("LOCAL_OBJECTS_DIR", ".local-objects")).resolve() / bucket
    path = (root / name).resolve()
    return path if root in path.parents and path.is_file() else None


@local_router.get("/{bucket}/{name:path}")
async def local_object(
    bucket: str, name: str, exp: Annotated[int, Query()], disp: Annotated[str, Query()],
    type: Annotated[str, Query()], sig: Annotated[str, Query()],
) -> FileResponse:
    settings = get_settings()
    if settings.app_env not in (Env.LOCAL, Env.TEST) or not verify_local_signature(bucket, name, exp, disp, sig):
        raise NotFound()
    path = await asyncio.to_thread(_resolve_local_object, bucket, name)
    if path is None:
        raise NotFound()
    headers = {"Content-Disposition": disp, "Cache-Control": f"private, max-age={max(0, exp - int(time.time()))}"}
    return FileResponse(path, media_type=type, headers=headers)
