"""End-to-end live gateway behaviour with the fake engine and the Firestore emulator.

Starlette's TestClient runs the app on its own event loop, so the app creates
its own Firestore client there and tests seed/inspect data with a synchronous
client.
"""

from __future__ import annotations

import json
import struct
import time
import uuid
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient
from google.cloud import firestore
from starlette.websockets import WebSocketDisconnect

from app.core.errors import Unauthorized
from app.platform import clients as clients_module
from app.platform.agents import live_gateway
from app.platform.agents.live import (
    AudioOut,
    FakeLiveEngine,
    Interrupted,
    OutputText,
    PanelTurn,
    TurnComplete,
)
from app.platform.agents.live_protocol import ForbiddenReason
from app.platform.auth import dependencies as deps
from app.platform.auth.dependencies import AuthUser
from app.platform.clients import clients
from app.platform.jobs.queue import RecordingQueue
from app.platform.users import CURRENT_CONSENT_VERSION
from tests.integration.conftest import EMULATOR, PROJECT, as_user, fake_user


def token_user(token: str) -> AuthUser:
    if not token.startswith("test:"):
        raise Unauthorized()
    uid, _, flag = token.removeprefix("test:").partition("/")
    # "test:alice/unverified" is the same person holding a token minted before they confirmed
    # their address: an email/password account whose claim still says the address is unverified.
    unverified = flag == "unverified"
    return AuthUser(
        uid=uid,
        email_verified=not unverified,
        sign_in_provider="password" if unverified else "apple.com",
        auth_time=0,
    )


@pytest.fixture
def env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[dict[str, Any]]:
    httpx.delete(f"http://{EMULATOR}/emulator/v1/projects/{PROJECT}/databases/(default)/documents")
    monkeypatch.setenv("LOCAL_OBJECTS_DIR", str(tmp_path))
    monkeypatch.setattr(live_gateway, "AUTH_TIMEOUT_S", 0.5)

    async def fake_verify(id_token: str, app_check: str | None, *, check_revoked: bool) -> AuthUser:
        return token_user(id_token)

    monkeypatch.setattr(live_gateway, "verify_credentials", fake_verify)
    engine, queue = FakeLiveEngine(), RecordingQueue()
    clients.overrides.update({"live_engine": engine, "task_queue": queue})
    clients_module._firestore.cache_clear()
    from app.platform import runtime_config

    runtime_config.reset_cache()
    from app.main import create_app

    app = create_app()
    app.dependency_overrides[deps._current_user] = fake_user
    app.dependency_overrides[deps._current_user_strict] = fake_user
    db = firestore.Client(project=PROJECT)
    with TestClient(app) as client:
        yield {"client": client, "db": db, "engine": engine, "queue": queue, "objects": tmp_path,
               "settle": lambda: client.portal.call(live_gateway.wait_for_teardowns)}
        client.portal.call(live_gateway.wait_for_teardowns)
    clients.overrides.pop("live_engine", None)
    clients.overrides.pop("task_queue", None)
    clients_module._firestore.cache_clear()


def consent(db: firestore.Client, uid: str) -> None:
    for kind in ("ai_processing", "recording"):
        db.document(f"users/{uid}/consents/{kind}").set({"accepted": True, "version": CURRENT_CONSENT_VERSION})


def create_session(client: TestClient, uid: str, panel: str = "one_to_one", mode: str = "online") -> str:
    sid = str(uuid.uuid4())
    r = client.post("/api/v1/interview/sessions", headers=as_user(uid),
                    json={"id": sid, "practice": "general_behavioral", "durationMinutes": 10, "panel": panel,
                          "mode": mode})
    assert r.status_code == 201, r.text
    return str(r.json()["id"])


def frame(seq: int, capture_ms: int, ms: int = 100) -> bytes:
    return struct.pack("<II", seq, capture_ms) + b"\x10\x00" * (16 * ms)


def auth(ws: Any, uid: str) -> dict[str, Any]:
    ws.send_json({"type": "auth", "idToken": f"test:{uid}"})
    msg: dict[str, Any] = ws.receive_json()
    return msg


