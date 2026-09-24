"""The face server's GPU, started on demand and left to stop itself when idle.

A GPU costs the same whether anyone is being interviewed or not, so the face server's VMs sit
stopped and are started the moment a candidate opens the setup of a session with a face. A cold
start takes 75-90 s (about 45 s of VM boot and driver init, 35 s of model load), which the setup
screens cover; by the time the candidate walks into the room the face is usually there.

Nothing here stops a VM. The VM does that itself once nobody has used it for a while (see
`ATRIUM_IDLE_STOP_S` in `infra/livetalking/atrium.py`), because only it knows whether a face is
still streaming, and it must stop even if this API is redeployed or down. Polling `warm` holds
it up: every poll pings its health with a signed hold token.

GPUs are not guaranteed to exist when asked for (a zone can be out of L4s), so the VMs are
listed in failover order and a zone whose start failed is skipped for a while. With no VM able
to start the answer is "unavailable", and the session runs on its voice alone.
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal, Protocol

import httpx

from app.modules.interview import livetalking

#: Measured from stopped to `/atrium/health` answering (2026-09-22, g2-standard-8 + L4).
EXPECTED_BOOT_S = 45.0
EXPECTED_LOAD_S = 35.0
EXPECTED_TOTAL_S = EXPECTED_BOOT_S + EXPECTED_LOAD_S
#: A zone that could not start a VM (usually out of GPUs) is left alone this long.
ZONE_COOLDOWN_S = 600.0
#: How long one answer stands for every candidate polling at once.
CACHE_S = 2.0
HEALTH_TIMEOUT_S = 2.5

State = Literal["ready", "starting", "loading", "unavailable"]
_STARTING = {"PROVISIONING", "STAGING", "REPAIRING"}
_STOPPING = {"STOPPING", "SUSPENDING"}
_STOPPED = {"TERMINATED", "STOPPED", "SUSPENDED"}


@dataclass(frozen=True)
class FaceVm:
    zone: str
    name: str


@dataclass(frozen=True)
class Warmth:
    state: State
    url: str = ""
    #: Seconds since this start began, and roughly how long a start takes, for the progress shown.
    elapsed_s: float = 0.0
    expected_s: float = EXPECTED_TOTAL_S

    def public(self) -> dict[str, Any]:
        """What the page is told. Never the address: that goes out only with a signed session."""
        return {"state": self.state, "elapsedS": round(self.elapsed_s, 1), "expectedS": self.expected_s}


def parse_vms(spec: str) -> list[FaceVm]:
    """ "us-central1-a/atrium-face-l4, us-central1-b/atrium-face-b" -> VMs, in failover order."""
    vms = []
    for item in spec.split(","):
        zone, sep, name = item.strip().partition("/")
        if sep and zone.strip() and name.strip():
            vms.append(FaceVm(zone.strip(), name.strip()))
    return vms


class Compute(Protocol):
    async def get(self, vm: FaceVm) -> dict[str, Any]: ...
    async def start(self, vm: FaceVm) -> str: ...
    async def operation(self, vm: FaceVm, name: str) -> dict[str, Any]: ...


class Health(Protocol):
    async def __call__(self, url: str) -> bool: ...


class RestCompute:
    """The three Compute Engine calls this needs, with the API's own credentials."""

    BASE = "https://compute.googleapis.com/compute/v1"

    def __init__(self, project: str) -> None:
        self.project = project
        self._credentials: Any = None
        self._http = httpx.AsyncClient(timeout=10.0)

    async def _headers(self) -> dict[str, str]:
        import google.auth
        from google.auth.transport.requests import Request

        if self._credentials is None:
            self._credentials, _ = await asyncio.to_thread(
                google.auth.default, scopes=["https://www.googleapis.com/auth/compute"]
            )
        if not self._credentials.valid:
            await asyncio.to_thread(self._credentials.refresh, Request())
        return {"Authorization": f"Bearer {self._credentials.token}"}

    def _vm_url(self, vm: FaceVm) -> str:
        return f"{self.BASE}/projects/{self.project}/zones/{vm.zone}/instances/{vm.name}"

    async def get(self, vm: FaceVm) -> dict[str, Any]:
        response = await self._http.get(self._vm_url(vm), headers=await self._headers())
        response.raise_for_status()
        return response.json()

    async def start(self, vm: FaceVm) -> str:
        response = await self._http.post(f"{self._vm_url(vm)}/start", headers=await self._headers())
        response.raise_for_status()
        return str(response.json().get("name", ""))

    async def operation(self, vm: FaceVm, name: str) -> dict[str, Any]:
        url = f"{self.BASE}/projects/{self.project}/zones/{vm.zone}/operations/{name}"
        response = await self._http.get(url, headers=await self._headers())
        response.raise_for_status()
        return response.json()


