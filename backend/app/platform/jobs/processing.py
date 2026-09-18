"""Starting post-session processing.

One job per session (`jobs/sess-{sessionId}`); each processing run gets its own
run ID so re-processing never collides with earlier task names. Creating the job
and enqueueing its first task are both idempotent.
"""

from __future__ import annotations

import logging
from typing import Any

from google.api_core.exceptions import AlreadyExists
from google.cloud import firestore

from app.platform.clients import clients
from app.platform.firestore.paths import job_path, new_id
from app.platform.jobs.queue import TaskRequest, task_name, task_queue

log = logging.getLogger(__name__)

PROCESSING_QUEUE = "processing"
FIRST_STEP = "prepare_submit_stt"


def session_job_id(session_id: str) -> str:
    return f"sess-{session_id}"


async def enqueue_session_processing(uid: str, session_id: str, module: str) -> str:
    """Create the job (if absent) and enqueue its first step. Returns the job ID."""
    job_id = session_job_id(session_id)
    ref = clients.firestore().document(job_path(job_id))
    run_id = new_id()
    doc: dict[str, Any] = {
        "uid": uid,
        "sessionId": session_id,
        "module": module,
        "kind": "session_processing",
        "runId": run_id,
        "step": FIRST_STEP,
        "attempt": 1,
        "failures": 0,
        "status": "queued",
        "createdAt": firestore.SERVER_TIMESTAMP,
        "updatedAt": firestore.SERVER_TIMESTAMP,
    }
    try:
        await ref.create(doc)
    except AlreadyExists:
        snap = await ref.get()
        existing = snap.to_dict() or {}
        run_id = str(existing.get("runId", run_id))
        log.info("processing job already exists", extra={"jobId": job_id})

    await task_queue().enqueue(
        TaskRequest(
            queue=PROCESSING_QUEUE,
            path=f"/internal/tasks/{FIRST_STEP}",
            payload={"jobId": job_id, "runId": run_id, "attempt": 1},
            name=task_name(job_id, run_id, FIRST_STEP, "1"),
        )
    )
    return job_id