def receive_until(ws: Any, kind: str, limit: int = 20) -> dict[str, Any]:
    for _ in range(limit):
        message = ws.receive()
        if message["type"] == "websocket.close":
            raise AssertionError(f"socket closed with {message.get('code')} before {kind}")
        if message.get("text"):
            payload: dict[str, Any] = json.loads(message["text"])
            if payload.get("type") == kind:
                return payload
    raise AssertionError(f"no {kind} message")


def join_panel(ws: Any, conn: Any, where: str = "online") -> int:
    """A panel opens with the lead's introduction and a hello from each colleague.

    On a call the lead hands each of them the floor in the same turn; the server speaks the hellos
    in their own voices. In the meeting room the colleagues say hello by themselves once the lead's
    welcome has been heard (`scripted_hellos`), so the lead only opens. Returns the last hello's turn.
    """
    seq = receive_until(ws, "turn_complete")["turnSeq"]
    if where == "in_person":
        # The opening was the lead's welcome. Once it has been heard, the room's hellos follow
        # without anyone handing over.
        hellos = [("Daniel", ""), ("Grace", "")]
        ws.send_json({"type": "playback_stopped", "turnSeq": seq, "mediaMs": 0})
    else:
        hellos = [("Daniel", "Hi, I'm Daniel, I lead the team you'd be joining."),
                  ("Grace", "Hello, I'm Grace, I'd be one of your colleagues.")]
        conn.inject(
            AudioOut(b"\x00\x00" * 2400),
            OutputText("Thanks for joining. My colleagues are with me today.", finished=True),
            *[PanelTurn(first, words, "hello") for first, words in hellos],
            TurnComplete(),
        )
    names = []
    for _ in hellos:
        names.append(receive_until(ws, "panel_speaker")["name"])
        seq = receive_until(ws, "turn_complete")["turnSeq"]
    assert [n.split()[0] for n in names] == [first for first, _ in hellos]
    return int(seq)


def close_frame(ws: Any) -> tuple[int, str]:
    """The test session's raw receive() returns the close message rather than raising."""
    for _ in range(50):
        try:
            message = ws.receive()
        except WebSocketDisconnect as exc:
            return int(exc.code), str(exc.reason or "")
        if message["type"] == "websocket.close":
            return int(message.get("code", 1000)), str(message.get("reason", ""))
    raise AssertionError("socket did not close")


def close_code(ws: Any) -> int:
    return close_frame(ws)[0]


def test_session_creation_requires_consent(env: dict[str, Any]) -> None:
    r = env["client"].post("/api/v1/interview/sessions", headers=as_user("alice"),
                           json={"id": str(uuid.uuid4()), "practice": "general_behavioral"})
    assert r.status_code == 403
    assert r.json()["code"] == "consent_required"


def test_session_creation_is_idempotent(env: dict[str, Any]) -> None:
    consent(env["db"], "alice")
    sid = str(uuid.uuid4())
    body = {"id": sid, "practice": "general_behavioral"}
    first = env["client"].post("/api/v1/interview/sessions", headers=as_user("alice"), json=body)
    second = env["client"].post("/api/v1/interview/sessions", headers=as_user("alice"), json=body)
    assert first.status_code == second.status_code == 201
    usage = env["db"].collection("users/alice/usage").get()
    assert sum(d.to_dict().get("sessionsCreated", 0) for d in usage) == 1
    bad = env["client"].post("/api/v1/interview/sessions", headers=as_user("alice"),
                             json={"id": "not-a-uuid", "practice": "general_behavioral"})
    assert bad.status_code == 400


def test_blueprint_ids_are_resolved_under_the_caller(env: dict[str, Any]) -> None:
    consent(env["db"], "alice")
    consent(env["db"], "bob")
    env["db"].document("users/bob/applications/app00001/blueprints/bp000001").set(
        {"status": "ready", "rounds": [{"id": "round0001", "type": "technical", "title": "Tech"}]}
    )
    r = env["client"].post("/api/v1/interview/sessions", headers=as_user("alice"), json={
        "id": str(uuid.uuid4()), "applicationId": "app00001", "blueprintId": "bp000001", "roundId": "round0001"})
    assert r.status_code == 404


def test_auth_timeout(env: dict[str, Any]) -> None:
    with env["client"].websocket_connect("/api/v1/sessions/abcdefgh1234/live") as ws:
        assert close_code(ws) == 4408


