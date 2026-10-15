"""Application factory. One image serves two Cloud Run services:

- ROLE=api: public HTTPS + WebSocket API for the apps (Firebase-authenticated).
- ROLE=worker: private endpoints invoked only by Cloud Tasks, Scheduler and
  Pub/Sub with OIDC tokens.

Run locally with: uvicorn app.main:create_app --factory
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.errors import install_error_handlers
from app.core.logging import configure_logging
from app.core.middleware import BodySizeLimitMiddleware, RequestContextMiddleware
from app.core.settings import AiProvider, Env, Role, Settings, get_settings
from app.core.tracing import configure_tracing
from app.modules.registry import registry

API_PREFIX = "/api/v1"


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings.google_cloud_project, settings.log_level, settings.analytics_salt.get_secret_value())

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        if settings.role is Role.API and settings.ai_provider is not AiProvider.FAKE:
            # Load the live model stack now, not inside the first interview (it holds the loop for seconds).
            warmup = asyncio.create_task(asyncio.to_thread(_warm_live_stack))
            warmup.add_done_callback(lambda task: task.exception())
        yield

    # Only on a developer's machine: the app's users are served by APP_ENV=dev (atrium-coach-app), so
    # "not prod" would publish the whole API map to anyone.
    public_docs = settings.app_env in (Env.LOCAL, Env.TEST) and settings.role is Role.API
    app = FastAPI(
        title=f"Atrium {settings.role.value}",
        version="1.0.0",
        lifespan=lifespan,
        docs_url="/docs" if public_docs else None,
        redoc_url=None,
        openapi_url="/openapi.json" if public_docs else None,
    )
    install_error_handlers(app)

    @app.get("/health", include_in_schema=False)
    async def health() -> dict[str, str]:
        return {"status": "ok", "role": settings.role.value}

    if settings.role is Role.API:
        for router in registry.api_routers():
            app.include_router(router, prefix=API_PREFIX)
    else:
        for router in registry.worker_routers():
            app.include_router(router)

    # Added innermost first: RequestContext → CORS → body limit → routes.
    app.add_middleware(
        BodySizeLimitMiddleware,
        default_limit=settings.max_json_bytes,
        limits={
            f"{API_PREFIX}/interview/resumes": settings.max_resume_bytes + 64_000,
            # Oral exam study material: slides, chapters and scanned papers, uploaded per course.
            # Prefix matching can't name the `{courseId}/materials` segment, so the course routes
            # share the allowance; their own bodies are bounded by the schemas behind it.
            f"{API_PREFIX}/exam/courses": settings.max_material_bytes + 64_000,
            # Practice Center rounds: up to 8 MB of recorded audio (see modules/practice/api.py).
            f"{API_PREFIX}/practice/rounds": 8 * 1_048_576 + 64_000,
            # Face and body measurements: one entry a second with pose samples, for up to a 65-minute round.
            # Prefix matching can't name the `{id}/media/face-metrics` segment, so the session routes share
            # the allowance; their own bodies are bounded by the schemas behind it.
            f"{API_PREFIX}/sessions": 4 * 1_048_576,
            # Local development only: video chunks sent to the stand-in for Cloud Storage uploads.
            f"{API_PREFIX}/local-uploads": 16 * 1_048_576,
        },
    )
    if settings.role is Role.API and settings.allowed_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.allowed_origins,
            allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
            allow_headers=["Authorization", "Content-Type", "X-Firebase-AppCheck", "X-Request-Id", "If-Match"],
            expose_headers=["X-Request-Id", "ETag", "Retry-After"],
            max_age=600,
        )
    app.add_middleware(RequestContextMiddleware)
    configure_tracing(app, settings)
    return app


def _warm_live_stack() -> None:
    try:
        from app.platform.agents.live_adk import warm_up

        warm_up()
    except Exception:  # best effort: an interview still works, just starts slower
        logging.getLogger(__name__).warning("live stack warm-up failed", exc_info=True)
