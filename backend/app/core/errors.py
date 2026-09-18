"""Consistent API errors as RFC 9457 problem details.

Error responses never echo request values, stack traces or internal messages;
they carry a stable `code` for clients and the `requestId` for support.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.logging import request_id_var

log = logging.getLogger(__name__)

PROBLEM_JSON = "application/problem+json"


class AppError(Exception):
    status: int = 500
    code: str = "internal_error"
    title: str = "Something went wrong"

    def __init__(self, detail: str | None = None, *, extra: dict[str, Any] | None = None) -> None:
        super().__init__(detail or self.title)
        self.detail = detail
        self.extra = extra or {}


class BadRequest(AppError):
    status, code, title = 400, "bad_request", "The request is invalid"


class Unauthorized(AppError):
    status, code, title = 401, "unauthenticated", "Sign in to continue"


class Forbidden(AppError):
    status, code, title = 403, "forbidden", "You don't have access to this"


class NotFound(AppError):
    status, code, title = 404, "not_found", "Not found"


class Conflict(AppError):
    status, code, title = 409, "conflict", "The resource changed or already exists"


class PreconditionFailed(AppError):
    status, code, title = 412, "precondition_failed", "The resource was modified by someone else"


class PayloadTooLarge(AppError):
    status, code, title = 413, "payload_too_large", "The request is too large"


class UnsupportedMedia(AppError):
    status, code, title = 415, "unsupported_media_type", "This file type is not supported"


class ValidationFailed(AppError):
    status, code, title = 422, "validation_failed", "Some fields are invalid"


class RateLimited(AppError):
    status, code, title = 429, "rate_limited", "Too many requests, try again shortly"


class QuotaExceeded(AppError):
    status, code, title = 429, "quota_exceeded", "You've reached your usage limit"


class ConsentRequired(AppError):
    status, code, title = 403, "consent_required", "Consent is required before using this feature"


class ServiceUnavailable(AppError):
    status, code, title = 503, "unavailable", "This feature is temporarily unavailable"


def problem(status: int, code: str, title: str, detail: str | None = None, **extra: Any) -> JSONResponse:
    body: dict[str, Any] = {
        "type": f"https://atrium.app/problems/{code}",
        "title": title,
        "status": status,
        "code": code,
    }
    if detail:
        body["detail"] = detail
    if (rid := request_id_var.get()) is not None:
        body["requestId"] = rid
    body.update(extra)
    headers = {"Retry-After": str(extra["retryAfter"])} if "retryAfter" in extra else None
    return JSONResponse(body, status_code=status, media_type=PROBLEM_JSON, headers=headers)


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def _app_error(_: Request, exc: AppError) -> JSONResponse:
        if exc.status >= 500:
            log.error("app error", exc_info=exc)
        return problem(exc.status, exc.code, exc.title, exc.detail, **exc.extra)

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, exc: RequestValidationError) -> JSONResponse:
        # Report where and why, never the submitted value.
        errors = [
            {"loc": [str(p) for p in e.get("loc", ())], "type": e.get("type"), "msg": e.get("msg")}
            for e in exc.errors()
        ]
        return problem(422, ValidationFailed.code, ValidationFailed.title, errors=errors)

    @app.exception_handler(StarletteHTTPException)
    async def _http(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        code = {404: "not_found", 405: "method_not_allowed"}.get(exc.status_code, "http_error")
        return problem(exc.status_code, code, "Request failed")

    @app.exception_handler(Exception)
    async def _unhandled(_: Request, exc: Exception) -> JSONResponse:
        log.error("unhandled exception", exc_info=exc)
        return problem(500, AppError.code, AppError.title)