def test_invalid_token(env: dict[str, Any]) -> None:
    with env["client"].websocket_connect("/api/v1/sessions/abcdefgh1234/live") as ws:
        ws.send_json({"type": "auth", "idToken": "forged"})
        assert close_code(ws) == 4401


def test_cannot_join_another_users_session(env: dict[str, Any]) -> None:
    consent(env["db"], "alice")
    consent(env["db"], "bob")
    sid = create_session(env["client"], "alice")
    with env["client"].websocket_connect(f"/api/v1/sessions/{sid}/live") as ws:
        ws.send_json({"type": "auth", "idToken": "test:bob"})
        assert close_code(ws) == 4404


def test_consent_withdrawn_blocks_live(env: dict[str, Any]) -> None:
    consent(env["db"], "alice")
    sid = create_session(env["client"], "alice")
    env["db"].document("users/alice/consents/recording").set({"accepted": False, "version": CURRENT_CONSENT_VERSION})
    with env["client"].websocket_connect(f"/api/v1/sessions/{sid}/live") as ws:
        ws.send_json({"type": "auth", "idToken": "test:alice"})
        assert close_code(ws) == 4403


def test_a_4403_says_which_one_it_is(env: dict[str, Any]) -> None:
    """The app writes the candidate a different sentence for each, so the reason is wire format.

    Both of these close the socket the same way, and asking someone to accept a recording consent
    they have already given — when it is their address that needs confirming — leaves them with
    nothing they can do about it.
    """
    consent(env["db"], "alice")
    sid = create_session(env["client"], "alice")
    with env["client"].websocket_connect(f"/api/v1/sessions/{sid}/live") as ws:
        ws.send_json({"type": "auth", "idToken": "test:alice/unverified"})
        assert close_frame(ws) == (4403, ForbiddenReason.EMAIL_UNVERIFIED)

    env["db"].document("users/alice/consents/recording").set({"accepted": False, "version": CURRENT_CONSENT_VERSION})
    with env["client"].websocket_connect(f"/api/v1/sessions/{sid}/live") as ws:
        ws.send_json({"type": "auth", "idToken": "test:alice"})
        assert close_frame(ws) == (4403, ForbiddenReason.CONSENT_REQUIRED)


def test_kill_switch_and_quota(env: dict[str, Any]) -> None:
    consent(env["db"], "alice")
    sid = create_session(env["client"], "alice")
    env["db"].document("config/runtime").set({"aiEnabled": False})
    from app.platform import runtime_config

    runtime_config.reset_cache()  # session creation cached aiEnabled=True a moment ago
    with env["client"].websocket_connect(f"/api/v1/sessions/{sid}/live") as ws:
        ws.send_json({"type": "auth", "idToken": "test:alice"})
        assert close_code(ws) == 4503
    env["db"].document("config/runtime").set({"aiEnabled": True})
    runtime_config.reset_cache()
    month = time.strftime("m-%Y-%m", time.gmtime())
    env["db"].document(f"users/alice/usage/{month}").set({"liveSeconds": 10_000_000})
    with env["client"].websocket_connect(f"/api/v1/sessions/{sid}/live") as ws:
        ws.send_json({"type": "auth", "idToken": "test:alice"})
        assert close_code(ws) == 4429


