"""Resumes, applications, blueprint generation and editing, on the Firestore emulator with fake AI."""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import httpx
import pytest
import pytest_asyncio
from google.cloud import firestore

from app.modules.interview.agents.live_interviewer import InterviewLiveAgentFactory
from app.platform import runtime_config
from app.platform.clients import clients
from app.platform.jobs.module_tasks import run_module_task
from app.platform.jobs.pipeline import execute_step
from app.platform.jobs.queue import RecordingQueue
from app.platform.users import CURRENT_CONSENT_VERSION
from tests.integration.conftest import as_user

RESUME = "\n".join(
    ["Jane Doe - Senior Backend Engineer"]
    + [f"Led the payments platform project {i} and cut latency by 40% for 2M users." for i in range(10)]
)


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


async def drain(queue: RecordingQueue) -> None:
    while queue.requests:
        request = queue.requests.pop(0)
        parts = request.path.strip("/").split("/")
        if parts[1] == "modules":
            await run_module_task(parts[2], parts[4], request.payload)
        else:
            await execute_step(parts[-1], str(request.payload["jobId"]), str(request.payload["runId"]))


async def consent(db: firestore.AsyncClient, uid: str, *kinds: str) -> None:
    for kind in kinds or ("ai_processing", "recording"):
        await db.document(f"users/{uid}/consents/{kind}").set({"accepted": True, "version": CURRENT_CONSENT_VERSION})


async def upload(
    api: httpx.AsyncClient, uid: str, name: str, data: bytes, content_type: str = "text/plain"
) -> httpx.Response:
    return await api.post("/api/v1/interview/resumes", headers=as_user(uid), files={"file": (name, data, content_type)})


async def test_resume_upload_and_extraction(
    api: httpx.AsyncClient, db: firestore.AsyncClient, queue: RecordingQueue
) -> None:
    denied = await upload(api, "alice", "cv.txt", RESUME.encode())
    assert denied.status_code == 403 and denied.json()["code"] == "consent_required"

    await consent(db, "alice", "ai_processing")
    created = await upload(api, "alice", "cv.txt", RESUME.encode())
    assert created.status_code == 201 and created.json()["status"] == "processing"
    resume_id = created.json()["id"]
    await drain(queue)

    listed = (await api.get("/api/v1/interview/resumes", headers=as_user("alice"))).json()
    assert listed[0]["id"] == resume_id and listed[0]["status"] == "ready"
    assert listed[0]["currentTitle"].startswith("Jane Doe")
    assert (await api.get("/api/v1/interview/resumes", headers=as_user("bob"))).json() == []

    assert (await upload(api, "alice", "cv.docx", b"MZ\x90\x00" + b"\x00" * 100)).status_code == 415
    assert (await upload(api, "alice", "big.txt", b"a" * (10 * 1024 * 1024 + 70_000))).status_code == 413

    assert (await api.delete(f"/api/v1/interview/resumes/{resume_id}", headers=as_user("bob"))).status_code == 404
    assert (await api.delete(f"/api/v1/interview/resumes/{resume_id}", headers=as_user("alice"))).status_code == 204


