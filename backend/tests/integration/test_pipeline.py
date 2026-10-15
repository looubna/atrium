"""Processing pipeline end to end with fake speech and evaluation, on the Firestore emulator."""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx
import pytest
import pytest_asyncio
from google.cloud import firestore

from app.platform import runtime_config
from app.platform.clients import clients
from app.platform.jobs.pipeline import POLL, PREPARE, execute_step
from app.platform.jobs.processing import enqueue_session_processing
from app.platform.jobs.queue import RecordingQueue
from app.platform.media.tracks import TrackWriter
from app.platform.sessions import new_session_document
from app.platform.storage.objects import user_content
from app.platform.storage.paths import StoragePaths, Track
from app.platform.users import CURRENT_CONSENT_VERSION
from tests.integration.conftest import as_user

CONTEXT = {"practice": "general_behavioral", "roundType": "behavioral", "durationMinutes": 10}


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


def tone(samples: int, value: int = 1200) -> bytes:
    return value.to_bytes(2, "little", signed=True) * samples


async def seed_session(
    db: firestore.AsyncClient, uid: str, sid: str, *, with_audio: bool = True, mode: str = "online"
) -> None:
    await db.document(f"users/{uid}").set({"plan": "free"}, merge=True)
    doc = new_session_document(module="interview", context={**CONTEXT, "mode": mode}, max_duration_ms=10 * 60_000)
    doc.update({"status": "ended", "createdAt": datetime.now(UTC)})
    await db.document(f"users/{uid}/sessions/{sid}").set(doc)
    paths = StoragePaths(uid)
    if with_audio:
        candidate = TrackWriter(user_content(), paths, sid, Track.CANDIDATE)
        for i in range(30):
            candidate.append(i, 1000 + i * 100, tone(1600))
        await candidate.flush()
        interviewer = TrackWriter(user_content(), paths, sid, Track.INTERVIEWER)
        interviewer.append(1, 0, tone(12_000, 800))
        await interviewer.flush()
    turns = db.collection(f"users/{uid}/sessions/{sid}/turns")
    await turns.document("000001").set({"seq": 1, "speaker": "interviewer", "interviewerTurnSeq": 1,
                                        "text": "Tell me about a project you led.", "tStartMs": 0, "tEndMs": 500})
    await turns.document("000002").set({"seq": 2, "speaker": "candidate", "tStartMs": 1000, "tEndMs": 4000,
                                        "text": "I led the payments migration and we cut costs by thirty percent"})


async def drain(queue: RecordingQueue) -> list[str]:
    results = []
    while queue.requests:
        request = queue.requests.pop(0)
        step = request.path.rsplit("/", 1)[-1]
        results.append(await execute_step(step, str(request.payload["jobId"]), str(request.payload["runId"])))
    return results


@pytest_asyncio.fixture
async def api_client(api: httpx.AsyncClient) -> httpx.AsyncClient:
    return api


