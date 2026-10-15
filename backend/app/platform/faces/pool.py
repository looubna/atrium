"""The face server's GPU, started on demand and left to stop itself when idle.

A GPU costs the same whether anyone is being interviewed or not, so the face server's VMs sit
stopped and are started the moment a candidate opens the setup of a session with a face. A cold
start takes 75-90 s (about 45 s of VM boot and driver init, 35 s of model load), which the setup
screens cover; by the time the candidate walks into the room the face is usually there.

Nothing here stops a VM. The VM does that itself once nobody has used it for a while (see
`ATRIUM_IDLE_STOP_S` in `infra/livetalking/atrium.py`), because only it knows whether a face is
still streaming, and it must stop even if this API is redeployed or down. Polling `warm` holds
it up: every poll pings its health with a signed hold token.

One L4 lip-syncs one conversation smoothly, so each VM is given one conversation at a time
(`/atrium/health` reports how many it has). When every running VM is busy, the next stopped one
is started, up to `MAX_RUNNING`; if none can start (out of GPUs, or the project's GPU quota), the
newcomer shares the least busy VM rather than going without a face.

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
#: Conversations one VM is given before another is started (one L4 keeps one smooth).
CAPACITY = 1
#: VMs running or starting at once, at most (also bounded by the project's GPU quota).
MAX_RUNNING = 3

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
    async def __call__(self, url: str) -> int | None:
        """The server's open conversations, or None while it is not up."""
        ...


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

    async def __call__(self, url: str) -> int | None:
        params = {"hold": livetalking.sign(self.secret, livetalking.HOLD)} if self.secret else {}
        try:
            response = await self._http.get(f"{url}/atrium/health", params=params)
            body = response.json()
            if response.status_code != 200 or not body.get("ok"):
                return None
            return int(body.get("sessions") or 0)
        except (httpx.HTTPError, ValueError, TypeError, AttributeError):
            return None


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
        https: bool = False,
    ) -> None:
        self.vms = vms
        self.port = port
        self.https = https
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

        # A running VM with room is the answer. Asked in failover order and no further than the
        # first with room, so the hold token keeps up only the VMs actually wanted.
        busy: tuple[int, Warmth] | None = None  # the least busy VM that is up, to share if need be
        loading: Warmth | None = None
        active = 0
        for vm, info in infos.items():
            if info.get("status") != "RUNNING" or not _external_ip(info):
                continue
            active += 1
            self._pending.pop(vm, None)
            ip = _external_ip(info)
            url = f"https://{ip.replace('.', '-')}.sslip.io" if self.https else f"http://{ip}:{self.port}"
            elapsed = _since(info.get("lastStartTimestamp"), now) or 0.0
            sessions = await self.health(url)
            if sessions is None:
                loading = loading or Warmth("loading", elapsed_s=max(elapsed, EXPECTED_BOOT_S))
            elif sessions < CAPACITY:
                return Warmth("ready", url=url, elapsed_s=elapsed)
            elif busy is None or sessions < busy[0]:
                busy = (sessions, Warmth("ready", url=url, elapsed_s=elapsed))

        # One is loading its model or booting: it is the next one free.
        if loading:
            return loading
        for vm, info in infos.items():
            if info.get("status") in _STARTING:
                return Warmth("starting", elapsed_s=self._elapsed(vm, now))
        if busy is None:
            # Idling off just as someone arrived: it is started again once it has stopped.
            if any(info.get("status") in _STOPPING for info in infos.values()):
                return Warmth("starting", elapsed_s=0.0)
        elif active >= MAX_RUNNING:
            return busy[1]

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

        return busy[1] if busy else Warmth("unavailable")

    def _elapsed(self, vm: FaceVm, now: float) -> float:
        pending = self._pending.get(vm)
        return now - pending[1] if pending else 0.0


#: Cloud Run: a cold start (instance, image, model) measured at about this; shown as progress.
CLOUD_RUN_EXPECTED_S = 60.0
#: Cloud Run not up after this long (no GPU quota, an outage): the VMs take over for a while.
CLOUD_RUN_GIVE_UP_S = 120.0
#: How long the VMs keep the job before Cloud Run is asked again.
CLOUD_RUN_RETRY_S = 300.0


