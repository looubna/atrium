from __future__ import annotations

import json
import logging

from app.core.logging import (
    CloudJsonFormatter,
    parse_cloud_trace_header,
    redact,
    redact_text,
    request_id_var,
    trace_var,
)

JWT = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1c2VyMTIzNCJ9.c2lnbmF0dXJlLXZhbHVl"


def test_redacts_tokens_emails_and_signatures() -> None:
    text = f"Bearer abc.def token {JWT} for jane.doe@example.com at https://x?X-Goog-Signature=abcd&y=1"
    out = redact_text(text)
    assert JWT not in out
    assert "jane.doe@example.com" not in out
    assert "abcd" not in out
    assert "Bearer [redacted]" in out


def test_redacts_sensitive_keys_recursively() -> None:
    data = {"sessionId": "s1", "resumeText": "my whole resume", "nested": {"prompt": "secret"}, "count": 3}
    out = redact(data)
    assert out["sessionId"] == "s1"
    assert out["resumeText"] == "[redacted]"
    assert out["nested"]["prompt"] == "[redacted]"
    assert out["count"] == 3


def test_formatter_emits_cloud_logging_fields() -> None:
    formatter = CloudJsonFormatter("demo-atrium")
    rid = request_id_var.set("req-12345678")
    trace = trace_var.set(("a" * 32, "123"))
    try:
        record = logging.LogRecord("t", logging.INFO, __file__, 1, "hello %s", ("world",), None)
        record.transcript = "never logged"
        entry = json.loads(formatter.format(record))
    finally:
        request_id_var.reset(rid)
        trace_var.reset(trace)
    assert entry["severity"] == "INFO"
    assert entry["message"] == "hello world"
    assert entry["requestId"] == "req-12345678"
    assert entry["logging.googleapis.com/trace"] == f"projects/demo-atrium/traces/{'a' * 32}"
    assert entry["data"]["transcript"] == "[redacted]"


def test_parse_trace_header() -> None:
    assert parse_cloud_trace_header(f"{'b' * 32}/42;o=1") == ("b" * 32, "42")
    assert parse_cloud_trace_header("not-a-trace") is None
    assert parse_cloud_trace_header(None) is None
