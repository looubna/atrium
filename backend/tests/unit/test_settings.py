from __future__ import annotations

from typing import Any

import pytest
from pydantic import ValidationError

from app.core.settings import AiProvider, Env, Settings

# Explicit values so the test process environment (AI_PROVIDER=fake, ...) doesn't leak in.
BASE: dict[str, Any] = {
    "ai_provider": "vertex",
    "app_check_enforced": True,
    "app_env": "dev",
    "google_cloud_project": "atrium-coach-dev",
    "user_content_bucket": "atrium-coach-dev-user-content",
    "processing_bucket": "atrium-coach-dev-processing",
    "analytics_salt": "x" * 32,
    "worker_url": "https://atrium-worker-123456789.us-central1.run.app",
}


def make(**overrides: Any) -> Settings:
    return Settings(**{**BASE, **overrides})


def test_valid_dev_configuration() -> None:
    s = make()
    assert s.app_env is Env.DEV
    assert s.ai_project == "atrium-coach-dev"


def test_dev_cannot_use_production_project() -> None:
    with pytest.raises(ValidationError, match="may not use project"):
        make(google_cloud_project="atrium-coach-prod")


def test_non_prod_cannot_reference_production_buckets() -> None:
    with pytest.raises(ValidationError, match="production resource"):
        make(user_content_bucket="atrium-coach-prod-user-content")


def test_local_cannot_bill_ai_to_production() -> None:
    with pytest.raises(ValidationError):
        make(app_env="local", google_cloud_project="demo-atrium", vertex_project="atrium-coach-prod")


def test_test_env_cannot_call_vertex() -> None:
    with pytest.raises(ValidationError, match="may not bill AI calls"):
        make(app_env="test", google_cloud_project="demo-atrium", ai_provider="vertex")
    assert make(app_env="test", google_cloud_project="demo-atrium", ai_provider="fake").ai_provider is (
        AiProvider.FAKE
    )


def test_prod_requires_app_check_and_vertex() -> None:
    prod = {
        "app_env": "prod",
        "google_cloud_project": "atrium-coach-prod",
        "user_content_bucket": "atrium-coach-prod-user-content",
        "processing_bucket": "atrium-coach-prod-processing",
    }
    with pytest.raises(ValidationError, match="App Check"):
        make(**prod, app_check_enforced=False)
    with pytest.raises(ValidationError, match="Vertex"):
        make(**prod, ai_provider="fake")
    assert make(**prod).app_env is Env.PROD


def test_deployed_env_requires_analytics_salt() -> None:
    with pytest.raises(ValidationError, match="ANALYTICS_SALT"):
        make(analytics_salt="")


def test_deployed_env_requires_worker_url() -> None:
    # Without it the worker can't queue a pipeline's next step and feedback never finishes.
    with pytest.raises(ValidationError, match="WORKER_URL"):
        make(worker_url="")
    with pytest.raises(ValidationError, match="WORKER_URL"):
        make(worker_url="/internal")
    assert make(app_env="test", google_cloud_project="demo-atrium", ai_provider="fake", worker_url="").worker_url == ""


def test_origins_are_split_from_env_string(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ALLOWED_ORIGINS", "capacitor://localhost, http://localhost:5173")
    s = Settings()  # type: ignore[call-arg]
    assert s.allowed_origins == ["capacitor://localhost", "http://localhost:5173"]
