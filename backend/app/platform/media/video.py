"""Camera video for a session: resumable upload, verification and remux.

    app ── POST /sessions/{id}/media/video-upload ──▶ resumable upload URL (object name chosen here)
    app ── PUT chunks straight to Cloud Storage (Content-Range) ──▶ user-content bucket
    app ── POST /sessions/{id}/media/video-complete ──▶ size checked ──▶ Cloud Task
    worker ── /internal/media/remux ──▶ video stream copied into a streamable file ──▶ state "ready"

Video is visual only. The session's server-side audio (`audio.m4a`) is the
timeline for feedback; the app plays the video in sync with it, offset by
`startedAtMediaMs`, so the camera can start late or stop early. Large files
never pass through the API.
"""

from __future__ import annotations

import asyncio
import logging
import re
import tempfile
from datetime import UTC, datetime, timedelta
from enum import StrEnum
from pathlib import Path
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Header, Query, Request, Response
from google.cloud import firestore
from pydantic import BaseModel, ConfigDict, Field

from app.core.errors import BadRequest, Conflict, NotFound, PayloadTooLarge
from app.core.settings import Env, get_settings
from app.platform.auth.dependencies import AuthUser
from app.platform.clients import clients
from app.platform.firestore.paths import UserPaths, new_id, require_id
from app.platform.jobs.queue import TaskRequest, task_name, task_queue
from app.platform.media.ffmpeg import FfmpegError, run_ffmpeg
from app.platform.ratelimit import rate_limit
from app.platform.sessions import SessionStatus
from app.platform.storage.objects import LocalObjectStore, user_content
from app.platform.storage.paths import StoragePaths
from app.platform.storage.signing import resumable_upload_url, verify_local_upload_signature
from app.platform.users import ConsentKind, require_consents

log = logging.getLogger(__name__)

router = APIRouter(prefix="/sessions", tags=["sessions"])
local_upload_router = APIRouter(prefix="/local-uploads", include_in_schema=False)

VIDEO_EXTENSIONS = {"video/mp4": "mp4", "video/webm": "webm"}
#: Cloud Storage needs chunks in multiples of 256 KiB (except the last).
UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024
UPLOAD_LINK_TTL = timedelta(hours=24)
REMUX_QUEUE = "processing"
REMUX_PATH = "/internal/media/remux"
REMUX_TIMEOUT_S = 1200
MAX_START_MS = 6 * 60 * 60 * 1000


class VideoState(StrEnum):
    UPLOADING = "uploading"
    PROCESSING = "processing"
    READY = "ready"
    FAILED = "failed"


class VideoUploadBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    contentType: Literal["video/mp4", "video/webm"]
    sizeBytes: Annotated[int, Field(gt=0)]
    startedAtMediaMs: Annotated[int, Field(ge=0, le=MAX_START_MS)]


class VideoCompleteBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    uploadId: Annotated[str, Field(pattern=r"^[A-Za-z0-9_-]{8,64}$")]


async def _load(uid: str, session_id: str) -> tuple[firestore.AsyncDocumentReference, dict[str, Any]]:
    ref = clients.firestore().document(UserPaths(uid).session(session_id))
    snap = await ref.get()
    if not snap.exists:
        raise NotFound()
    return ref, snap.to_dict() or {}


@router.post("/{session_id}/media/video-upload", status_code=201)
async def create_video_upload(
    session_id: str,
    body: VideoUploadBody,
    request: Request,
    user: Annotated[AuthUser, Depends(rate_limit("video_upload", limit=10, window_seconds=3600))],
) -> dict[str, Any]:
    session_id = require_id(session_id)
    settings = get_settings()
    if body.sizeBytes > settings.max_video_bytes:
        raise PayloadTooLarge(extra={"limit": settings.max_video_bytes})
    await require_consents(user, ConsentKind.RECORDING)
    ref, data = await _load(user.uid, session_id)
    media = data.get("media") or {}
    if data.get("status") not in (SessionStatus.LIVE.value, SessionStatus.ENDED.value) or media.get("deleted"):
        raise Conflict("this session can't take a video")
    if (media.get("video") or {}).get("state") in (VideoState.PROCESSING.value, VideoState.READY.value):
        raise Conflict("this session already has a video")

    upload_id = new_id()
    name = StoragePaths(user.uid).session_video(session_id, upload_id, VIDEO_EXTENSIONS[body.contentType])
    origin = request.headers.get("origin")
    url = await resumable_upload_url(
        settings.user_content_bucket,
        name,
        content_type=body.contentType,
        size=body.sizeBytes,
        origin=origin if origin in settings.allowed_origins else None,
        expires_in=UPLOAD_LINK_TTL,
    )
    # A newer upload replaces an unfinished one; the old upload's completion then finds no match.
    await ref.update(
        {
            "media.video": {
                "uploadId": upload_id,
                "path": name,
                "contentType": body.contentType,
                "sizeBytes": body.sizeBytes,
                "startedAtMediaMs": body.startedAtMediaMs,
                "state": VideoState.UPLOADING.value,
                "createdAt": datetime.now(UTC),
            }
        }
    )
    return {"uploadId": upload_id, "uploadUrl": url, "chunkBytes": UPLOAD_CHUNK_BYTES}


