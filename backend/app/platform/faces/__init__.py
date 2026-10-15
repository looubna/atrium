"""The lip-sync face server: where it is, and starting it before a candidate needs it."""

from __future__ import annotations

from functools import lru_cache

from app.core.settings import get_settings
from app.platform.faces.pool import (
    CloudRunFaces,
    CloudRunRegions,
    FacePool,
    FirstAvailable,
    FixedServer,
    HttpHealth,
    RestCompute,
    parse_vms,
)


@lru_cache
def face_server() -> FirstAvailable | FacePool | FixedServer:
    settings = get_settings()
    health = HttpHealth(settings.livetalking_secret.get_secret_value())
    vms = parse_vms(settings.face_vms)
    pool = (
        FacePool(
            vms,
            port=settings.face_vm_port,
            https=settings.face_vm_https,
            compute=RestCompute(settings.face_vm_project or settings.google_cloud_project),
            health=health,
        )
        if vms
        else None
    )
    urls = [u.strip() for u in settings.face_cloud_run_url.split(",") if u.strip()]
    if urls:
        # Cloud Run first (scale to zero), region by region; the VMs, when listed, only if none comes up in time.
        regions = [CloudRunFaces(url, health=health) for url in urls]
        return FirstAvailable(regions[0] if len(regions) == 1 else CloudRunRegions(regions), pool)
    return pool or FixedServer(settings.livetalking_url.strip())