class HttpHealth:
    """The face server is up once `/atrium/health` answers; the hold token keeps it from idling off."""

    def __init__(self, secret: str) -> None:
        self.secret = secret
        self._http = httpx.AsyncClient(timeout=HEALTH_TIMEOUT_S)

    async def __call__(self, url: str) -> bool:
        params = {"hold": livetalking.sign(self.secret, livetalking.HOLD)} if self.secret else {}
        try:
            response = await self._http.get(f"{url}/atrium/health", params=params)
            return response.status_code == 200 and bool(response.json().get("ok"))
        except (httpx.HTTPError, ValueError):
            return False


def _external_ip(info: dict[str, Any]) -> str:
    for nic in info.get("networkInterfaces") or []:
        for access in nic.get("accessConfigs") or []:
            if access.get("natIP"):
                return str(access["natIP"])
    return ""


def _since(timestamp: str | None, now: float) -> float | None:
    if not timestamp:
        return None
    try:
        return max(0.0, now - datetime.fromisoformat(timestamp).timestamp())
    except ValueError:
        return None


class FacePool:
    def __init__(
        self,
        vms: list[FaceVm],
        *,
        port: int,
        compute: Compute,
        health: Health,
        clock: Any = time.time,
    ) -> None:
        self.vms = vms
        self.port = port
        self.compute = compute
        self.health = health
        self.clock = clock
        self._lock = asyncio.Lock()
        self._pending: dict[FaceVm, tuple[str, float]] = {}  # start operation, when asked
        self._failed: dict[FaceVm, float] = {}  # when its zone last refused a start
        self._cached: tuple[float, Warmth] | None = None

    async def warm(self) -> Warmth:
        """Where the face server is, starting it if nothing is up. Safe to call as often as polled."""
        async with self._lock:
            now = self.clock()
            if self._cached and now - self._cached[0] < CACHE_S:
                return self._cached[1]
            warmth = await self._warm(now)
            self._cached = (now, warmth)
            return warmth

    async def ready_url(self) -> str:
        """The address of a face server that is up now, or "" (and a start under way)."""
        warmth = await self.warm()
        return warmth.url if warmth.state == "ready" else ""

    async def _warm(self, now: float) -> Warmth:
        infos: dict[FaceVm, dict[str, Any]] = {}
        for vm, info in zip(
            self.vms, await asyncio.gather(*(self.compute.get(vm) for vm in self.vms), return_exceptions=True),
            strict=True,
        ):
            if isinstance(info, dict):
                infos[vm] = info

        # One running is all it takes: it is either serving, or loading its model.
        for vm, info in infos.items():
            if info.get("status") != "RUNNING" or not _external_ip(info):
                continue
            self._pending.pop(vm, None)
            url = f"http://{_external_ip(info)}:{self.port}"
            elapsed = _since(info.get("lastStartTimestamp"), now) or 0.0
            if await self.health(url):
                return Warmth("ready", url=url, elapsed_s=elapsed)
            return Warmth("loading", elapsed_s=max(elapsed, EXPECTED_BOOT_S))

        for vm, info in infos.items():
            if info.get("status") in _STARTING:
                return Warmth("starting", elapsed_s=self._elapsed(vm, now))
        # Idling off just as someone arrived: it is started again once it has stopped.
        if any(info.get("status") in _STOPPING for info in infos.values()):
            return Warmth("starting", elapsed_s=0.0)

        for vm in self.vms:
            if vm not in infos or infos[vm].get("status") not in _STOPPED:
                continue
            if now - self._failed.get(vm, -ZONE_COOLDOWN_S) < ZONE_COOLDOWN_S:
                continue
            pending = self._pending.get(vm)
            if pending:
                try:
                    op = await self.compute.operation(vm, pending[0])
                except httpx.HTTPError:
                    return Warmth("starting", elapsed_s=self._elapsed(vm, now))
                if op.get("status") != "DONE":
                    return Warmth("starting", elapsed_s=self._elapsed(vm, now))
                self._pending.pop(vm, None)
                if op.get("error"):
                    # Out of GPUs in this zone (ZONE_RESOURCE_POOL_EXHAUSTED) or similar: next one.
                    self._failed[vm] = now
                    continue
            try:
                self._pending[vm] = (await self.compute.start(vm), now)
            except httpx.HTTPError:
                self._failed[vm] = now
                continue
            return Warmth("starting", elapsed_s=0.0)

        return Warmth("unavailable")

    def _elapsed(self, vm: FaceVm, now: float) -> float:
        pending = self._pending.get(vm)
        return now - pending[1] if pending else 0.0


class FixedServer:
    """One face server at a fixed address (local development, or an always-on server)."""

    def __init__(self, url: str) -> None:
        self.url = url.rstrip("/")

    async def warm(self) -> Warmth:
        return Warmth("ready", url=self.url) if self.url else Warmth("unavailable")

    async def ready_url(self) -> str:
        return self.url