async def test_full_pipeline_produces_feedback_profile_and_retry_plan(
    db: firestore.AsyncClient, queue: RecordingQueue, api_client: httpx.AsyncClient
) -> None:
    uid, sid = "alice", "sess00000001"
    await seed_session(db, uid, sid)
    job_id = await enqueue_session_processing(uid, sid, "interview")
    first_task = queue.requests[0]
    assert await drain(queue) == ["done", "done", "done"]

    session = (await db.document(f"users/{uid}/sessions/{sid}").get()).to_dict() or {}
    assert session["processingStatus"] == "completed"
    run_id = session["currentEvaluationRunId"]
    assert session["summary"]["overallScore"] == 64
    assert session["summary"]["eventCount"] >= 1
    assert session["retryPlan"]["competencyNames"]
    assert session["media"]["audioPath"].endswith("audio.m4a")
    # Every score explains itself; delivery scores carry the measured value and target.
    scores = {s["competencyId"]: s for s in session["summary"]["scores"]}
    assert scores["comm.structure"]["meaning"] and scores["comm.structure"]["toReach100"]
    assert scores["comm.pace"]["metric"]["unit"] == "words/min"
    assert {"comm.intonation", "comm.articulation", "comm.projection"} <= set(scores)
    assert "comm.eye_contact" not in scores  # no camera, no body-language scores

    events_ref = db.collection(f"users/{uid}/sessions/{sid}/evaluations/{run_id}/events")
    events = [s.to_dict() or {} async for s in events_ref.stream()]
    duration = session["media"]["durationMs"]
    assert events and all(0 <= e["timestampStart"] < e["timestampEnd"] <= duration for e in events)
    history = [s async for s in db.collection(f"users/{uid}/competencyHistory").stream()]
    assert len(history) == len(session["summary"]["scores"])
    profile = (await db.document(f"users/{uid}/competencies/comm.structure").get()).to_dict() or {}
    assert profile["attempts"] == 1 and profile["current"] == 66

    store = user_content()
    assert await store.exists(StoragePaths(uid).session_audio(sid))
    assert await store.exists(StoragePaths(uid).transcript(sid))
    job = (await db.document(f"jobs/{job_id}").get()).to_dict() or {}
    assert job["status"] == "completed"

    # A duplicate delivery of an already-finished step does nothing.
    assert await execute_step(PREPARE, str(first_task.payload["jobId"]), str(first_task.payload["runId"])) == "skipped"

    feedback = await api_client.get(f"/api/v1/sessions/{sid}/feedback", headers=as_user(uid))
    assert feedback.status_code == 200
    assert len(feedback.json()["events"]) == len(events)
    assert (await api_client.get(f"/api/v1/sessions/{sid}/feedback", headers=as_user("bob"))).status_code == 404

    playback = (await api_client.get(f"/api/v1/sessions/{sid}/media/playback-url", headers=as_user(uid))).json()
    audio = await api_client.get(playback["url"])
    assert audio.status_code == 200 and audio.headers["content-type"] == "audio/mp4" and len(audio.content) > 100
    tampered = playback["url"].replace(sid, "sess00000002")
    assert (await api_client.get(tampered)).status_code == 404
    download = (await api_client.get(f"/api/v1/sessions/{sid}/media/download-url", headers=as_user(uid))).json()
    assert "attachment" in (await api_client.get(download["url"])).headers["content-disposition"]


async def test_face_measurements_add_body_language_scores(
    db: firestore.AsyncClient, queue: RecordingQueue, api_client: httpx.AsyncClient
) -> None:
    uid, sid = "alice", "sess00000005"
    await seed_session(db, uid, sid)
    consent = await api_client.put("/api/v1/me/consents/recording", headers=as_user(uid),
                                   json={"accepted": True, "version": CURRENT_CONSENT_VERSION})
    assert consent.status_code < 300
    # Exactly what the app's FaceTracker sends, brightness share included.
    timeline = [{"t": t, "present": 1.0, "eye": 0.3, "clear": 1.0, "smile": 0.5, "move": 0.0} for t in range(60)]
    url = f"/api/v1/sessions/{sid}/media/face-metrics"
    invalid = await api_client.put(url, headers=as_user(uid), json={"seconds": [{**timeline[0], "eye": 2}]})
    assert invalid.status_code == 422
    assert (await api_client.put(url, headers=as_user("bob"), json={"seconds": timeline})).status_code in (403, 404)
    assert (await api_client.put(url, headers=as_user(uid), json={"seconds": timeline})).status_code == 204

    await enqueue_session_processing(uid, sid, "interview")
    assert await drain(queue) == ["done", "done", "done"]
    session = (await db.document(f"users/{uid}/sessions/{sid}").get()).to_dict() or {}
    scores = {s["competencyId"]: s for s in session["summary"]["scores"]}
    eye = scores["comm.eye_contact"]["metric"]
    assert eye["value"] == 30 and eye["verdict"] == "Often looks away"
    assert {"comm.facial_expression", "comm.composure"} <= set(scores)


