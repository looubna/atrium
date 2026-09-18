"""Private worker endpoints (ROLE=worker), called only with Google-signed OIDC tokens.

- /internal/tasks/{step}   pipeline steps from Cloud Tasks
- /internal/media/remux    Cloud Tasks: make an uploaded camera video streamable
- /internal/cron/reconcile Cloud Scheduler: finish abandoned live sessions, revive stuck jobs
- /internal/cron/retention Cloud Scheduler: delete recordings past their retention date
- /internal/events/budget  Pub/Sub push from the billing budget: trip the AI kill switch
"""

from __future__ import annotations

import base64
import json
import logging
from datetime import UTC, datetime, timedelta
from typing import Any, Literal

from fastapi import APIRouter
from google.cloud.firestore_v1.base_query import FieldFilter
from pydantic import BaseModel

from app.platform.auth.worker import worker_caller
from app.platform.clients import clients
from app.platform.firestore.paths import live_session_path
from app.platform.jobs.module_tasks import run_module_task
from app.platform.jobs.pipeline import EVALUATE, POLL, PREPARE, enqueue_step, execute_step
from app.platform.jobs.processing import enqueue_session_processing
from app.platform.runtime_config import set_ai_enabled
from app.platform.sessions import EndReason, SessionStatus, mark_ended
from app.platform.storage.objects import user_content
from app.platform.storage.paths import StoragePaths

log = logging.getLogger(__name__)

router = APIRouter(prefix="/internal", include_in_schema=False)

ABANDONED_AFTER = timedelta(minutes=15)
STUCK_AFTER = timedelta(minutes=40)
RETENTION_BATCH = 200


class TaskBody(BaseModel):
    jobId: str
    runId: str


@router.post("/tasks/{step}")
async def run_task(step: Literal["prepare_submit_stt", "poll_stt", "evaluate_persist"], body: TaskBody,
                   _: worker_caller) -> dict[str, str]:
    return {"status": await execute_step(step, body.jobId, body.runId)}


@router.post("/modules/{module}/tasks/{task}")
async def run_module(module: str, task: str, body: dict[str, Any], _: worker_caller) -> dict[str, str]:
    await run_module_task(module, task, body)
    return {"status": "done"}


class RemuxBody(BaseModel):
    uid: str
    sessionId: str
    uploadId: str


@router.post("/media/remux")
async def remux(body: RemuxBody, _: worker_caller) -> dict[str, str]:
    from app.platform.media.video import remux_video

    return {"status": await remux_video(body.uid, body.sessionId, body.uploadId)}


@router.post("/account-deletion")
async def account_deletion(body: dict[str, Any], _: worker_caller) -> dict[str, str]:
    from app.platform.deletion import run_deletion

    await run_deletion(body)
    return {"status": "done"}


@router.post("/cron/reconcile")
async def reconcile(_: worker_caller) -> dict[str, int]:
    db = clients.firestore()
    now = datetime.now(UTC)
    ended = revived = 0

    live = db.collection_group("sessions").where(filter=FieldFilter("status", "==", SessionStatus.LIVE.value))
    async for snap in live.stream():
        uid = snap.reference.parent.parent.id if snap.reference.parent.parent else None
        if uid is None:
            continue
        state = (await db.document(live_session_path(snap.id)).get()).to_dict() or {}
        lock = (await db.document(f"liveLocks/{uid}").get()).to_dict() or {}
        updated = state.get("updatedAt")
        lock_held = lock.get("sessionId") == snap.id and lock.get("until") is not None and lock["until"] > now
        if lock_held or (updated is not None and now - updated < ABANDONED_AFTER):
            continue
        if await mark_ended(uid, snap.id, EndReason.DISCONNECTED, int(state.get("mediaMs", 0))):
            await enqueue_session_processing(uid, snap.id, str((snap.to_dict() or {}).get("module")))
            ended += 1

    cutoff = now - STUCK_AFTER
    for status in ("queued", "retrying", "running"):
        stuck = (
            db.collection("jobs")
            .where(filter=FieldFilter("status", "==", status))
            .where(filter=FieldFilter("updatedAt", "<", cutoff))
            .limit(100)
        )
        async for snap in stuck.stream():
            job: dict[str, Any] = snap.to_dict() or {}
            if job.get("step") not in (PREPARE, POLL, EVALUATE):
                continue
            if status == "running" and job.get("leaseUntil") and job["leaseUntil"] > now:
                continue
            await snap.reference.update({"status": "retrying", "updatedAt": now})
            await enqueue_step(snap.id, str(job["runId"]), str(job["step"]), sequence=int(now.timestamp()))
            revived += 1

    log.info("reconcile finished", extra={"endedSessions": ended, "revivedJobs": revived})
    return {"endedSessions": ended, "revivedJobs": revived}


@router.post("/cron/retention")
async def retention(_: worker_caller) -> dict[str, int]:
    db = clients.firestore()
    now = datetime.now(UTC)
    query = (
        db.collection_group("sessions")
        .where(filter=FieldFilter("media.deleted", "==", False))
        .where(filter=FieldFilter("recordingExpiresAt", "<", now))
        .limit(RETENTION_BATCH)
    )
    removed = 0
    async for snap in query.stream():
        parent = snap.reference.parent.parent
        if parent is None:
            continue
        paths = StoragePaths(parent.id)
        prefix = paths.session_prefix(snap.id)
        store = user_content()
        for name in await store.list(prefix):
            # Recordings go; transcript and evaluation stay until the user deletes the session.
            if "/live/" in name or name.endswith(("audio.m4a", "face-metrics.json")) or "/video-" in name:
                await store.delete_prefix(name)
        await snap.reference.update(
            {"media.deleted": True, "media.audioPath": None, "media.video": None, "media.faceMetrics": None,
             "media.deletedAt": now}
        )
        removed += 1
    log.info("retention finished", extra={"sessions": removed})
    return {"sessions": removed}


class PubSubPush(BaseModel):
    message: dict[str, Any]


@router.post("/events/budget")
async def budget_event(body: PubSubPush, _: worker_caller) -> dict[str, str]:
    try:
        data = json.loads(base64.b64decode(body.message.get("data", "")).decode())
    except (ValueError, json.JSONDecodeError):
        return {"status": "ignored"}
    cost, budget = float(data.get("costAmount", 0)), float(data.get("budgetAmount", 0))
    if budget > 0 and cost >= budget:
        await set_ai_enabled(False, f"budget exceeded: {cost:.0f} of {budget:.0f}")
        log.error("budget exceeded; AI features disabled")
        return {"status": "ai_disabled"}
    return {"status": "ok"}
