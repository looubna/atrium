"""A face for the round: the server picks the interviewer and keeps the face server's secret."""

from __future__ import annotations

import httpx
import pytest
from google.cloud import firestore

from app.core.settings import get_settings
from app.modules.interview import livetalking
from app.platform.jobs.queue import RecordingQueue
from app.platform.users import CURRENT_CONSENT_VERSION
from tests.integration.conftest import as_user
from tests.integration.test_pipeline import api_client, queue, seed_session  # noqa: F401

pytestmark = pytest.mark.emulator

SECRET = "lt-secret"


def configure(monkeypatch: pytest.MonkeyPatch, *, url: str | None = "https://faces.example/", avatar: str = "") -> None:
    """Settings are rebuilt from the environment per test, so configure the face server there."""
    if url is None:
        monkeypatch.delenv("LIVETALKING_URL", raising=False)
    else:
        monkeypatch.setenv("LIVETALKING_URL", url)
    monkeypatch.setenv("LIVETALKING_SECRET", SECRET)
    monkeypatch.setenv("LIVETALKING_AVATAR", avatar)
    get_settings.cache_clear()


async def start(db: firestore.AsyncClient, client: httpx.AsyncClient, uid: str, sid: str, context: dict) -> None:
    await seed_session(db, uid, sid)
    await db.document(f"users/{uid}/sessions/{sid}").set({"context": context}, merge=True)
    await client.put(
        "/api/v1/me/consents/ai_processing",
        headers=as_user(uid),
        json={"accepted": True, "version": CURRENT_CONSENT_VERSION},
    )


async def test_the_face_is_the_interviewer_for_the_round(
    db: firestore.AsyncClient,
    queue: RecordingQueue,  # noqa: F811
    api_client: httpx.AsyncClient,  # noqa: F811
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    uid, sid = "alice", "sess00000031"
    await start(db, api_client, uid, sid, {"roundType": "behavioral", "mode": "online"})
    url = f"/api/v1/interview/sessions/{sid}/avatar-session"

    # No face server: the interview runs on audio alone.
    configure(monkeypatch, url=None)
    assert (await api_client.post(url, headers=as_user(uid))).status_code == 503

    configure(monkeypatch)
    body = (await api_client.post(url, headers=as_user(uid))).json()
    assert body["name"] == "Evelyn Ross" and body["role"] == "People Business Partner"
    assert body["url"] == "https://faces.example" and body["token"].startswith("evelyn.")
    assert body["panel"] == []
    assert SECRET not in str(body)

    # The token is the one the face server checks: same secret, same recording, not expired.
    avatar, expiry, _ = body["token"].rsplit(".", 2)
    assert body["token"] == livetalking.sign(SECRET, avatar, now=int(expiry) - livetalking.TOKEN_TTL_S)

    # In person is the same person at the same desk.
    await db.document(f"users/{uid}/sessions/{sid}").set({"context": {"mode": "in_person"}}, merge=True)
    assert (await api_client.post(url, headers=as_user(uid))).json()["token"].startswith("evelyn.")

    # A round with no interviewer of its own still gets the default face.
    await db.document(f"users/{uid}/sessions/{sid}").set({"context": {"roundType": "nonsense"}}, merge=True)
    assert (await api_client.post(url, headers=as_user(uid))).json()["name"] == "Mia Fernández"
    get_settings.cache_clear()


async def test_panel_colleagues_get_their_own_faces(
    db: firestore.AsyncClient,
    queue: RecordingQueue,  # noqa: F811
    api_client: httpx.AsyncClient,  # noqa: F811
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    uid, sid = "alice", "sess00000032"
    await start(db, api_client, uid, sid, {"roundType": "behavioral", "mode": "in_person", "panel": "panel"})
    url = f"/api/v1/interview/sessions/{sid}/avatar-session"

    configure(monkeypatch)
    body = (await api_client.post(url, headers=as_user(uid))).json()
    assert [p["name"] for p in body["panel"]] == ["Daniel Brooks", "Grace Lin"]
    faces = [body["token"]] + [p["token"] for p in body["panel"]]
    assert len({token.split(".")[0] for token in faces}) == 3
    assert all(p["url"] == "https://faces.example" for p in body["panel"])

    # One test recording: the lead uses it and the colleagues speak without a face.
    configure(monkeypatch, avatar="wav2lip256_avatar1")
    body = (await api_client.post(url, headers=as_user(uid))).json()
    assert body["token"].startswith("wav2lip256_avatar1.") and body["panel"] == []
    get_settings.cache_clear()


async def test_a_face_needs_the_session_and_the_ai_consent(
    db: firestore.AsyncClient,
    queue: RecordingQueue,  # noqa: F811
    api_client: httpx.AsyncClient,  # noqa: F811
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    uid, sid = "alice", "sess00000033"
    configure(monkeypatch)
    await seed_session(db, uid, sid)
    url = f"/api/v1/interview/sessions/{sid}/avatar-session"

    # Without the AI consent there is no face.
    assert (await api_client.post(url, headers=as_user(uid))).status_code == 403
    await api_client.put(
        "/api/v1/me/consents/ai_processing",
        headers=as_user(uid),
        json={"accepted": True, "version": CURRENT_CONSENT_VERSION},
    )
    assert (await api_client.post(url, headers=as_user(uid))).status_code == 200

    # Somebody else's session is not found.
    assert (await api_client.post(url, headers=as_user("mallory"))).status_code in (403, 404)
    get_settings.cache_clear()