async def test_body_numbers_add_findings_without_changing_the_scores(
    db: firestore.AsyncClient, queue: RecordingQueue, api_client: httpx.AsyncClient
) -> None:
    """Version 3 face metrics: a stored body-language report and history entry, and the same scores as before."""
    await api_client.put("/api/v1/me/consents/recording", headers=as_user("alice"),
                         json={"accepted": True, "version": CURRENT_CONSENT_VERSION})
    plain = [{"t": t, "present": 1.0, "eye": 0.3, "smile": 0.5, "move": 0.0} for t in range(60)]
    body = {"body": 1.0, "hands": 1.0, "full": 0.0, "clear": 1.0, "yaw": 0.0, "pitch": 0.0, "shoulderW": 0.5,
            "faceW": 0.25, "neck": 0.8, "handPath": 0.0, "sx": [0.9] * 4, "lw": [[0.3, 1.0]] * 4,
            "rw": [[-0.3, 1.0]] * 4}
    rich = [{**second, **body, "tilt": 12.0 if 40 <= second["t"] < 55 else 0.0} for second in plain]

    summaries = []
    for sid, timeline in (("sess00000011", plain), ("sess00000012", rich)):
        await seed_session(db, "alice", sid)
        put = await api_client.put(f"/api/v1/sessions/{sid}/media/face-metrics", headers=as_user("alice"),
                                   json={"seconds": timeline, "poseHz": 4})
        assert put.status_code == 204
        await enqueue_session_processing("alice", sid, "interview")
        assert await drain(queue) == ["done", "done", "done"]
        session = (await db.document(f"users/alice/sessions/{sid}").get()).to_dict() or {}
        summaries.append(session)

    plain_session, rich_session = summaries
    assert [s["score"] for s in plain_session["summary"]["scores"]] == [
        s["score"] for s in rich_session["summary"]["scores"]
    ]
    # An older-style timeline still gets a report: the body checks say why they could not run.
    assert plain_session["bodyLanguage"]["findingCount"] == 0
    assert rich_session["bodyLanguage"]["findingCount"] == 1
    assert rich_session["bodyLanguage"]["framing"] == "upper_body"

    report = json.loads(await user_content().read(StoragePaths("alice").body_language("sess00000012")))
    assert [f["check"] for f in report["findings"]] == ["posture_tilt"]
    assert report["quality"]["poseHz"] == 4
    history = (await db.document("users/alice/bodyHistory/sess00000012").get()).to_dict() or {}
    assert history["module"] == "interview" and history["findingCount"] == 1


async def test_with_the_video_consent_the_ai_reviews_each_flagged_moment(
    db: firestore.AsyncClient, queue: RecordingQueue, api_client: httpx.AsyncClient
) -> None:
    uid, sid = "carol", "sess00000013"
    for kind in ("recording", "video_analysis"):
        await api_client.put(f"/api/v1/me/consents/{kind}", headers=as_user(uid),
                             json={"accepted": True, "version": CURRENT_CONSENT_VERSION})
    await seed_session(db, uid, sid)
    await db.document(f"users/{uid}/sessions/{sid}").update({"media.video": {
        "state": "ready", "path": f"{StoragePaths(uid).session_prefix(sid)}video-1.mp4",
        "contentType": "video/mp4", "startedAtMediaMs": 0,
    }})
    body = {"body": 1.0, "hands": 1.0, "full": 0.0, "clear": 1.0, "yaw": 0.0, "pitch": 0.0, "shoulderW": 0.5,
            "faceW": 0.25, "neck": 0.8, "handPath": 0.0, "sx": [0.9] * 4, "lw": [[0.3, 1.0]] * 4,
            "rw": [[-0.3, 1.0]] * 4}
    timeline = [{"t": t, "present": 1.0, "eye": 0.9, "smile": 0.2, "move": 0.0, **body,
                 "tilt": 12.0 if 40 <= t < 55 else 0.0} for t in range(60)]
    put = await api_client.put(f"/api/v1/sessions/{sid}/media/face-metrics", headers=as_user(uid),
                               json={"seconds": timeline, "poseHz": 4})
    assert put.status_code == 204
    await enqueue_session_processing(uid, sid, "interview")
    assert await drain(queue) == ["done", "done", "done"]

    report = json.loads(await user_content().read(StoragePaths(uid).body_language(sid)))
    (tilt,) = report["findings"]
    assert tilt["review"]["verdict"] == "confirmed" and tilt["review"]["howToFix"]