def test_full_session_records_and_enqueues_processing_once(env: dict[str, Any]) -> None:
    db, client = env["db"], env["client"]
    consent(db, "alice")
    sid = create_session(client, "alice")

    with client.websocket_connect(f"/api/v1/sessions/{sid}/live") as ws:
        ready = auth(ws, "alice")
        assert ready["type"] == "ready" and ready["resumed"] is False
        caption = receive_until(ws, "caption")
        assert caption["speaker"] == "interviewer"
        audio = ws.receive_bytes()
        turn_seq, chunk = struct.unpack_from("<II", audio, 0)
        assert (turn_seq, chunk) == (1, 0)
        receive_until(ws, "turn_complete")
        ws.send_json({"type": "playback_started", "turnSeq": 1, "mediaMs": 200})
        ws.send_json({"type": "playback_stopped", "turnSeq": 1, "mediaMs": 600})
        for seq in range(5):
            ws.send_bytes(frame(seq, 700 + seq * 100))
        ws.send_json({"type": "end"})
        ended = receive_until(ws, "ended")
        assert ended["reason"] == "candidate_ended"
    env["settle"]()

    engine = env["engine"]
    assert engine.connections[0].received_audio_bytes == 5 * 3200
    assert "[Session start" in engine.connections[0].received_text[0]

    session = db.document(f"users/alice/sessions/{sid}").get().to_dict()
    assert session["status"] == "ended"
    assert session["processingStatus"] == "queued"
    assert session["media"]["durationMs"] == 1200

    job = db.document(f"jobs/sess-{sid}").get().to_dict()
    assert job["uid"] == "alice" and job["status"] == "queued"
    assert len(env["queue"].requests) == 1

    turns = [d.to_dict() for d in db.collection(f"users/alice/sessions/{sid}/turns").order_by("seq").get()]
    assert turns[0]["speaker"] == "interviewer"
    assert turns[0]["tStartMs"] == 200 and turns[0]["tEndMs"] == 600

    state = db.document(f"liveSessions/{sid}").get().to_dict()
    assert state["uid"] == "alice" and state["handle"].startswith("handle-")
    segments = sorted(p.name for p in (env["objects"] / "demo-atrium-user-content").rglob("*.trk"))
    assert segments == ["cand-0000.trk", "ivr-0000.trk"]

    # The session can't be reopened after it ended.
    with client.websocket_connect(f"/api/v1/sessions/{sid}/live") as ws:
        ws.send_json({"type": "auth", "idToken": "test:alice"})
        assert close_code(ws) == 4409


def test_one_live_session_per_user(env: dict[str, Any]) -> None:
    consent(env["db"], "alice")
    first, second = create_session(env["client"], "alice"), create_session(env["client"], "alice")
    with env["client"].websocket_connect(f"/api/v1/sessions/{first}/live") as ws1:
        assert auth(ws1, "alice")["type"] == "ready"
        with env["client"].websocket_connect(f"/api/v1/sessions/{second}/live") as ws2:
            ws2.send_json({"type": "auth", "idToken": "test:alice"})
            assert close_code(ws2) == 4409


def test_backlog_burst_after_a_slow_start_is_accepted(env: dict[str, Any]) -> None:
    db, client, engine = env["db"], env["client"], env["engine"]
    consent(db, "alice")
    sid = create_session(client, "alice")

    with client.websocket_connect(f"/api/v1/sessions/{sid}/live") as ws:
        auth(ws, "alice")
        # ~12 s of audio captured while the server was getting ready, sent at once.
        for seq in range(120):
            ws.send_bytes(frame(seq, seq * 100))
        ws.send_json({"type": "end"})
        receive_until(ws, "ended")
    env["settle"]()

    assert engine.connections[0].received_audio_bytes == 120 * 3200


def test_long_backlog_read_late_is_accepted(env: dict[str, Any]) -> None:
    """Frames that queued in the socket while the server was busy arrive together."""
    db, client, engine = env["db"], env["client"], env["engine"]
    consent(db, "alice")
    sid = create_session(client, "alice")

    with client.websocket_connect(f"/api/v1/sessions/{sid}/live") as ws:
        auth(ws, "alice")
        for seq in range(300):  # 30 s of real-time audio, read in one go
            ws.send_bytes(frame(seq, seq * 100))
        ws.send_json({"type": "end"})
        receive_until(ws, "ended", limit=40)
    env["settle"]()

    assert engine.connections[0].received_audio_bytes == 300 * 3200


def test_sustained_frame_flood_is_rejected(env: dict[str, Any]) -> None:
    db, client = env["db"], env["client"]
    consent(db, "alice")
    sid = create_session(client, "alice")

    with client.websocket_connect(f"/api/v1/sessions/{sid}/live") as ws:
        auth(ws, "alice")
        # Frames that claim no recording time between them: not a microphone.
        for seq in range(400):
            ws.send_bytes(frame(seq, 5_000))
        assert close_code(ws) == 4400


