"""Camera video: upload session, chunked upload, completion checks, remux and playback links."""

from __future__ import annotations

from collections.abc import AsyncIterator
from pathlib import Path
from urllib.parse import urlsplit

import httpx
import pytest
import pytest_asyncio
from google.cloud import firestore

from app.platform import runtime_config
from app.platform.clients import clients
from app.platform.jobs.queue import RecordingQueue
from app.platform.media.ffmpeg import run_ffmpeg
from app.platform.media.video import REMUX_PATH, remux_video
from app.platform.sessions import new_session_document
from app.platform.users import CURRENT_CONSENT_VERSION
from tests.integration.conftest import as_user

CHUNK = 256 * 1024


@pytest_asyncio.fixture
async def queue(
    db: firestore.AsyncClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> AsyncIterator[RecordingQueue]:
    monkeypatch.setenv("LOCAL_OBJECTS_DIR", str(tmp_path))
    recording = RecordingQueue()
    clients.overrides["task_queue"] = recording
    runtime_config.reset_cache()
    yield recording
    clients.overrides.pop("task_queue", None)


async def seed(api: httpx.AsyncClient, db: firestore.AsyncClient, uid: str, sid: str, status: str = "ended") -> None:
    await db.document(f"users/{uid}").set({"plan": "free"}, merge=True)
    response = await api.put(
        "/api/v1/me/consents/recording",
        json={"accepted": True, "version": CURRENT_CONSENT_VERSION},
        headers=as_user(uid),
    )
    assert response.status_code < 300, response.text
    doc = new_session_document(module="interview", context={}, max_duration_ms=600_000)
    doc["status"] = status
    await db.document(f"users/{uid}/sessions/{sid}").set(doc)


async def sample_mp4(tmp_path: Path) -> bytes:
    out = tmp_path / "sample.mp4"
    await run_ffmpeg(["-f", "lavfi", "-i", "testsrc=size=160x120:rate=10", "-t", "2", "-c:v", "mpeg4", str(out)])
    return out.read_bytes()


def local_path(url: str) -> str:
    parts = urlsplit(url)
    return f"{parts.path}?{parts.query}"


async def put_chunks(api: httpx.AsyncClient, url: str, data: bytes) -> None:
    total, offset = len(data), 0
    while True:
        end = min(offset + CHUNK, total)
        response = await api.put(
            local_path(url), content=data[offset:end], headers={"Content-Range": f"bytes {offset}-{end - 1}/{total}"}
        )
        if response.status_code == 200:
            return
        assert response.status_code == 308, response.text
        offset = int(response.headers["Range"].rsplit("-", 1)[1]) + 1


async def start_upload(api: httpx.AsyncClient, uid: str, sid: str, size: int, started: int = 4_000) -> dict[str, str]:
    response = await api.post(
        f"/api/v1/sessions/{sid}/media/video-upload",
        json={"contentType": "video/mp4", "sizeBytes": size, "startedAtMediaMs": started},
        headers=as_user(uid),
    )
    assert response.status_code == 201, response.text
    return response.json()  # type: ignore[no-any-return]


async def test_video_upload_remux_and_playback(
    api: httpx.AsyncClient, db: firestore.AsyncClient, queue: RecordingQueue, tmp_path: Path
) -> None:
    uid, sid = "alice", "sessvideo0001"
    await seed(api, db, uid, sid)
    video = await sample_mp4(tmp_path)
    data = b"not a video " * (CHUNK // 6)  # more than one chunk, and not playable
    upload = await start_upload(api, uid, sid, len(data))

    complete = f"/api/v1/sessions/{sid}/media/video-complete"
    early = await api.post(complete, json={"uploadId": upload["uploadId"]}, headers=as_user(uid))
    assert early.status_code == 409

    await put_chunks(api, upload["uploadUrl"], data)
    status = await api.put(local_path(upload["uploadUrl"]), headers={"Content-Range": f"bytes */{len(data)}"})
    assert status.status_code == 200

    done = await api.post(complete, json={"uploadId": upload["uploadId"]}, headers=as_user(uid))
    assert done.json() == {"state": "processing"}
    assert [r.path for r in queue.requests] == [REMUX_PATH]
    again = await api.post(complete, json={"uploadId": upload["uploadId"]}, headers=as_user(uid))
    assert again.json() == {"state": "processing"}
    assert len(queue.requests) == 1

    # The first upload isn't a video, so processing fails; a new upload with a real video replaces it.
    assert await remux_video(uid, sid, upload["uploadId"]) == "failed"
    session = (await db.document(f"users/{uid}/sessions/{sid}").get()).to_dict() or {}
    assert session["media"]["video"]["state"] == "failed"

    second = await start_upload(api, uid, sid, len(video))
    await put_chunks(api, second["uploadUrl"], video)
    await api.post(complete, json={"uploadId": second["uploadId"]}, headers=as_user(uid))
    assert await remux_video(uid, sid, second["uploadId"]) == "ready"
    assert await remux_video(uid, sid, second["uploadId"]) == "skipped"

    view = (await api.get(f"/api/v1/sessions/{sid}", headers=as_user(uid))).json()
    assert view["media"]["video"] == {"state": "ready", "startedAtMediaMs": 4_000}
    link = (await api.get(f"/api/v1/sessions/{sid}/media/playback-url?kind=video", headers=as_user(uid))).json()
    assert link["kind"] == "video" and link["startedAtMediaMs"] == 4_000
    played = await api.get(link["url"])
    assert played.status_code == 200 and played.headers["content-type"] == "video/mp4"
    assert b"moov" in played.content[:4096]  # index moved to the front for streaming

    download = await api.get(f"/api/v1/sessions/{sid}/media/download-url?kind=video", headers=as_user(uid))
    assert download.json()["fileName"].endswith("-video.mp4")
    duplicate = await api.post(
        f"/api/v1/sessions/{sid}/media/video-upload",
        json={"contentType": "video/mp4", "sizeBytes": 10, "startedAtMediaMs": 0},
        headers=as_user(uid),
    )
    assert duplicate.status_code == 409


async def test_video_upload_guards(api: httpx.AsyncClient, db: firestore.AsyncClient, queue: RecordingQueue) -> None:
    await seed(api, db, "alice", "sessvideo0002")
    await seed(api, db, "bob", "sessvideo0003", status="created")
    body = {"contentType": "video/mp4", "sizeBytes": 1000, "startedAtMediaMs": 0}

    other = await api.post("/api/v1/sessions/sessvideo0002/media/video-upload", json=body, headers=as_user("bob"))
    assert other.status_code == 404
    not_started = await api.post("/api/v1/sessions/sessvideo0003/media/video-upload", json=body, headers=as_user("bob"))
    assert not_started.status_code == 409
    too_big = await api.post(
        "/api/v1/sessions/sessvideo0002/media/video-upload",
        json={**body, "sizeBytes": 10 * 1024**3},
        headers=as_user("alice"),
    )
    assert too_big.status_code == 413
    wrong_type = await api.post(
        "/api/v1/sessions/sessvideo0002/media/video-upload",
        json={**body, "contentType": "application/pdf"},
        headers=as_user("alice"),
    )
    assert wrong_type.status_code == 422

    await db.document("users/carol").set({"plan": "free"})
    doc = new_session_document(module="interview", context={}, max_duration_ms=600_000)
    doc["status"] = "ended"
    await db.document("users/carol/sessions/sessvideo0004").set(doc)
    no_consent = await api.post(
        "/api/v1/sessions/sessvideo0004/media/video-upload", json=body, headers=as_user("carol")
    )
    assert no_consent.json()["code"] == "consent_required"

    upload = (
        await api.post("/api/v1/sessions/sessvideo0002/media/video-upload", json=body, headers=as_user("alice"))
    ).json()
    tampered = local_path(upload["uploadUrl"]).replace("size=1000", "size=2000")
    rejected = await api.put(tampered, content=b"x" * 10, headers={"Content-Range": "bytes 0-9/2000"})
    assert rejected.status_code == 404
    gap = await api.put(
        local_path(upload["uploadUrl"]), content=b"x" * 10, headers={"Content-Range": "bytes 5-14/1000"}
    )
    assert gap.status_code == 400
    wrong_upload = await api.post(
        "/api/v1/sessions/sessvideo0002/media/video-complete",
        json={"uploadId": "abcdefgh1234"},
        headers=as_user("alice"),
    )
    assert wrong_upload.status_code == 404
