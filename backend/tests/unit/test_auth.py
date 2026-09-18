from __future__ import annotations

from collections.abc import Iterator
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from firebase_admin import auth

from app.core.errors import install_error_handlers
from app.core.settings import get_settings
from app.platform.auth import dependencies as deps
from app.platform.auth.dependencies import current_user, current_user_strict

VALID = {"uid": "user-a", "email_verified": True, "auth_time": 1, "firebase": {"sign_in_provider": "apple.com"}}


@pytest.fixture
def calls(monkeypatch: pytest.MonkeyPatch) -> Iterator[dict[str, Any]]:
    record: dict[str, Any] = {"check_revoked": None, "app_check": 0}

    def fake_verify(token: str, app: object = None, check_revoked: bool = False) -> dict[str, Any]:
        record["check_revoked"] = check_revoked
        if token == "revoked":
            raise auth.RevokedIdTokenError("revoked")
        if token == "disabled":
            raise auth.UserDisabledError("disabled")
        if token != "good":
            raise auth.InvalidIdTokenError("bad")
        return VALID

    def fake_app_check(token: str, app: object = None) -> dict[str, Any]:
        record["app_check"] += 1
        if token != "attested":
            raise ValueError("bad app check token")
        return {"app_id": "ios"}

    monkeypatch.setattr(deps.auth, "verify_id_token", fake_verify)
    monkeypatch.setattr(deps.app_check, "verify_token", fake_app_check)
    monkeypatch.setattr(deps.clients, "firebase_app", lambda: object())
    yield record


def build_app() -> FastAPI:
    app = FastAPI()
    install_error_handlers(app)

    @app.get("/me")
    async def me(user: current_user) -> dict[str, Any]:
        return {"uid": user.uid, "provider": user.sign_in_provider}

    @app.get("/sensitive")
    async def sensitive(user: current_user_strict) -> dict[str, str]:
        return {"uid": user.uid}

    return app


@pytest.fixture
def client() -> Iterator[TestClient]:
    with TestClient(build_app()) as c:
        yield c


def test_missing_token_is_401(client: TestClient, calls: dict[str, Any]) -> None:
    r = client.get("/me")
    assert r.status_code == 401
    assert r.json()["code"] == "unauthenticated"


def test_wrong_scheme_is_rejected(client: TestClient, calls: dict[str, Any]) -> None:
    r = client.get("/me", headers={"Authorization": "Basic good"})
    assert r.status_code == 401
    assert r.json()["code"] == "invalid_token"


def test_invalid_token(client: TestClient, calls: dict[str, Any]) -> None:
    r = client.get("/me", headers={"Authorization": "Bearer forged"})
    assert r.status_code == 401
    assert r.json()["code"] == "invalid_token"


def test_identity_comes_from_token(client: TestClient, calls: dict[str, Any]) -> None:
    r = client.get("/me?uid=someone-else", headers={"Authorization": "Bearer good"})
    assert r.status_code == 200
    assert r.json() == {"uid": "user-a", "provider": "apple.com"}
    assert calls["check_revoked"] is False


def test_strict_routes_check_revocation(client: TestClient, calls: dict[str, Any]) -> None:
    assert client.get("/sensitive", headers={"Authorization": "Bearer good"}).status_code == 200
    assert calls["check_revoked"] is True
    r = client.get("/sensitive", headers={"Authorization": "Bearer revoked"})
    assert r.status_code == 401
    assert r.json()["code"] == "token_revoked"


def test_disabled_user_is_forbidden(client: TestClient, calls: dict[str, Any]) -> None:
    assert client.get("/me", headers={"Authorization": "Bearer disabled"}).status_code == 403


def test_app_check_enforced(
    client: TestClient, calls: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("APP_CHECK_ENFORCED", "true")
    get_settings.cache_clear()
    r = client.get("/me", headers={"Authorization": "Bearer good"})
    assert r.status_code == 401
    assert r.json()["code"] == "app_check_failed"
    r = client.get("/me", headers={"Authorization": "Bearer good", "X-Firebase-AppCheck": "spoofed"})
    assert r.json()["code"] == "app_check_failed"
    r = client.get("/me", headers={"Authorization": "Bearer good", "X-Firebase-AppCheck": "attested"})
    assert r.status_code == 200


def test_password_accounts_need_verified_email() -> None:
    user = deps.AuthUser(uid="u", email_verified=False, sign_in_provider="password", auth_time=0)
    assert not user.verified_for_ai
    apple = deps.AuthUser(uid="u", email_verified=False, sign_in_provider="apple.com", auth_time=0)
    assert apple.verified_for_ai
