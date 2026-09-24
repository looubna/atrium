"""The lip-sync face server: where it is, and starting it before a candidate needs it."""

from __future__ import annotations

from functools import lru_cache

from app.core.settings import get_settings
from app.platform.faces.pool import FacePool, FixedServer, HttpHealth, RestCompute, parse_vms


@lru_cache
def face_server() -> FacePool | FixedServer:
    settings = get_settings()
    vms = parse_vms(settings.face_vms)
    if not vms:
        return FixedServer(settings.livetalking_url.strip())
    return FacePool(
        vms,
        port=settings.face_vm_port,
        compute=RestCompute(settings.face_vm_project or settings.google_cloud_project),
        health=HttpHealth(settings.livetalking_secret.get_secret_value()),
    )
