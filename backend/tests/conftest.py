from __future__ import annotations

import os
from collections.abc import Iterator

import pytest

TEST_ENV = {
    "APP_ENV": "test",
    "ROLE": "api",
    "GOOGLE_CLOUD_PROJECT": "demo-atrium",
    "USER_CONTENT_BUCKET": "demo-atrium-user-content",
    "PROCESSING_BUCKET": "demo-atrium-processing",
    "AI_PROVIDER": "fake",
    "APP_CHECK_ENFORCED": "false",
    "ALLOWED_ORIGINS": "http://localhost:5173,capacitor://localhost",
}

for key, value in TEST_ENV.items():
    os.environ.setdefault(key, value)


@pytest.fixture(autouse=True)
def _fresh_settings(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    from app.core.settings import get_settings

    for key, value in TEST_ENV.items():
        monkeypatch.setenv(key, value)
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()
