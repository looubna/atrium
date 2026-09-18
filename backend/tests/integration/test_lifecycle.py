"""Account deletion, recording retention, reconciliation and progress endpoints, on the emulator."""

from __future__ import annotations

import time
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx
import pytest
import pytest_asyncio
from google.cloud import firestore

from app.platform import runtime_config
from app.platform.auth import dependencies as deps
from app.platform.auth.dependencies import AuthUser
from app.platform.clients import clients
from app.platform.deletion import run_deletion
from app.platform.firestore.paths import deletion_path, uid_hash
from app.platform.jobs import worker_api
from app.platform.jobs.queue import RecordingQueue
from app.platform.sessions import new_session_document
from app.platform.storage.objects import processing, user_content
from tests.integration.conftest import as_user


@dataclass
class FakeAuthAdmin:
    calls: list[tuple[str, str]] = field(default_factory=list)

    async def disable_and_revoke(self, uid: str) -> None:
        self.calls.append(("disable", uid))

    async def delete_user(self, uid: str) -> None:
        self.calls.append(("delete", uid))


@pytest_asyncio.fixture
async def env(
    db: firestore.AsyncClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> AsyncIterator[tuple[RecordingQueue, FakeAuthAdmin]]:
    monkeypatch.setenv("LOCAL_OBJECTS_DIR", str(tmp_path))
    queue, admin = RecordingQueue(), FakeAuthAdmin()
    clients.overrides.update({"task_queue": queue, "auth_admin": admin})
    runtime_config.reset_cache()
    yield queue, admin
    clients.overrides.pop("task_queue", None)
    clients.overrides.pop("auth_admin", None)


def session_id_for(uid: str) -> str:
    return f"sess{uid}00001"


async def seed_user(db: firestore.AsyncClient, uid: str) -> None:
    sid = session_id_for(uid)
    await db.document(f"users/{uid}").set({"plan": "free"})
    await db.document(f"users/{uid}/applications/app00001").set({"company": "Acme"})
    await db.document(f"users/{uid}/applications/app00001/blueprints/bp000001").set({"status": "ready"})
    await db.document(f"users/{uid}/sessions/{sid}").set({"status": "ended"})
    await db.document(f"users/{uid}/sessions/{sid}/turns/000001").set({"text": "hi"})
    await db.document(f"users/{uid}/competencies/comm.clarity").set({"current": 70, "layer": "communication"})
    await db.document(f"jobs/sess-{sid}").set({"uid": uid, "status": "completed"})
    await db.document(f"liveSessions/{sid}").set({"uid": uid})
    await db.document(f"liveLocks/{uid}").set({"sessionId": sid})
    await user_content().write(f"users/{uid}/sessions/{sid}/audio.m4a", b"audio", "audio/mp4")
    await user_content().write(f"users/{uid}/resumes/res00001/original.pdf", b"%PDF", "application/pdf")
    await processing().write(f"jobs/sess-{sid}/run/chunk-000.flac", b"flac", "audio/flac")


async def test_account_deletion_removes_everything_and_blocks_recreation(
    api: httpx.AsyncClient, db: firestore.AsyncClient, env: tuple[RecordingQueue, FakeAuthAdmin],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    queue, admin = env
    await seed_user(db, "alice")
    await seed_user(db, "bob")

    async def stale_login(authorization: str | None = None) -> AuthUser:
        return AuthUser(uid="alice", email_verified=True, sign_in_provider="apple.com", auth_time=0)

    api_app = api._transport.app  # type: ignore[attr-defined]
    api_app.dependency_overrides[deps._current_user_strict] = stale_login
    stale = await api.delete("/api/v1/me", headers=as_user("alice"))
    assert stale.status_code == 401 and stale.json()["code"] == "recent_login_required"

    async def fresh_login(authorization: str | None = None) -> AuthUser:
        return AuthUser(uid="alice", email_verified=True, sign_in_provider="apple.com", auth_time=int(time.time()))

    api_app.dependency_overrides[deps._current_user_strict] = fresh_login
    accepted = await api.delete("/api/v1/me", headers=as_user("alice"))
    assert accepted.status_code == 202
    assert (await api.get("/api/v1/me", headers=as_user("alice"))).json()["code"] == "account_deleting"

    [task] = queue.requests
    assert task.path == "/internal/account-deletion"
    await run_deletion(task.payload)

    assert admin.calls == [("disable", "alice"), ("delete", "alice")]
    assert not (await db.document("users/alice").get()).exists
    assert [d async for d in db.collection("users/alice/sessions").stream()] == []
    assert [d async for d in db.collection("users/alice/applications").stream()] == []
    alice_sid, bob_sid = session_id_for("alice"), session_id_for("bob")
    assert not (await db.document(f"jobs/sess-{alice_sid}").get()).exists
    assert not (await db.document(f"liveSessions/{alice_sid}").get()).exists
    assert not (await db.document("liveLocks/alice").get()).exists
    assert await user_content().list("users/alice/") == []
    assert await processing().list(f"jobs/sess-{alice_sid}/") == []
    # Other users are untouched.
    assert (await db.document("users/bob").get()).exists
    assert (await db.document(f"jobs/sess-{bob_sid}").get()).exists
    assert await user_content().list("users/bob/")
    assert await processing().list(f"jobs/sess-{bob_sid}/")

    tombstone = (await db.document(deletion_path(uid_hash("alice", ""))).get()).to_dict() or {}
    assert tombstone["status"] == "completed" and "alice" not in str(tombstone)
    sweeps = [r for r in queue.requests if r.payload.get("pass")]
    assert [r.delay_seconds for r in sweeps] == [30 * 60, 65 * 60]

    # A token issued before deletion can't bring the profile back.
    again = await api.get("/api/v1/me", headers=as_user("alice"))
    assert again.status_code == 403 and again.json()["code"] == "account_deleting"
    assert not (await db.document("users/alice").get()).exists

    # Late writes are removed by a sweep.
    await db.document("users/alice/sessions/late0001").set({"status": "created"})
    await run_deletion(sweeps[0].payload)
    assert [d async for d in db.collection("users/alice/sessions").stream()] == []


async def test_retention_deletes_recordings_but_keeps_feedback(
    db: firestore.AsyncClient, env: tuple[RecordingQueue, FakeAuthAdmin]
) -> None:
    for sid, expires in (("sess00000001", datetime.now(UTC) - timedelta(days=1)),
                         ("sess00000002", datetime.now(UTC) + timedelta(days=30))):
        doc = new_session_document(module="interview", context={}, max_duration_ms=60_000)
        doc["recordingExpiresAt"] = expires
        doc["media"]["audioPath"] = f"users/alice/sessions/{sid}/audio.m4a"
        await db.document(f"users/alice/sessions/{sid}").set(doc)
        for name in ("audio.m4a", "live/cand-0000.trk", "transcript.json"):
            await user_content().write(f"users/alice/sessions/{sid}/{name}", b"x", "application/octet-stream")

    assert await worker_api.retention("test") == {"sessions": 1}
    assert await user_content().list("users/alice/sessions/sess00000001/") == [
        "users/alice/sessions/sess00000001/transcript.json"
    ]
    assert len(await user_content().list("users/alice/sessions/sess00000002/")) == 3
    expired = (await db.document("users/alice/sessions/sess00000001").get()).to_dict() or {}
    assert expired["media"]["deleted"] is True and expired["media"]["audioPath"] is None


async def test_reconcile_ends_abandoned_live_sessions_and_revives_stuck_jobs(
    db: firestore.AsyncClient, env: tuple[RecordingQueue, FakeAuthAdmin]
) -> None:
    queue, _ = env
    old = datetime.now(UTC) - timedelta(hours=1)
    doc = new_session_document(module="interview", context={}, max_duration_ms=60_000)
    doc["status"] = "live"
    await db.document("users/alice/sessions/sess00000001").set(doc)
    await db.document("liveSessions/sess00000001").set({"uid": "alice", "updatedAt": old, "mediaMs": 42_000})
    live_doc = {**doc}
    await db.document("users/alice/sessions/sess00000002").set(live_doc)
    await db.document("liveSessions/sess00000002").set({"uid": "alice", "updatedAt": datetime.now(UTC)})
    await db.document("jobs/sess-stuck0001").set(
        {"uid": "alice", "sessionId": "stuck0001", "runId": "run00001", "step": "poll_stt", "status": "retrying",
         "updatedAt": old}
    )

    result = await worker_api.reconcile("test")
    assert result == {"endedSessions": 1, "revivedJobs": 1}
    ended = (await db.document("users/alice/sessions/sess00000001").get()).to_dict() or {}
    assert ended["status"] == "ended" and ended["endReason"] == "disconnected"
    assert ended["media"]["durationMs"] == 42_000
    assert ((await db.document("users/alice/sessions/sess00000002").get()).to_dict() or {})["status"] == "live"
    paths = sorted(r.path for r in queue.requests)
    assert paths == ["/internal/tasks/poll_stt", "/internal/tasks/prepare_submit_stt"]


async def test_competency_progress_endpoints(api: httpx.AsyncClient, db: firestore.AsyncClient) -> None:
    await db.document("users/alice/competencies/comm.clarity").set(
        {"layer": "communication", "module": "interview", "current": 72, "best": 80, "attempts": 2,
         "lastScore": 79, "lastDelta": 18}
    )
    await db.document("users/alice/competencies/interview.behavioral.answer_structure").set(
        {"layer": "round", "module": "interview", "current": 61, "attempts": 1}
    )
    for i, score in enumerate((61, 79)):
        await db.document(f"users/alice/competencyHistory/s{i}_comm.clarity").set(
            {"competencyId": "comm.clarity", "score": score, "confidence": "high", "sessionId": f"s{i}",
             "at": datetime(2026, 9, 10 + i, tzinfo=UTC)}
        )
    listed = (await api.get("/api/v1/competencies", headers=as_user("alice"))).json()
    assert [(c["id"], c["name"]) for c in listed] == [
        ("comm.clarity", "Clarity"), ("interview.behavioral.answer_structure", "Answer structure")
    ]
    history = (await api.get("/api/v1/competencies/comm.clarity/history", headers=as_user("alice"))).json()
    assert [h["score"] for h in history] == [79, 61]
    assert (await api.get("/api/v1/competencies/comm.clarity/history", headers=as_user("bob"))).status_code == 404
    assert (await api.get("/api/v1/competencies/../../x/history", headers=as_user("alice"))).status_code == 404