class CloudRunFaces:
    """The face server on Cloud Run with a GPU: an instance starts when asked for, and none run idle.

    Nothing is started here explicitly: asking `/atrium/health` is a request, and a request is what
    makes Cloud Run start an instance (and keep one up while the page polls). One conversation per
    instance (concurrency 1), so while one is busy the next ask lands on a fresh instance.
    """

    def __init__(self, url: str, *, health: Health, clock: Any = time.time) -> None:
        self.url = url.rstrip("/")
        self.health = health
        self.clock = clock
        self._since: float | None = None  # when this cold start began (first unanswered ask)
        self._gave_up_at: float | None = None

    @property
    def gave_up(self) -> bool:
        """True while the VMs should be used instead (Cloud Run did not come up in time)."""
        if self._gave_up_at is None:
            return False
        if self.clock() - self._gave_up_at >= CLOUD_RUN_RETRY_S:
            self._gave_up_at = None
            self._since = None
            return False
        return True

    async def warm(self) -> Warmth:
        now = self.clock()
        if self.gave_up:
            return Warmth("unavailable")
        if await self.health(self.url) is not None:
            elapsed = now - self._since if self._since is not None else 0.0
            self._since = None
            return Warmth("ready", url=self.url, elapsed_s=elapsed, expected_s=CLOUD_RUN_EXPECTED_S)
        if self._since is None:
            self._since = now
        elapsed = now - self._since
        if elapsed >= CLOUD_RUN_GIVE_UP_S:
            self._gave_up_at = now
            return Warmth("unavailable")
        return Warmth("starting", elapsed_s=elapsed, expected_s=CLOUD_RUN_EXPECTED_S)

    async def ready_url(self) -> str:
        warmth = await self.warm()
        return warmth.url if warmth.state == "ready" else ""


#: A region not ready after this long (all its GPUs busy, or a slow cold start) wakes the next region as
#: well. A normal cold start takes ~90 s (measured 2026-10-09), so a shorter wait booted a second GPU in
#: the next region for nearly every first visitor; this stays under CLOUD_RUN_GIVE_UP_S.
REGION_SPILL_S = 100.0


class CloudRunRegions:
    """The face server in several Cloud Run regions, nearest/cheapest first.

    The first region is asked alone. Only when it has not had a face ready for `REGION_SPILL_S` (its
    instances are all in conversations, or it is still cold-starting) is the next one woken too, and
    whichever is ready first is used, so a busy region never leaves a candidate without a face and an
    idle second region costs nothing.
    """

    def __init__(self, regions: list[CloudRunFaces]) -> None:
        self.regions = regions

    async def warm(self) -> Warmth:
        waiting: Warmth | None = None
        for region in self.regions:
            warmth = await region.warm()
            if warmth.state == "ready":
                return warmth
            if warmth.state != "unavailable":
                waiting = waiting or warmth
                if warmth.elapsed_s < REGION_SPILL_S:
                    break  # give this region its chance before waking the next one
        return waiting or Warmth("unavailable")

    async def ready_url(self) -> str:
        warmth = await self.warm()
        return warmth.url if warmth.state == "ready" else ""


class FirstAvailable:
    """Cloud Run first; the VM pool only when Cloud Run cannot come up (and it is configured)."""

    def __init__(self, primary: CloudRunFaces | CloudRunRegions, backup: FacePool | None) -> None:
        self.primary = primary
        self.backup = backup

    async def warm(self) -> Warmth:
        warmth = await self.primary.warm()
        if warmth.state != "unavailable" or self.backup is None:
            return warmth
        return await self.backup.warm()

    async def ready_url(self) -> str:
        warmth = await self.warm()
        return warmth.url if warmth.state == "ready" else ""


class FixedServer:
    """One face server at a fixed address (local development, or an always-on server)."""

    def __init__(self, url: str) -> None:
        self.url = url.rstrip("/")

    async def warm(self) -> Warmth:
        return Warmth("ready", url=self.url) if self.url else Warmth("unavailable")

    async def ready_url(self) -> str:
        return self.url
