from __future__ import annotations

import logging
from typing import Any

import httpx
import pytest
from pydantic import BaseModel

from app.core.settings import Settings
from app.platform.ai import gateway


class Draft(BaseModel):
    answer: str


def nebius_settings(**overrides: Any) -> Settings:
    return Settings(
        app_env="local",
        google_cloud_project="demo-atrium",
        vertex_project="atrium-coach-dev",
        user_content_bucket="demo-atrium-user-content",
        processing_bucket="demo-atrium-processing",
        ai_provider="vertex",
        nebius_text_enabled=True,
        nebius_api_key="unit-test-secret",
        **overrides,
    )


@pytest.mark.parametrize(
    "purpose",
    [gateway.Purpose.BLUEPRINT, gateway.Purpose.RESUME_PROFILE, gateway.Purpose.ROUND_PREP],
)
def test_routes_supported_interview_purposes_to_nebius(purpose: gateway.Purpose) -> None:
    settings = nebius_settings()

    assert gateway.uses_nebius(purpose, settings)
    assert gateway.nebius_attribution(purpose, settings) == {
        "provider": "Nebius Token Factory",
        "model": "nvidia/Nemotron-3_5-Lightning",
    }


def test_keeps_tool_and_media_calls_on_existing_provider() -> None:
    settings = nebius_settings()

    assert not gateway.uses_nebius(gateway.Purpose.BLUEPRINT, settings, tools=[object()])
    assert not gateway.uses_nebius(
        gateway.Purpose.BLUEPRINT,
        settings,
        media=[gateway.MediaRef(uri="gs://bucket/audio.wav", mime_type="audio/wav")],
    )
    assert not gateway.uses_nebius(gateway.Purpose.PRACTICE_COACH, settings)


@pytest.mark.asyncio
async def test_nebius_request_validates_output_and_does_not_log_content_or_key(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    settings = nebius_settings(nebius_base_url="https://token.factory.test/v1/")
    user_content = "Synthetic interview prompt with no personal information."
    request: dict[str, Any] = {}
    recorded: list[dict[str, object]] = []

    class Response:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict[str, object]:
            return {
                "choices": [{"message": {"content": '{"answer":"Practice a concise example."}'}}],
                "usage": {"prompt_tokens": 15, "completion_tokens": 5, "total_tokens": 20},
            }

    class Client:
        def __init__(self, **_: Any) -> None:
            pass

        async def __aenter__(self) -> Client:
            return self

        async def __aexit__(self, *args: object) -> None:
            return None

        async def post(self, url: str, *, headers: dict[str, str], json: dict[str, Any]) -> Response:
            request.update(url=url, headers=headers, json=json)
            return Response()

    class UsageRecorder:
        def __init__(self, _: object) -> None:
            pass

        async def record(self, uid: str, values: dict[gateway.Metric, int], *, period: gateway.Period) -> None:
            recorded.append({"uid": uid, "values": values, "period": period})

    monkeypatch.setattr(httpx, "AsyncClient", Client)
    monkeypatch.setattr(gateway, "UsageService", UsageRecorder)
    monkeypatch.setattr(gateway.clients, "firestore", lambda: object())

    with caplog.at_level(logging.INFO):
        result = await gateway._generate_nebius(
            purpose=gateway.Purpose.ROUND_PREP,
            uid="unit-test-user",
            instruction="Write a short interview preparation answer.",
            content=user_content,
            schema=Draft,
            settings=settings,
        )

    assert result == Draft(answer="Practice a concise example.")
    assert request["url"] == "https://token.factory.test/v1/chat/completions"
    assert request["headers"]["Authorization"] == "Bearer unit-test-secret"
    assert request["json"]["model"] == "nvidia/Nemotron-3_5-Lightning"
    assert request["json"]["response_format"] == {"type": "json_object"}
    assert request["json"]["chat_template_kwargs"] == {"enable_thinking": False}
    assert recorded and recorded[0]["uid"] == "unit-test-user"
    assert user_content not in caplog.text
    assert "unit-test-secret" not in caplog.text
