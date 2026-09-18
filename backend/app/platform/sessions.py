"""Generic practice sessions, shared by every module.

A session is one attempt at one practice unit (for the interview module: one
round). The platform owns lifecycle, media and processing state; module data
lives under `context`.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from enum import StrEnum
from typing import Any

from google.cloud import firestore

from app.core.errors import NotFound
from app.core.settings import get_settings
from app.platform.clients import clients
from app.platform.firestore.paths import UserPaths


class SessionStatus(StrEnum):
    CREATED = "created"
    LIVE = "live"
    ENDED = "ended"
    ABANDONED = "abandoned"


class ProcessingStatus(StrEnum):
    NONE = "none"
    QUEUED = "queued"
    PROCESSING = "processing"
    TRANSCRIBING = "transcribing"
    ANALYZING = "analyzing"
    COMPLETED = "completed"
    FAILED = "failed"


class EndReason(StrEnum):
    CANDIDATE_ENDED = "candidate_ended"
    INTERVIEWER_ENDED = "interviewer_ended"
    TIME_LIMIT = "time_limit"
    QUOTA_EXHAUSTED = "quota_exhausted"
    IDLE_TIMEOUT = "idle_timeout"
    DISCONNECTED = "disconnected"


def new_session_document(
    *, module: str, context: dict[str, Any], max_duration_ms: int, attempt_no: int = 1,
    retry_of: str | None = None, retry_targets: dict[str, Any] | None = None,
) -> dict[str, Any]:
    now = datetime.now(UTC)
    return {
        "module": module,
        "context": context,
        "status": SessionStatus.CREATED.value,
        "processingStatus": ProcessingStatus.NONE.value,
        "attemptNo": attempt_no,
        "retryOfSessionId": retry_of,
        "retryTargets": retry_targets,
        "maxDurationMs": max_duration_ms,
        "media": {"durationMs": 0, "audioPath": None, "video": None, "deleted": False},
        "currentEvaluationRunId": None,
        "summary": None,
        "createdAt": firestore.SERVER_TIMESTAMP,
        "recordingExpiresAt": now + timedelta(days=get_settings().recording_retention_days),
    }


async def get_session(uid: str, session_id: str) -> dict[str, Any]:
    snap = await clients.firestore().document(UserPaths(uid).session(session_id)).get()
    if not snap.exists:
        raise NotFound()
    return snap.to_dict() or {}


async def mark_live(uid: str, session_id: str) -> None:
    ref = clients.firestore().document(UserPaths(uid).session(session_id))

    @firestore.async_transactional
    async def txn(transaction: firestore.AsyncTransaction) -> None:
        snap = await ref.get(transaction=transaction)
        data = snap.to_dict() or {}
        if data.get("status") == SessionStatus.CREATED.value:
            transaction.update(ref, {"status": SessionStatus.LIVE.value, "liveStartedAt": firestore.SERVER_TIMESTAMP})

    await txn(clients.firestore().transaction())


async def mark_ended(uid: str, session_id: str, reason: EndReason, media_duration_ms: int) -> bool:
    """Idempotent: returns True only for the call that actually ended the session."""
    ref = clients.firestore().document(UserPaths(uid).session(session_id))

    @firestore.async_transactional
    async def txn(transaction: firestore.AsyncTransaction) -> bool:
        snap = await ref.get(transaction=transaction)
        data = snap.to_dict() or {}
        if data.get("status") not in (SessionStatus.CREATED.value, SessionStatus.LIVE.value):
            return False
        transaction.update(
            ref,
            {
                "status": SessionStatus.ENDED.value,
                "endReason": reason.value,
                "endedAt": firestore.SERVER_TIMESTAMP,
                "media.durationMs": media_duration_ms,
                "processingStatus": ProcessingStatus.QUEUED.value,
            },
        )
        return True

    return await txn(clients.firestore().transaction())