def test_panel_says_hello_after_the_introduction_once(env: dict[str, Any]) -> None:
    db, client, engine = env["db"], env["client"], env["engine"]
    consent(db, "alice")
    sid = create_session(client, "alice", panel="panel")

    with client.websocket_connect(f"/api/v1/sessions/{sid}/live") as ws:
        auth(ws, "alice")
        conn = engine.connections[0]
        join_panel(ws, conn)
        # An interruption while the lead is idle must not cut the colleagues' queued hellos.
        conn.inject(Interrupted())
        # The same hello again is the lead forgetting it has already made the introduction: the
        # words have been said once, in their own voice, and saying them twice is worse than not.
        conn.inject(
            AudioOut(b"\x00\x00" * 2400),
            OutputText("Let's begin.", finished=True),
            PanelTurn("Daniel", "Hi, I'm Daniel, I lead the team you'd be joining.", "hello"),
            TurnComplete(),
        )
        seen = []
        for _ in range(20):
            message = ws.receive()
            if message.get("text"):
                payload = json.loads(message["text"])
                seen.append(payload["type"])
                if payload["type"] == "turn_complete":
                    break
        assert "panel_speaker" not in seen and "interrupted" not in seen
        ws.send_json({"type": "end"})
        receive_until(ws, "ended", limit=40)
    env["settle"]()

    # The lead cannot hear its colleagues, so it is told they have introduced themselves.
    assert any("introduced themselves" in t for t in conn.received_text)
    state = db.document(f"liveSessions/{sid}").get().to_dict()
    assert state["panelGreeted"] == ["Daniel Brooks", "Grace Lin"]
    # Saying hello is not asking.
    assert state["panelAsked"] == [] and state["panelQuestions"] == 0


def loud(seq: int, capture_ms: int) -> bytes:
    return struct.pack("<II", seq, capture_ms) + (3000).to_bytes(2, "little", signed=True) * 1600


def turn_events(ws: Any, until: str, limit: int = 80) -> list[dict[str, Any]]:
    seen: list[dict[str, Any]] = []
    for _ in range(limit):
        message = ws.receive()
        if message.get("bytes"):
            seen.append({"type": "audio", "turnSeq": struct.unpack_from("<I", message["bytes"])[0]})
        elif message.get("text"):
            payload = json.loads(message["text"])
            seen.append(payload)
            if payload["type"] == until:
                return seen
    raise AssertionError(f"no {until}")


def answer(ws: Any, seq: int, at_ms: int) -> int:
    """Speak for 2 s, then fall silent for 2.5 s; returns the next frame number."""
    for i in range(20):
        ws.send_bytes(loud(seq, at_ms + i * 100))
        seq += 1
    for i in range(25):
        ws.send_bytes(frame(seq, at_ms + 2000 + i * 100))
        seq += 1
    return seq


