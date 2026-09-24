"""The board exam's two extra channels, through the real gateway.

Whether the model *understands* the handwriting is a question for a live model; what is
testable here is that the picture actually reaches the engine, and that what the examiner
writes actually reaches the student.
"""

from __future__ import annotations

import base64
import uuid
from typing import Any

import pytest
from starlette.testclient import TestClient

from app.platform.agents.live import BoardWrite
from app.platform.clients import clients
from tests.integration.test_live_gateway import auth, close_code, consent, receive_until
from tests.integration.test_live_gateway import env as gateway_env

# The live gateway's harness (emulator reset, fake auth, fake engine) is the harness here too.
env = pytest.fixture(name="env")(gateway_env.__wrapped__)

pytestmark = pytest.mark.emulator

#: Only the first bytes matter to the gateway: it checks the file really is a JPEG.
FAKE_JPEG = b"\xff\xd8\xff" + b"board ink " * 64 + b"\xff\xd9"


def as_user(uid: str) -> dict[str, str]:
    return {"Authorization": f"Bearer test:{uid}"}


def create_board_exam(client: TestClient, uid: str) -> str:
    sid = str(uuid.uuid4())
    response = client.post(
        "/api/v1/exam/sessions",
        headers=as_user(uid),
        json={"id": sid, "style": "board_work", "durationMinutes": 10},
    )
    assert response.status_code == 201, response.text
    assert response.json()["examStyle"] == "board_work"
    return str(response.json()["id"])


def test_the_students_handwriting_reaches_the_model(env: dict[str, Any]) -> None:
    consent(env["db"], "alice")
    sid = create_board_exam(env["client"], "alice")
    engine = clients.overrides["live_engine"]

    with env["client"].websocket_connect(f"/api/v1/sessions/{sid}/live") as ws:
        ready = auth(ws, "alice")
        assert ready["type"] == "ready"
        # A board exam has a board, so the gateway accepts pictures of it.
        assert ready["coding"] is True
        ws.send_json({
            "type": "board_image",
            "mediaMs": 4_000,
            "jpegBase64": base64.b64encode(FAKE_JPEG).decode(),
        })
        receive_until(ws, "turn_complete")

    assert engine.connections[-1].received_images == [FAKE_JPEG], "the board never reached the engine"


def test_a_spoken_exam_has_no_board_to_send(env: dict[str, Any]) -> None:
    consent(env["db"], "alice")
    sid = str(uuid.uuid4())
    response = env["client"].post(
        "/api/v1/exam/sessions", headers=as_user("alice"),
        json={"id": sid, "style": "oral_questions", "durationMinutes": 10},
    )
    assert response.status_code == 201
    engine = clients.overrides["live_engine"]

    with env["client"].websocket_connect(f"/api/v1/sessions/{response.json()['id']}/live") as ws:
        assert auth(ws, "alice")["coding"] is False
        ws.send_json({
            "type": "board_image", "mediaMs": 1_000, "jpegBase64": base64.b64encode(FAKE_JPEG).decode(),
        })
        receive_until(ws, "turn_complete")

    assert engine.connections[-1].received_images == []


def test_anything_that_is_not_a_jpeg_closes_the_socket(env: dict[str, Any]) -> None:
    consent(env["db"], "alice")
    sid = create_board_exam(env["client"], "alice")
    with env["client"].websocket_connect(f"/api/v1/sessions/{sid}/live") as ws:
        auth(ws, "alice")
        not_an_image = base64.b64encode(b"PK\x03\x04" * 32).decode()
        ws.send_json({"type": "board_image", "mediaMs": 1_000, "jpegBase64": not_an_image})
        assert close_code(ws) == 4400


def test_what_the_examiner_writes_reaches_the_student(env: dict[str, Any]) -> None:
    consent(env["db"], "alice")
    sid = create_board_exam(env["client"], "alice")
    engine = clients.overrides["live_engine"]

    with env["client"].websocket_connect(f"/api/v1/sessions/{sid}/live") as ws:
        auth(ws, "alice")
        receive_until(ws, "turn_complete")
        engine.connections[-1].inject(BoardWrite("A pipe narrows from 10 cm to 4 cm.\nWater enters at 2 m/s."))
        written = receive_until(ws, "board_write")

    assert "10 cm to 4 cm" in written["text"]
    assert "2 m/s" in written["text"]