@router.post("/{session_id}/media/video-complete")
async def complete_video_upload(
    session_id: str,
    body: VideoCompleteBody,
    user: Annotated[AuthUser, Depends(rate_limit("video_complete", limit=30, window_seconds=3600))],
) -> dict[str, str]:
    session_id = require_id(session_id)
    ref, data = await _load(user.uid, session_id)
    video = (data.get("media") or {}).get("video") or {}
    if video.get("uploadId") != body.uploadId:
        raise NotFound("upload not found")
    if video.get("state") != VideoState.UPLOADING.value:
        return {"state": str(video.get("state"))}
    size = await user_content().size(str(video["path"]))
    if size != int(video["sizeBytes"]):
        raise Conflict("the upload is incomplete")

    await _set_state(ref, body.uploadId, VideoState.PROCESSING, expect=VideoState.UPLOADING)
    await task_queue().enqueue(
        TaskRequest(
            queue=REMUX_QUEUE,
            path=REMUX_PATH,
            payload={"uid": user.uid, "sessionId": session_id, "uploadId": body.uploadId},
            name=task_name("remux", session_id, body.uploadId),
        )
    )
    return {"state": VideoState.PROCESSING.value}


async def _set_state(
    ref: firestore.AsyncDocumentReference, upload_id: str, state: VideoState, *, expect: VideoState | None = None
) -> bool:
    """Change the video's state only if it is still the same upload (and in `expect`, when given)."""

    @firestore.async_transactional
    async def txn(transaction: firestore.AsyncTransaction) -> bool:
        snap = await ref.get(transaction=transaction)
        video = ((snap.to_dict() or {}).get("media") or {}).get("video") or {}
        if not snap.exists or video.get("uploadId") != upload_id:
            return False
        if expect is not None and video.get("state") != expect.value:
            return False
        transaction.update(ref, {"media.video.state": state.value, "media.video.updatedAt": datetime.now(UTC)})
        return True

    return bool(await txn(clients.firestore().transaction()))


async def remux_video(uid: str, session_id: str, upload_id: str) -> str:
    """Worker: rewrite the upload for streaming and mark it ready, or failed if it isn't a playable video.

    Only the first video stream is copied (no re-encoding): MP4 gets its index moved to the front so
    playback starts before the whole file downloads; WebM from MediaRecorder gains duration and cues.
    Transient storage errors propagate so Cloud Tasks retries.
    """
    ref = clients.firestore().document(UserPaths(uid).session(require_id(session_id)))
    snap = await ref.get()
    video = ((snap.to_dict() or {}).get("media") or {}).get("video") or {}
    if not snap.exists or video.get("uploadId") != upload_id or video.get("state") != VideoState.PROCESSING.value:
        return "skipped"
    ext = VIDEO_EXTENSIONS.get(str(video.get("contentType")))
    name = str(video.get("path"))
    if ext is None or name != StoragePaths(uid).session_video(session_id, upload_id, ext):
        await _set_state(ref, upload_id, VideoState.FAILED)
        return "failed"

    store = user_content()
    with tempfile.TemporaryDirectory(prefix="atrium-video-") as tmp:
        source, output = Path(tmp) / f"source.{ext}", Path(tmp) / f"output.{ext}"
        try:
            await store.download_to(name, source)
        except FileNotFoundError:
            await _set_state(ref, upload_id, VideoState.FAILED)
            return "failed"
        args = ["-i", str(source), "-map", "0:v:0", "-c", "copy"]
        if ext == "mp4":
            args += ["-movflags", "+faststart"]
        try:
            await run_ffmpeg([*args, str(output)], timeout_s=REMUX_TIMEOUT_S)
        except FfmpegError:
            log.warning("uploaded video could not be processed", extra={"sessionId": session_id})
            await _set_state(ref, upload_id, VideoState.FAILED)
            return "failed"
        # The account or session may have been deleted meanwhile; don't recreate its object.
        if not (await ref.get()).exists:
            return "skipped"
        await store.upload_file(output, name, str(video["contentType"]))

    await _set_state(ref, upload_id, VideoState.READY, expect=VideoState.PROCESSING)
    log.info("session video ready", extra={"sessionId": session_id})
    return "ready"


# -- local development only: the chunked PUT protocol of Cloud Storage resumable uploads ----

_CONTENT_RANGE = re.compile(r"^bytes (?:(\d+)-(\d+)|\*)/(\d+)$")


@local_upload_router.put("/{bucket}/{name:path}")
async def local_upload(
    bucket: str,
    name: str,
    request: Request,
    exp: Annotated[int, Query()],
    size: Annotated[int, Query()],
    type: Annotated[str, Query()],
    sig: Annotated[str, Query()],
    content_range: Annotated[str | None, Header()] = None,
) -> Response:
    settings = get_settings()
    store = user_content()
    if (
        settings.app_env not in (Env.LOCAL, Env.TEST)
        or bucket != settings.user_content_bucket
        or not isinstance(store, LocalObjectStore)
        or not verify_local_upload_signature(bucket, name, exp, size, type, sig)
    ):
        raise NotFound()
    match = _CONTENT_RANGE.fullmatch(content_range or "")
    if match is None or int(match.group(3)) != size:
        raise BadRequest("invalid Content-Range")
    path = store.local_path(name)
    body = await request.body()

    def apply() -> int:
        """Write the chunk if it continues the upload; return how many bytes are stored."""
        stored = path.stat().st_size if path.is_file() else 0
        if match.group(1) is None:
            if body:
                raise ValueError("a status query has no body")
            return stored
        start, end = int(match.group(1)), int(match.group(2))
        if end < start or end >= size or len(body) != end - start + 1 or start > stored:
            raise ValueError("chunk does not continue the upload")
        if end + 1 > stored:
            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open("r+b" if path.is_file() else "wb") as fh:
                fh.seek(start)
                fh.write(body)
            stored = end + 1
        return stored

    try:
        stored = await asyncio.to_thread(apply)
    except ValueError as exc:
        raise BadRequest(str(exc)) from None
    if stored >= size:
        return Response(status_code=200)
    return Response(status_code=308, headers={"Range": f"bytes=0-{stored - 1}"} if stored else {})
