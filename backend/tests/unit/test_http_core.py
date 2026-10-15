from __future__ import annotations

from collections.abc import Iterator
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import BaseModel, Field

from app.core.errors import NotFound, install_error_handlers
from app.core.middleware import BodySizeLimitMiddleware, RequestContextMiddleware


class Payload(BaseModel):
    name: str = Field(max_length=5)


def build_app() -> FastAPI:
    app = FastAPI()
    install_error_handlers(app)

    @app.post("/echo")
    async def echo(p: Payload) -> dict[str, Any]:
        return {"name": p.name}

    @app.post("/upload")
    async def upload(body: dict[str, Any]) -> dict[str, int]:
        return {"keys": len(body)}

    @app.get("/missing")
    async def missing() -> None:
        raise NotFound()

    @app.get("/boom")
    async def boom() -> None:
        raise RuntimeError("database password is hunter2")

    app.add_middleware(BodySizeLimitMiddleware, default_limit=64, limits={"/upload": 1024})
    app.add_middleware(RequestContextMiddleware)
    return app


@pytest.fixture
def client() -> Iterator[TestClient]:
    with TestClient(build_app(), raise_server_exceptions=False) as c:
        yield c


def test_problem_details_for_app_errors(client: TestClient) -> None:
    r = client.get("/missing")
    assert r.status_code == 404
    assert r.headers["content-type"].startswith("application/problem+json")
    body = r.json()
    assert body["code"] == "not_found"
    assert body["requestId"] == r.headers["x-request-id"]


def test_validation_errors_do_not_echo_input(client: TestClient) -> None:
    r = client.post("/echo", json={"name": "sensitive-value"})
    assert r.status_code == 422
    assert "sensitive-value" not in r.text
    assert r.json()["errors"][0]["loc"] == ["body", "name"]


def test_unhandled_errors_do_not_leak_details(client: TestClient) -> None:
    r = client.get("/boom")
    assert r.status_code == 500
    assert "hunter2" not in r.text
    assert r.json()["code"] == "internal_error"


def test_request_id_is_propagated_when_valid(client: TestClient) -> None:
    r = client.get("/missing", headers={"X-Request-Id": "client-req-0001"})
    assert r.headers["x-request-id"] == "client-req-0001"
    r = client.get("/missing", headers={"X-Request-Id": "bad id with spaces"})
    assert r.headers["x-request-id"] != "bad id with spaces"


def test_body_limit_by_content_length(client: TestClient) -> None:
    r = client.post("/echo", content=b'{"name":"' + b"a" * 100 + b'"}', headers={"content-type": "application/json"})
    assert r.status_code == 413
    assert r.json()["code"] == "payload_too_large"


def test_body_limit_per_route_prefix(client: TestClient) -> None:
    body = {f"k{i}": "v" for i in range(20)}
    assert client.post("/upload", json=body).status_code == 200


def test_body_limit_while_streaming(client: TestClient) -> None:
    def chunks() -> Iterator[bytes]:
        yield b'{"name":"'
        yield b"a" * 200
        yield b'"}'

    r = client.post("/echo", content=chunks(), headers={"content-type": "application/json"})
    assert r.status_code == 413


def test_every_upload_route_may_actually_carry_its_file() -> None:
    """A route that accepts a file must be allowed a body that size.

    The middleware's default is the JSON limit (1 MiB), so an upload route missing from
    the table is rejected long before its own limit applies — a PDF of a few pages fails
    with "file is too large" whatever the route allows.
    """
    from app.core.settings import get_settings
    from app.main import API_PREFIX, create_app

    settings = get_settings()
    limits = dict(
        next(
            m.kwargs["limits"]
            for m in create_app(settings).user_middleware
            if m.cls is BodySizeLimitMiddleware
        )
    )
    uploads = {
        f"{API_PREFIX}/interview/resumes": settings.max_resume_bytes,
        f"{API_PREFIX}/exam/courses": settings.max_material_bytes,
    }
    for prefix, file_bytes in uploads.items():
        assert prefix in limits, f"{prefix} accepts a file but has no body limit of its own"
        assert limits[prefix] > file_bytes, prefix


def test_the_api_map_is_only_published_on_a_developer_machine() -> None:
    """The app's real users are on APP_ENV=dev (atrium-coach-app): /docs there would show anyone every route."""
    from app.core.settings import Env, get_settings
    from app.main import create_app

    def paths(env: Env) -> set[str]:
        app = create_app(get_settings().model_copy(update={"app_env": env}))
        return {getattr(r, "path", "") for r in app.routes}

    assert "/docs" in paths(Env.LOCAL)
    for env in (Env.DEV, Env.STAGING, Env.PROD):
        assert not {"/docs", "/openapi.json"} & paths(env), env
