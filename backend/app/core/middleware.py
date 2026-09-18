"""ASGI middleware: request context and request-size limits.

Implemented as plain ASGI (not BaseHTTPMiddleware) so it also wraps
WebSocket connections and never buffers streaming bodies.
"""

from __future__ import annotations

import re
import uuid
from collections.abc import Awaitable, Callable, MutableMapping
from typing import Any

from app.core.errors import PayloadTooLarge, problem
from app.core.logging import parse_cloud_trace_header, request_id_var, trace_var

Scope = MutableMapping[str, Any]
Message = MutableMapping[str, Any]
Receive = Callable[[], Awaitable[Message]]
Send = Callable[[Message], Awaitable[None]]
ASGIApp = Callable[[Scope, Receive, Send], Awaitable[None]]

REQUEST_ID = re.compile(r"[A-Za-z0-9._-]{8,64}")


def _header(scope: Scope, name: bytes) -> str | None:
    for key, value in scope.get("headers", ()):
        if key == name:
            return str(value.decode("latin-1"))
    return None


class RequestContextMiddleware:
    """Assigns a request ID, binds trace context for logs, and echoes X-Request-Id."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] not in ("http", "websocket"):
            await self.app(scope, receive, send)
            return

        incoming = _header(scope, b"x-request-id")
        request_id = incoming if incoming and REQUEST_ID.fullmatch(incoming) else uuid.uuid4().hex
        rid_token = request_id_var.set(request_id)
        trace_token = trace_var.set(parse_cloud_trace_header(_header(scope, b"x-cloud-trace-context")))

        async def send_with_id(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = list(message.get("headers", []))
                headers.append((b"x-request-id", request_id.encode()))
                message["headers"] = headers
            await send(message)

        try:
            await self.app(scope, receive, send_with_id)
        finally:
            request_id_var.reset(rid_token)
            trace_var.reset(trace_token)


class BodySizeLimitMiddleware:
    """Rejects HTTP bodies above a per-route limit, by header and while streaming.

    `limits` maps path prefixes to byte limits; the longest matching prefix wins.
    """

    def __init__(self, app: ASGIApp, default_limit: int, limits: dict[str, int] | None = None) -> None:
        self.app = app
        self.default_limit = default_limit
        self.limits = sorted((limits or {}).items(), key=lambda kv: len(kv[0]), reverse=True)

    def _limit_for(self, path: str) -> int:
        for prefix, limit in self.limits:
            if path.startswith(prefix):
                return limit
        return self.default_limit

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        limit = self._limit_for(scope.get("path", ""))
        declared = _header(scope, b"content-length")
        if declared is not None and (not declared.isdigit() or int(declared) > limit):
            await self._reject(scope, receive, send)
            return

        received = 0
        response_started = False
        rejected = False

        async def limited_receive() -> Message:
            # Frameworks catch exceptions raised while reading the body and turn them
            # into generic 400s, so the 413 is sent from here and the app then sees a
            # client disconnect; anything it tries to send afterwards is dropped.
            nonlocal received, rejected
            if rejected:
                return {"type": "http.disconnect"}
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > limit:
                    rejected = True
                    if not response_started:
                        await self._reject(scope, receive, send)
                    return {"type": "http.disconnect"}
            return message

        async def tracking_send(message: Message) -> None:
            nonlocal response_started
            if rejected:
                return
            if message["type"] == "http.response.start":
                response_started = True
            await send(message)

        try:
            await self.app(scope, limited_receive, tracking_send)
        except Exception:
            if not rejected:
                raise

    @staticmethod
    async def _reject(scope: Scope, receive: Receive, send: Send) -> None:
        response = problem(PayloadTooLarge.status, PayloadTooLarge.code, PayloadTooLarge.title)
        await response(scope, receive, send)
