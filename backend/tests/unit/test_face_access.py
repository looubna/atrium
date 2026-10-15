from __future__ import annotations

from typing import Any

import pytest

from app.platform.auth.dependencies import AuthUser
from app.platform.faces import api as faces_api
from app.platform.faces.pool import Warmth
from app.platform.plans import PlanId, PlanLimits

VERIFIED = AuthUser(uid="u1", email_verified=True, sign_in_provider="password", auth_time=0)
UNVERIFIED = AuthUser(uid="u1", email_verified=False, sign_in_provider="password", auth_time=0)


class _Server:
    def __init__(self) -> None:
        self.warmed = 0

    async def warm(self) -> Warmth:
        self.warmed += 1
        return Warmth("starting", elapsed_s=3)


@pytest.fixture
def server(monkeypatch: pytest.MonkeyPatch) -> _Server:
    fake = _Server()
    monkeypatch.setattr(faces_api, "face_server", lambda: fake)
    monkeypatch.setattr(faces_api.clients, "firestore", lambda: None)

    async def relay() -> list[dict[str, Any]]:
        return [{"urls": "turn:relay"}]

    monkeypatch.setattr(faces_api, "ice_servers", relay)
    return fake


def _left(monkeypatch: pytest.MonkeyPatch, seconds: int) -> None:
    async def limits(user: AuthUser, *, practice: bool = True) -> tuple[PlanId, Any]:
        return PlanId.FREE, PlanLimits(0, 45, 1, 6, 5, 6, 2, 10, 25)

    async def minutes(db: Any, uid: str, limits: PlanLimits) -> dict[str, int | None]:
        return {"leftSeconds": seconds}

    monkeypatch.setattr(faces_api, "plan_limits", limits)
    monkeypatch.setattr(faces_api, "live_minutes", minutes)


async def test_an_account_that_can_go_live_wakes_the_face(monkeypatch: pytest.MonkeyPatch, server: _Server) -> None:
    _left(monkeypatch, 600)
    assert (await faces_api.warm(VERIFIED))["state"] == "starting"
    assert server.warmed == 1
    assert (await faces_api.ice(VERIFIED))["iceServers"] == [{"urls": "turn:relay"}]


async def test_no_minutes_or_no_verified_email_never_wakes_a_gpu(
    monkeypatch: pytest.MonkeyPatch, server: _Server
) -> None:
    _left(monkeypatch, 10)  # under the gateway's 30 s: no session could start
    assert (await faces_api.warm(VERIFIED))["state"] == "unavailable"
    with pytest.raises(faces_api.NoLiveMinutes):
        await faces_api.ice(VERIFIED)
    _left(monkeypatch, 600)
    assert (await faces_api.warm(UNVERIFIED))["state"] == "unavailable"
    with pytest.raises(faces_api.NoLiveMinutes):
        await faces_api.ice(UNVERIFIED)
    assert server.warmed == 0
