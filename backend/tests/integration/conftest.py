"""Integration tests against the Firestore emulator.

Run with:
  ../firebase/node_modules/.bin/firebase emulators:exec --config ../firebase/firebase.json \
    --project demo-atrium --only firestore "uv run pytest tests/integration"
"""

from __future__ import annotations

import os
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Annotated

import httpx
import pytest
import pytest_asyncio
from fastapi import Header
from google.cloud import firestore

from app.core.errors import Unauthorized
from app.platform.auth import dependencies as deps
from app.platform.auth.dependencies import AuthUser
from app.platform.clients import clients

EMULATOR = os.environ.get("FIRESTORE_EMULATOR_HOST")
PROJECT = "demo-atrium"


def pytest_collection_modifyitems(config: pytest.Config, items: list[pytest.Item]) -> None:
    here = Path(__file__).parent
    for item in items:
        if here in Path(str(item.fspath)).parents:
            item.add_marker(pytest.mark.emulator)
            if not EMULATOR:
                item.add_marker(pytest.mark.skip(reason="FIRESTORE_EMULATOR_HOST not set"))


async def fake_user(authorization: Annotated[str | None, Header()] = None) -> AuthUser:
    """`Authorization: Bearer test:<uid>[:password][:unverified]` — identity for tests only."""
    if not authorization or not authorization.startswith("Bearer test:"):
        raise Unauthorized()
    uid, *flags = authorization.removeprefix("Bearer test:").split(":")
    return AuthUser(
        uid=uid,
        email_verified="unverified" not in flags,
        sign_in_provider="password" if "password" in flags else "apple.com",
        auth_time=0,
    )


def as_user(uid: str, *flags: str) -> dict[str, str]:
    return {"Authorization": ":".join(["Bearer test", uid, *flags])}


@pytest_asyncio.fixture
async def db() -> AsyncIterator[firestore.AsyncClient]:
    async with httpx.AsyncClient() as http:
        await http.delete(f"http://{EMULATOR}/emulator/v1/projects/{PROJECT}/databases/(default)/documents")
    client = firestore.AsyncClient(project=PROJECT)
    clients.overrides["firestore"] = client
    try:
        yield client
    finally:
        clients.overrides.pop("firestore", None)
        client.close()


@pytest_asyncio.fixture
async def api(db: firestore.AsyncClient) -> AsyncIterator[httpx.AsyncClient]:
    from app.main import create_app

    app = create_app()
    app.dependency_overrides[deps._current_user] = fake_user
    app.dependency_overrides[deps._current_user_strict] = fake_user
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        yield client