async def test_application_blueprint_generation_edit_and_session(
    api: httpx.AsyncClient, db: firestore.AsyncClient, queue: RecordingQueue
) -> None:
    await consent(db, "alice")
    resume_id = (await upload(api, "alice", "cv.md", RESUME.encode())).json()["id"]
    await drain(queue)

    body: dict[str, Any] = {"id": str(uuid.uuid4()), "company": "Acme Payments", "roleTitle": "Senior Backend Engineer",
                            "location": "Berlin", "jobDescription": "Build payment APIs.", "resumeId": resume_id}
    created = await api.post("/api/v1/interview/applications", headers=as_user("alice"), json=body)
    assert created.status_code == 201
    app_id = created.json()["id"]
    again = await api.post("/api/v1/interview/applications", headers=as_user("alice"), json=body)
    assert again.json()["id"] == app_id

    foreign = {**body, "id": str(uuid.uuid4())}
    assert (await api.post("/api/v1/interview/applications", headers=as_user("bob"), json=foreign)).status_code == 404

    started = await api.post(f"/api/v1/interview/applications/{app_id}/blueprints:generate", headers=as_user("alice"))
    assert started.status_code == 202
    blueprint_id = started.json()["blueprintId"]
    busy = await api.post(f"/api/v1/interview/applications/{app_id}/blueprints:generate", headers=as_user("alice"))
    assert busy.status_code == 409
    await drain(queue)

    url = f"/api/v1/interview/applications/{app_id}/blueprints/{blueprint_id}"
    blueprint = (await api.get(url, headers=as_user("alice"))).json()
    assert blueprint["status"] == "ready" and blueprint["version"] == 1
    rounds = blueprint["rounds"]
    assert [r["type"] for r in rounds] == ["screening", "coding", "hiring_manager"]
    assert rounds[0]["reportedQuestions"][0]["sourceIds"] == ["src1"]
    assert blueprint["processSummary"].startswith("Likely interview process")
    # Progress was streamed while generating: sources, queries and each round as it was written.
    progress = blueprint["progress"]
    assert progress["stage"] == "done"
    assert progress["sources"] == [{"title": "Acme Payments careers", "domain": "careers.example.com"}]
    assert progress["queries"] == ["Acme Payments interview process"]
    assert [r["order"] for r in progress["rounds"]] == [1, 2, 3]
    assert progress["summary"].startswith("Likely interview process")
    assert (await api.get(url, headers=as_user("bob"))).status_code == 404
    application = (await api.get(f"/api/v1/interview/applications/{app_id}", headers=as_user("alice"))).json()
    assert application["activeBlueprintId"] == blueprint_id

    edit = {"rounds": [
        {"id": rounds[1]["id"], "type": "coding", "title": "Pairing exercise", "durationMinutes": 75},
        {"id": rounds[0]["id"], "type": "screening", "title": "Recruiter call", "durationMinutes": 20},
        {"type": "Take-home review", "customLabel": "Take-home review", "title": "Take-home walkthrough"},
    ]}
    stale = await api.put(url, headers={**as_user("alice"), "If-Match": '"7"'}, json=edit)
    assert stale.status_code == 412
    saved = await api.put(url, headers={**as_user("alice"), "If-Match": '"1"'}, json=edit)
    assert saved.status_code == 200
    new = saved.json()
    assert new["version"] == 2 and new["source"] == "user_edit"
    assert [r["title"] for r in new["rounds"]] == ["Pairing exercise", "Recruiter call", "Take-home walkthrough"]
    assert new["rounds"][0]["id"] == rounds[1]["id"] and new["rounds"][1]["id"] == rounds[0]["id"]
    assert new["rounds"][2]["type"] == "take_home_review"
    assert (await api.get(f"/api/v1/interview/applications/{app_id}", headers=as_user("alice"))).json()[
        "activeBlueprintId"
    ] == new["id"]

    session = await api.post("/api/v1/interview/sessions", headers=as_user("alice"), json={
        "id": str(uuid.uuid4()), "applicationId": app_id, "blueprintId": new["id"], "roundId": new["rounds"][0]["id"]})
    assert session.status_code == 201, session.text
    stored = (await db.document(f"users/alice/sessions/{session.json()['id']}").get()).to_dict() or {}
    assert stored["context"]["roundType"] == "coding"
    spec = await InterviewLiveAgentFactory().build(uid="alice", session_id=session.json()["id"], session=stored,
                                                   resumed=False)
    assert "Acme Payments" in spec.system_instruction
    assert "Pairing exercise" in spec.system_instruction
    assert "shared editor" in spec.system_instruction


async def test_round_guide_is_written_once_and_kept(
    api: httpx.AsyncClient, db: firestore.AsyncClient, queue: RecordingQueue
) -> None:
    await consent(db, "alice")
    resume_id = (await upload(api, "alice", "cv.md", RESUME.encode())).json()["id"]
    await drain(queue)
    body = {"id": str(uuid.uuid4()), "company": "Acme Payments", "roleTitle": "Senior Backend Engineer",
            "jobDescription": "Build payment APIs.", "resumeId": resume_id}
    app_id = (await api.post("/api/v1/interview/applications", headers=as_user("alice"), json=body)).json()["id"]
    base = f"/api/v1/interview/applications/{app_id}/blueprints"
    guide_before_ready = await api.post(f"{base}/nothere1/rounds/r01aaaaaaaa/guide", headers=as_user("alice"))
    assert guide_before_ready.status_code == 404
    blueprint_id = (await api.post(f"{base}:generate", headers=as_user("alice"))).json()["blueprintId"]
    await drain(queue)
    rounds = (await api.get(f"{base}/{blueprint_id}", headers=as_user("alice"))).json()["rounds"]
    url = f"{base}/{blueprint_id}/rounds/{rounds[0]['id']}/guide"

    assert (await api.get(url, headers=as_user("alice"))).status_code == 404
    written = await api.post(url, headers=as_user("alice"))
    assert written.status_code == 200, written.text
    guide = written.json()
    first = guide["questions"][0]
    # The reported question comes first, with the source the research cited.
    assert first["question"] == "Why Acme Payments?" and first["reported"] is True
    assert first["sources"] == ["careers.example.com"]
    assert all(not q["reported"] for q in guide["questions"][1:])
    assert guide["standOut"] and guide["questionsToAsk"] and guide["hasResume"] is True
    kept = (await api.get(url, headers=as_user("alice"))).json()
    assert kept["questions"] == guide["questions"]

    await consent(db, "bob")
    assert (await api.get(url, headers=as_user("bob"))).status_code == 404
    assert (await api.post(url, headers=as_user("bob"))).status_code == 404
    unknown = f"{base}/{blueprint_id}/rounds/r09bbbbbbbb/guide"
    assert (await api.post(unknown, headers=as_user("alice"))).status_code == 404
