"""Hearing a better answer: audio for a moment's improved example, synthesized once and cached."""

from __future__ import annotations

import httpx
from google.cloud import firestore

from app.platform.jobs.processing import enqueue_session_processing
from app.platform.jobs.queue import RecordingQueue
from app.platform.users import CURRENT_CONSENT_VERSION
from tests.integration.conftest import as_user
from tests.integration.test_pipeline import api_client, drain, queue, seed_session  # noqa: F401


async def test_moment_example_is_spoken_once_and_cached(
    db: firestore.AsyncClient, queue: RecordingQueue, api_client: httpx.AsyncClient  # noqa: F811
) -> None:
    uid, sid = "alice", "sess00000011"
    await seed_session(db, uid, sid)
    await enqueue_session_processing(uid, sid, "interview")
    assert await drain(queue) == ["done", "done", "done"]
    session = (await db.document(f"users/{uid}/sessions/{sid}").get()).to_dict() or {}
    events_ref = db.collection(f"users/{uid}/sessions/{sid}/evaluations/{session['currentEvaluationRunId']}/events")
    events = {snap.id: snap.to_dict() or {} async for snap in events_ref.stream()}
    improvement = next(i for i, e in events.items() if e["example"])
    strength = "strength000000000001"
    await events_ref.document(strength).set(
        {**events[improvement], "id": strength, "severity": "strength", "example": ""}
    )
    url = f"/api/v1/sessions/{sid}/moments/{improvement}/example-audio"

    missing_consent = await api_client.post(url, headers=as_user(uid))
    assert missing_consent.json()["code"] == "consent_required"
    await api_client.put("/api/v1/me/consents/ai_processing", headers=as_user(uid),
                         json={"accepted": True, "version": CURRENT_CONSENT_VERSION})

    first = await api_client.post(url, headers=as_user(uid))
    assert first.status_code == 200, first.text
    audio = await api_client.get(first.json()["url"])
    assert audio.status_code == 200 and audio.headers["content-type"] == "audio/wav" and audio.content[:4] == b"RIFF"

    again = await api_client.post(url, headers=as_user(uid))
    assert again.json()["url"].split("?")[0] == first.json()["url"].split("?")[0]
    deep = await api_client.post(f"{url}?voice=deep", headers=as_user(uid))
    assert deep.status_code == 200 and deep.json()["url"] != first.json()["url"]

    no_example = await api_client.post(f"/api/v1/sessions/{sid}/moments/{strength}/example-audio", headers=as_user(uid))
    assert no_example.status_code == 404
    assert (await api_client.post(url, headers=as_user("bob"))).status_code in (403, 404)
    assert (await api_client.post(f"{url}?voice=robot", headers=as_user(uid))).status_code == 422