async def test_second_attempt_records_improvement_delta(db: firestore.AsyncClient, queue: RecordingQueue) -> None:
    for sid in ("sess00000001", "sess00000002"):
        await seed_session(db, "alice", sid)
        await enqueue_session_processing("alice", sid, "interview")
        assert await drain(queue) == ["done", "done", "done"]
    second = (await db.document("users/alice/sessions/sess00000002").get()).to_dict() or {}
    deltas = {d["competencyId"]: d for d in second["summary"]["deltas"]}
    assert deltas["comm.structure"] == {"competencyId": "comm.structure", "score": 66, "previous": 66, "delta": 0}
    profile = (await db.document("users/alice/competencies/comm.structure").get()).to_dict() or {}
    assert profile["attempts"] == 2


async def test_session_without_audio_fails_permanently(db: firestore.AsyncClient, queue: RecordingQueue) -> None:
    await seed_session(db, "alice", "sess00000003", with_audio=False)
    await enqueue_session_processing("alice", "sess00000003", "interview")
    assert await drain(queue) == ["failed"]
    session = (await db.document("users/alice/sessions/sess00000003").get()).to_dict() or {}
    assert session["processingStatus"] == "failed"
    assert session["failure"] == {"step": PREPARE, "retryable": False}


async def test_reprocess_starts_a_new_run_and_old_tasks_are_ignored(
    db: firestore.AsyncClient, queue: RecordingQueue, api_client: httpx.AsyncClient
) -> None:
    await seed_session(db, "alice", "sess00000004")
    job_id = await enqueue_session_processing("alice", "sess00000004", "interview")
    await drain(queue)
    old_run = ((await db.document(f"jobs/{job_id}").get()).to_dict() or {})["runId"]

    response = await api_client.post("/api/v1/sessions/sess00000004/reprocess", headers=as_user("alice"))
    assert response.status_code == 202
    job: dict[str, Any] = (await db.document(f"jobs/{job_id}").get()).to_dict() or {}
    assert job["runId"] != old_run and job["step"] == PREPARE
    assert await execute_step(POLL, job_id, old_run) == "skipped"
    assert await drain(queue) == ["done", "done", "done"]
    session = (await db.document("users/alice/sessions/sess00000004").get()).to_dict() or {}
    assert session["currentEvaluationRunId"] == job["runId"]


async def test_in_person_presence_is_measured_against_the_interviewers(
    db: firestore.AsyncClient, queue: RecordingQueue, api_client: httpx.AsyncClient
) -> None:
    uid, sid = "alice", "sess00000006"
    await seed_session(db, uid, sid, mode="in_person")
    await api_client.put("/api/v1/me/consents/recording", headers=as_user(uid),
                         json={"accepted": True, "version": CURRENT_CONSENT_VERSION})
    timeline = [{"t": t, "present": 1.0, "eye": 0.8, "smile": 0.2, "move": 0.0, "toSpeaker": 0.5}
                for t in range(60)]
    url = f"/api/v1/sessions/{sid}/media/face-metrics"
    bad = await api_client.put(url, headers=as_user(uid), json={"seconds": [{**timeline[0], "toSpeaker": 1.5}]})
    assert bad.status_code == 422
    assert (await api_client.put(url, headers=as_user(uid), json={"seconds": timeline})).status_code == 204

    await enqueue_session_processing(uid, sid, "interview")
    assert await drain(queue) == ["done", "done", "done"]
    session = (await db.document(f"users/{uid}/sessions/{sid}").get()).to_dict() or {}
    eye = {s["competencyId"]: s for s in session["summary"]["scores"]}["comm.eye_contact"]["metric"]
    assert eye["label"] == "Looking at the interviewers" and eye["value"] == 80
    assert "turned toward whoever was asking 50%" in eye["details"]
