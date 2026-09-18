from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.core.errors import install_error_handlers
from app.core.settings import Env
from app.platform.auth import worker

WORKER = "https://atrium-worker-abc123-uc.a.run.app"
INVOKER = "atrium-invoker@atrium-coach-dev.iam.gserviceaccount.com"


@pytest.fixture
def audiences(monkeypatch: pytest.MonkeyPatch) -> list[Any]:
    seen: list[Any] = []

    def fake_verify(token: str, request: object, audience: Any) -> dict[str, Any]:
        seen.append(audience)
        if token == "forged":
            raise ValueError("invalid signature")
        return {"email": INVOKER if token == "invoker" else "someone@example.com", "email_verified": True}

    monkeypatch.setattr(worker.id_token, "verify_oauth2_token", fake_verify)
    return seen


def use_settings(monkeypatch: pytest.MonkeyPatch, worker_url: str) -> None:
    settings = SimpleNamespace(app_env=Env.DEV, worker_url=worker_url, tasks_invoker_sa=INVOKER)
    monkeypatch.setattr(worker, "get_settings", lambda: settings)


def client() -> TestClient:
    app = FastAPI()
    install_error_handlers(app)

    @app.post("/internal/ping")
    async def ping(caller: worker.worker_caller) -> dict[str, str]:
        return {"caller": caller}

    return TestClient(app, base_url=WORKER)


def test_worker_without_its_own_url_configured_accepts_tokens_for_the_url_called(
    audiences: list[Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    # The deployed worker has no WORKER_URL (a service can't reference its own URL).
    use_settings(monkeypatch, worker_url="")
    response = client().post("/internal/ping", headers={"Authorization": "Bearer invoker"})
    assert response.status_code == 200
    assert response.json() == {"caller": INVOKER}
    assert audiences == [[WORKER]]


def test_configured_worker_url_is_also_accepted(audiences: list[Any], monkeypatch: pytest.MonkeyPatch) -> None:
    use_settings(monkeypatch, worker_url="https://atrium-worker-123.us-central1.run.app/")
    client().post("/internal/ping", headers={"Authorization": "Bearer invoker"})
    assert audiences == [[WORKER, "https://atrium-worker-123.us-central1.run.app"]]


def test_worker_rejects_missing_forged_and_foreign_tokens(
    audiences: list[Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    use_settings(monkeypatch, worker_url="")
    c = client()
    assert c.post("/internal/ping").status_code == 401
    assert c.post("/internal/ping", headers={"Authorization": "Bearer forged"}).status_code == 401
    assert c.post("/internal/ping", headers={"Authorization": "Bearer other-account"}).status_code == 403
