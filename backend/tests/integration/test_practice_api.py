"""Practice Center rounds end to end: upload, measure, coach, and progress in one transaction."""

from __future__ import annotations

import io
import json
import math
import wave
from itertools import pairwise

import httpx
from google.cloud import firestore

from app.platform.jobs.queue import RecordingQueue
from app.platform.users import CURRENT_CONSENT_VERSION
from tests.integration.conftest import as_user
from tests.integration.test_pipeline import api_client, queue  # noqa: F401

URL = "/api/v1/practice/rounds"


def wav(seconds: float) -> bytes:
    rate = 16_000
    frames = b"".join(
        int(3000 * math.sin(2 * math.pi * 180 * i / rate)).to_bytes(2, "little", signed=True)
        for i in range(int(seconds * rate))
    )
    out = io.BytesIO()
    with wave.open(out, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(frames)
    return out.getvalue()


async def consent(api: httpx.AsyncClient, uid: str) -> None:
    await api.put("/api/v1/me/consents/ai_processing", headers=as_user(uid),
                  json={"accepted": True, "version": CURRENT_CONSENT_VERSION})


def form(drill: str, seconds: float, **fields: str) -> dict[str, object]:
    data = {"drillId": drill, "prompt": json.dumps({"kind": "question", "question": "What makes a good leader?"}),
            "localDate": "2026-09-17", **fields}
    return {"data": data, "files": {"audio": ("round.wav", wav(seconds), "audio/wav")}}


async def test_a_round_is_measured_coached_and_counted(
    db: firestore.AsyncClient,
    queue: RecordingQueue,  # noqa: F811
    api_client: httpx.AsyncClient,  # noqa: F811
) -> None:
    uid = "alice"
    blocked = await api_client.post(URL, headers=as_user(uid), **form("think-on-your-feet", 3))  # type: ignore[arg-type]
    assert blocked.json()["code"] == "consent_required"
    await consent(api_client, uid)

    text = "So um I think a good leader listens first. For example my manager asked before deciding. That is why."
    response = await api_client.post(
        URL, headers=as_user(uid),
        **form("think-on-your-feet", 40, prepUsedMs="4000", fakeText=text, speakSeconds="60"),  # type: ignore[arg-type]
    )
    assert response.status_code == 200, response.text
    body = response.json()
    metrics = {m["key"]: m for m in body["metrics"]}
    assert metrics["fillers"]["value"] == 1 and metrics["fillers"]["source"] == "measured"
    assert metrics["responseSeconds"]["value"] == 4.6  # 4 s of preparation + the first word at 0.6 s
    assert metrics["structure"]["source"] == "ai" and metrics["structure"]["value"] == 4
    assert metrics["structure"]["scale"] == [0, 5] and metrics["fillers"]["goal"] == 2
    timeline = body["timeline"]
    assert len(timeline) == len(text.split()) and [w["w"] for w in timeline if w["f"]] == ["um"]
    assert all(a["s"] <= b["s"] for a, b in pairwise(timeline))
    assert body["feedback"]["headline"] and body["feedback"]["nextTry"]
    # Quotes are only kept when they are really in the transcript.
    assert all(p["quote"] == "" or p["quote"].lower() in body["transcript"].lower()
               for p in body["feedback"]["strengths"] + body["feedback"]["improvements"])
    awards = body["awards"]
    assert awards["counted"] and awards["challenge"]["passed"] and awards["challenge"]["unlocked"] == 2
    assert awards["challenge"]["completed"] and awards["challenge"]["repeat"] == 1
    assert awards["xp"] >= 30
    progress = body["progress"]
    assert progress["streak"]["current"] == 1 and progress["drills"]["think-on-your-feet"]["level"] == 2

    stored = (await db.document(f"users/{uid}/practice/progress").get()).to_dict()
    assert stored and stored["xp"] == awards["xp"]
    attempts = [d.to_dict() async for d in db.collection(f"users/{uid}/practiceAttempts").stream()]
    assert len(attempts) == 1 and attempts[0]["drillId"] == "think-on-your-feet"
    assert "audio" not in json.dumps(attempts[0], default=str)

    # The progress endpoint shows the same state; another user sees their own (empty) progress.
    mine = (await api_client.get("/api/v1/practice/progress?day=2026-09-17", headers=as_user(uid))).json()
    assert mine["xp"] == stored["xp"] and mine["drills"]["think-on-your-feet"]["bests"][0]["value"] == 4.6
    theirs = (await api_client.get("/api/v1/practice/progress", headers=as_user("bob"))).json()
    assert theirs["xp"] == 0


async def test_short_rounds_and_bad_input(
    db: firestore.AsyncClient,
    queue: RecordingQueue,  # noqa: F811
    api_client: httpx.AsyncClient,  # noqa: F811
) -> None:
    uid = "carol"
    await consent(api_client, uid)
    short = await api_client.post(URL, headers=as_user(uid), **form("pause-dont-fill", 4))  # type: ignore[arg-type]
    assert short.status_code == 200
    assert not short.json()["awards"]["counted"] and short.json()["awards"]["xp"] == 0

    # A long answer is well over the 1 MB limit for ordinary requests.
    long = await api_client.post(URL, headers=as_user(uid), **form("random-word-story", 42))  # type: ignore[arg-type]
    assert long.status_code == 200, long.text
    assert long.json()["awards"]["counted"]

    unknown = await api_client.post(URL, headers=as_user(uid), **form("juggling", 20))  # type: ignore[arg-type]
    assert unknown.status_code == 422
    garbage = await api_client.post(
        URL, headers=as_user(uid), data={"drillId": "pause-dont-fill"},
        files={"audio": ("round.webm", b"not audio at all", "audio/webm")},
    )
    assert garbage.status_code == 415
