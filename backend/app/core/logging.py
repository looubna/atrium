"""Structured JSON logging for Cloud Logging, with request context and redaction.

Logs carry correlation IDs (requestId, uid, sessionId, jobId, step) and the
Cloud Trace field so entries group under their trace. Sensitive values are
removed before a record is written: authorization material, emails, and any
field whose name suggests user content (resume, transcript, prompt, ...).
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
import sys
from contextvars import ContextVar
from datetime import UTC, datetime
from typing import Any

from opentelemetry import trace as otel_trace

request_id_var: ContextVar[str | None] = ContextVar("request_id", default=None)
uid_var: ContextVar[str | None] = ContextVar("uid", default=None)
session_id_var: ContextVar[str | None] = ContextVar("session_id", default=None)
job_id_var: ContextVar[str | None] = ContextVar("job_id", default=None)
step_var: ContextVar[str | None] = ContextVar("step", default=None)
trace_var: ContextVar[tuple[str, str | None] | None] = ContextVar("trace", default=None)

SENSITIVE_KEYS = re.compile(
    r"(authorization|token|password|secret|api[_-]?key|cookie|email|resume|transcript|prompt|"
    r"job_?description|answer|content|text|handle|signed_?url|upload_?url)",
    re.IGNORECASE,
)
JWT = re.compile(r"eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}")
BEARER = re.compile(r"(?i)bearer\s+[A-Za-z0-9._~+/=-]+")
EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
SIGNATURE = re.compile(r"(?i)(x-goog-signature|upload_id)=[^&\s]+")

_RESERVED = set(logging.LogRecord("", 0, "", 0, "", (), None).__dict__) | {"message", "asctime"}


def redact_text(value: str) -> str:
    value = JWT.sub("[redacted-jwt]", value)
    value = BEARER.sub("Bearer [redacted]", value)
    value = EMAIL.sub("[redacted-email]", value)
    return SIGNATURE.sub(r"\1=[redacted]", value)


def redact(value: Any, key: str | None = None) -> Any:
    if key is not None and SENSITIVE_KEYS.search(key):
        return "[redacted]"
    if isinstance(value, str):
        return redact_text(value)
    if isinstance(value, dict):
        return {k: redact(v, str(k)) for k, v in value.items()}
    if isinstance(value, list | tuple):
        return [redact(v) for v in value]
    return value


class CloudJsonFormatter(logging.Formatter):
    """Logs carry a salted hash of the uid, never the uid itself (logs also feed BigQuery)."""

    def __init__(self, project_id: str, uid_salt: str = "") -> None:
        super().__init__()
        self.project_id = project_id
        self.uid_salt = uid_salt

    def format(self, record: logging.LogRecord) -> str:
        entry: dict[str, Any] = {
            "severity": record.levelname,
            "message": redact_text(record.getMessage()),
            "time": datetime.fromtimestamp(record.created, UTC).isoformat(),
            "logger": record.name,
        }
        if (uid := uid_var.get()) is not None:
            entry["uidHash"] = hashlib.sha256(f"{self.uid_salt}:{uid}".encode()).hexdigest()[:16]
        for name, var in (
            ("requestId", request_id_var),
            ("sessionId", session_id_var),
            ("jobId", job_id_var),
            ("step", step_var),
        ):
            if (v := var.get()) is not None:
                entry[name] = v
        if (trace := trace_var.get() or _active_span()) is not None:
            trace_id, span_id = trace
            entry["logging.googleapis.com/trace"] = f"projects/{self.project_id}/traces/{trace_id}"
            if span_id:
                entry["logging.googleapis.com/spanId"] = span_id
        extras = {k: v for k, v in record.__dict__.items() if k not in _RESERVED and not k.startswith("_")}
        if extras:
            entry["data"] = redact(extras)
        if record.exc_info:
            # Stack traces let Error Reporting group failures; exception messages are redacted.
            entry["stack_trace"] = redact_text(self.formatException(record.exc_info))
        return json.dumps(entry, default=str)


def _active_span() -> tuple[str, str | None] | None:
    """Trace context of the current OpenTelemetry span, for jobs without an incoming trace header."""
    ctx = otel_trace.get_current_span().get_span_context()
    if not ctx.is_valid:
        return None
    return f"{ctx.trace_id:032x}", f"{ctx.span_id:016x}"


def configure_logging(project_id: str, level: str = "INFO", uid_salt: str = "") -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(CloudJsonFormatter(project_id, uid_salt))
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(level.upper())
    for noisy in ("uvicorn.access", "httpx", "google.auth", "urllib3"):
        logging.getLogger(noisy).setLevel(logging.WARNING)


def parse_cloud_trace_header(header: str | None) -> tuple[str, str | None] | None:
    """X-Cloud-Trace-Context: TRACE_ID/SPAN_ID;o=1"""
    if not header:
        return None
    trace, _, rest = header.partition("/")
    if not re.fullmatch(r"[0-9a-f]{32}", trace):
        return None
    span = rest.split(";", 1)[0] or None
    return trace, span