def test_a_colleague_asks_their_share_and_no_more(env: dict[str, Any]) -> None:
    """A panel has a shape: the lead runs it and a colleague comes in once or twice.

    The lead says its hand-over and writes the colleague's question in the same turn; the server
    speaks it in their own voice. Once that colleague's share is spent the hand-over is refused —
    silence after "over to you" is the one thing the candidate must never hear, so the question
    comes back to the lead to ask itself.
    """
    db, client, engine = env["db"], env["client"], env["engine"]
    consent(db, "alice")
    sid = create_session(client, "alice", panel="panel", mode="in_person")

    with client.websocket_connect(f"/api/v1/sessions/{sid}/live") as ws:
        auth(ws, "alice")
        conn = engine.connections[0]
        join_panel(ws, conn, "in_person")
        assert conn.spec.tools == ("end_interview", "give_floor")
        assert conn.spec.lead_name and conn.spec.panel_brief
        assert [(m.first_name, m.questions) for m in conn.spec.panel] == [("Daniel", 2), ("Grace", 0)]

        seq = 0
        questions = ["What was the hardest part of that?", "How did you decide what to leave out?"]
        for question in questions:
            conn.inject(
                AudioOut(b"\x00\x00" * 2400),
                OutputText("Thanks, that's clear. Daniel, over to you.", finished=True),
                PanelTurn("Daniel", question, "question"),
                TurnComplete(),
            )
            events = turn_events(ws, "panel_speaker")
            # The lead's short hand-over is its own turn, just before the colleague's.
            handover = [e for e in events if e["type"] == "caption"]
            assert handover and "over to you" in handover[-1]["text"]
            speaker = events[-1]
            assert speaker["name"] == "Daniel Brooks"
            asked = turn_events(ws, "turn_complete")
            assert all(e["turnSeq"] == speaker["turnSeq"] for e in asked if e["type"] == "audio")
            assert any(e.get("text") == question for e in asked)
            ws.send_json({"type": "playback_stopped", "turnSeq": speaker["turnSeq"], "mediaMs": seq * 100})
            # The candidate answers the colleague into the same session: the lead hears it itself.
            seq = answer(ws, seq, seq * 100 + 500)

        # A third turn for Daniel, and a question put to the note-taker, who never asks anything:
        # neither is spoken, and each comes back to the lead with the words it wrote.
        for who, refused in (("Daniel", "And what would you do differently?"),
                             ("Grace", "How did you test any of it?")):
            before = len([t for t in conn.received_text if "Panel note" in t])
            conn.inject(
                AudioOut(b"\x00\x00" * 2400),
                OutputText(f"{who}, over to you.", finished=True),
                PanelTurn(who, refused, "question"),
                TurnComplete(),
            )
            seen = [e["type"] for e in turn_events(ws, "turn_complete")]
            assert "panel_speaker" not in seen
            for _ in range(100):
                notes = [t for t in conn.received_text if "Panel note" in t]
                if len(notes) > before:
                    break
                time.sleep(0.05)
            assert len(notes) > before, f"the lead was never told {who} had no turn left"
            assert refused in notes[-1] and who in notes[-1] and "ask it yourself" in notes[-1]

        ws.send_json({"type": "end"})
        receive_until(ws, "ended", limit=60)
    env["settle"]()

    state = db.document(f"liveSessions/{sid}").get().to_dict()
    assert state["panelAsked"] == ["Daniel Brooks"] * 2 and state["panelQuestions"] == 2
    turns = [d.to_dict() for d in db.collection(f"users/alice/sessions/{sid}/turns").stream()]
    spoken = [t["text"] for t in turns if t.get("panelPurpose") == "question"]
    assert spoken == [f"Daniel Brooks: {q}" for q in questions]
    # Nothing a colleague was refused was ever said to the candidate.
    assert not any("would you do differently" in t.get("text", "") for t in turns)


def test_reconnect_before_the_greeting_starts_over(env: dict[str, Any]) -> None:
    db, client, engine = env["db"], env["client"], env["engine"]
    consent(db, "alice")
    sid = create_session(client, "alice")

    engine.speak_on_connect = False
    with client.websocket_connect(f"/api/v1/sessions/{sid}/live") as ws:
        auth(ws, "alice")
    env["settle"]()

    engine.speak_on_connect = True
    with client.websocket_connect(f"/api/v1/sessions/{sid}/live") as ws:
        ready = auth(ws, "alice")
        assert ready["resumed"] is False
        receive_until(ws, "turn_complete")
    env["settle"]()

    # The interviewer never spoke, so the second connection greets rather than waiting in silence.
    assert engine.connections[1].spec.resumption_handle is None
    assert len(engine.connections[1].received_text) == 1
    assert "Begin the interview" in engine.connections[1].received_text[0]


def test_reconnect_resumes_and_ignores_replayed_frames(env: dict[str, Any]) -> None:
    db, client, engine = env["db"], env["client"], env["engine"]
    consent(db, "alice")
    sid = create_session(client, "alice")

    with client.websocket_connect(f"/api/v1/sessions/{sid}/live") as ws:
        auth(ws, "alice")
        for seq in range(5):
            ws.send_bytes(frame(seq, seq * 100))
        receive_until(ws, "turn_complete")
    env["settle"]()
    # Dropped connection: session stays open for resumption.
    assert db.document(f"users/alice/sessions/{sid}").get().to_dict()["status"] == "live"

    with client.websocket_connect(f"/api/v1/sessions/{sid}/live") as ws:
        ready = auth(ws, "alice")
        assert ready["resumed"] is True and ready["lastSeq"] == 4
        for seq in range(3, 7):  # 3 and 4 are replays from the client's ring buffer
            ws.send_bytes(frame(seq, seq * 100))
        ws.send_json({"type": "end"})
        receive_until(ws, "ended")
    env["settle"]()

    assert engine.connections[1].spec.resumption_handle is not None
    assert engine.connections[1].received_audio_bytes == 2 * 3200
    assert engine.connections[1].received_text == []  # no second opening message
    assert len(env["queue"].requests) == 1
