"""OpenTelemetry tracing to Cloud Trace.

ADK registers the global tracer provider with Google Cloud exporters; FastAPI
spans and ADK agent/model spans then share one provider and one trace. Prompt
and response content is never recorded in spans.
"""

from __future__ import annotations

import logging
import os

from fastapi import FastAPI

from app.core.settings import Settings

log = logging.getLogger(__name__)

# Must be set before ADK creates any span; interview content stays out of traces.
os.environ.setdefault("ADK_CAPTURE_MESSAGE_CONTENT_IN_SPANS", "false")

_providers_configured = False


def configure_tracing(app: FastAPI, settings: Settings) -> None:
    global _providers_configured
    if not settings.is_deployed:
        return

    if not _providers_configured:
        from google.adk.telemetry import google_cloud
        from google.adk.telemetry.setup import maybe_set_otel_providers

        try:
            maybe_set_otel_providers(
                otel_hooks_to_setup=[google_cloud.get_gcp_exporters(enable_cloud_tracing=True)],
                otel_resource=google_cloud.get_gcp_resource(settings.google_cloud_project),
            )
        except Exception:
            # Telemetry must never take the service down.
            log.warning("tracing disabled: exporter setup failed", exc_info=True)
            return
        _providers_configured = True

    from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor

    FastAPIInstrumentor.instrument_app(app, excluded_urls="health")
