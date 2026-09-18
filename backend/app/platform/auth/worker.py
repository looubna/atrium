"""Authentication for the private worker endpoints.

Cloud Run already rejects calls without `run.invoker`; the worker additionally
verifies the Google-signed OIDC token itself: the audience must be the worker's
URL and the caller must be the dedicated invoker service account (used by Cloud
Tasks, Cloud Scheduler and Pub/Sub push).
"""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import Depends, Header, Request
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token
from starlette.concurrency import run_in_threadpool

from app.core.errors import Forbidden, Unauthorized
from app.core.settings import Env, get_settings

_transport = google_requests.Request()


def _expected_audiences(request: Request, configured_url: str) -> list[str]:
    """Tokens are minted for the worker's URL. A Cloud Run service can't be configured with its own
    URL (and answers on more than one), so the URL this request was addressed to is accepted as well:
    Cloud Run only routes the service's own hostnames to it."""
    audiences = [f"https://{host}" for host in [request.headers.get("host")] if host]
    if configured_url:
        audiences.append(configured_url.rstrip("/"))
    return audiences


async def _verify_invoker(request: Request, authorization: Annotated[str | None, Header()] = None) -> str:
    settings = get_settings()
    if settings.app_env in (Env.LOCAL, Env.TEST):
        # Local and test workers are only reachable from the developer's machine or tests.
        return "local-invoker"
    if not authorization or not authorization.lower().startswith("bearer "):
        raise Unauthorized()
    token = authorization.split(" ", 1)[1]
    audiences = _expected_audiences(request, settings.worker_url)
    if not audiences:
        raise Unauthorized()
    try:
        claims: dict[str, Any] = await run_in_threadpool(
            id_token.verify_oauth2_token, token, _transport, audiences
        )
    except ValueError as exc:
        raise Unauthorized() from exc
    if claims.get("email") != settings.tasks_invoker_sa or not claims.get("email_verified"):
        raise Forbidden()
    return str(claims["email"])


worker_caller = Annotated[str, Depends(_verify_invoker)]
