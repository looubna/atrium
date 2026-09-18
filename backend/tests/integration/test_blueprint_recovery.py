"""A journey generation never stays stuck: failures re-queue, and abandoned generations are reclaimed."""

from __future__ import annotations

from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
import pytest_asyncio
from google.cloud import firestore

from app.modules.interview.agents import strategist as strategist_module
from app.modules.interview.agents.strategist import InterviewStrategist
from app.modules.interview.tasks import generate_blueprint
from app.platform import runtime_config
from app.platform.ai.gateway import ModelBusy
from app.platform.jobs.module_tasks import RetryableTaskError

UID, APP, BLUEPRINT = "alice", "app00000001", "bp000000001"
PAYLOAD = {"uid": UID, "applicationId": APP, "blueprintId": BLUEPRINT}
PATH = f"users/{UID}/applications/{APP}/blueprints/{BLUEPRINT}"


@pytest_asyncio.fixture
async def store(db: firestore.AsyncClient) -> AsyncIterator[firestore.AsyncClient]:
    runtime_config.reset_cache()
    await db.document(f"users/{UID}/applications/{APP}").set(
        {"company": "Acme Payments", "roleTitle": "Backend Engineer", "location": "", "jobDescription": "Build APIs.",
         "resumeId": None, "status": "researching"}
    )
    yield db


async def seed_blueprint(db: firestore.AsyncClient, **fields: Any) -> None:
    await db.document(PATH).set({"version": 1, "source": "agent", "attempts": 0, "createdAt": datetime.now(UTC),
                                 **fields})


async def blueprint(db: firestore.AsyncClient) -> dict[str, Any]:
    return (await db.document(PATH).get()).to_dict() or {}


async def test_generation_abandoned_mid_way_is_reclaimed(store: firestore.AsyncClient) -> None:
    await seed_blueprint(store, status="researching", startedAt=datetime.now(UTC) - timedelta(minutes=20))
    await generate_blueprint(PAYLOAD)
    done = await blueprint(store)
    assert done["status"] == "ready"
    assert done["progress"]["stage"] == "done"


async def test_generation_still_running_is_left_alone(store: firestore.AsyncClient) -> None:
    await seed_blueprint(store, status="researching", startedAt=datetime.now(UTC) - timedelta(minutes=2))
    await generate_blueprint(PAYLOAD)
    current = await blueprint(store)
    assert current["status"] == "researching"
    assert "rounds" not in current


async def test_retry_reuses_research_from_the_failed_attempt(
    store: firestore.AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls = {"research": 0, "generate": 0}
    real_research, real_generate = strategist_module.gateway.research, strategist_module.gateway.generate

    async def counting_research(**kwargs: Any) -> Any:
        calls["research"] += 1
        return await real_research(**kwargs)

    async def busy_once(**kwargs: Any) -> Any:
        calls["generate"] += 1
        if calls["generate"] == 1:
            raise ModelBusy("blueprint: model busy")
        return await real_generate(**kwargs)

    monkeypatch.setattr(strategist_module.gateway, "research", counting_research)
    monkeypatch.setattr(strategist_module.gateway, "generate", busy_once)
    await seed_blueprint(store, status="queued")
    with pytest.raises(RetryableTaskError):
        await generate_blueprint(PAYLOAD)
    assert (await blueprint(store))["research"]["sources"][0]["domain"] == "careers.example.com"

    await generate_blueprint(PAYLOAD)
    done = await blueprint(store)
    assert done["status"] == "ready"
    assert calls == {"research": 1, "generate": 2}


async def test_unexpected_failure_requeues_then_gives_up(
    store: firestore.AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def overloaded(self: InterviewStrategist, **kwargs: Any) -> dict[str, Any]:
        raise RuntimeError("429 RESOURCE_EXHAUSTED")

    monkeypatch.setattr(InterviewStrategist, "generate", overloaded)
    await seed_blueprint(store, status="queued")
    with pytest.raises(RetryableTaskError):
        await generate_blueprint(PAYLOAD)
    retried = await blueprint(store)
    assert retried["status"] == "queued" and retried["attempts"] == 1

    await store.document(PATH).update({"attempts": 2})
    await generate_blueprint(PAYLOAD)  # third attempt: no more retries
    failed = await blueprint(store)
    assert failed["status"] == "failed" and failed["failureReason"] == "RuntimeError"
