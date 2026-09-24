from __future__ import annotations

from typing import Any

import httpx
import pytest

from app.platform.faces.pool import CACHE_S, ZONE_COOLDOWN_S, FacePool, FaceVm, FixedServer, parse_vms

A = FaceVm("us-central1-a", "face-a")
B = FaceVm("us-central1-b", "face-b")


class FakeCompute:
    def __init__(self, **status: str) -> None:
        self.status = {A: status.get("a", "TERMINATED"), B: status.get("b", "TERMINATED")}
        self.started: list[FaceVm] = []
        self.ops: dict[str, dict[str, Any]] = {}

    async def get(self, vm: FaceVm) -> dict[str, Any]:
        info: dict[str, Any] = {"status": self.status[vm], "lastStartTimestamp": "2026-09-23T10:00:00+00:00"}
        if self.status[vm] == "RUNNING":
            info["networkInterfaces"] = [{"accessConfigs": [{"natIP": "10.0.0.1" if vm == A else "10.0.0.2"}]}]
        return info

    async def start(self, vm: FaceVm) -> str:
        self.started.append(vm)
        name = f"op-{len(self.started)}"
        self.ops[name] = {"status": "RUNNING"}
        return name

    async def operation(self, vm: FaceVm, name: str) -> dict[str, Any]:
        return self.ops[name]


class Clock:
    def __init__(self) -> None:
        self.now = 1_790_000_000.0

    def __call__(self) -> float:
        return self.now

    def tick(self, seconds: float = CACHE_S + 0.1) -> None:
        self.now += seconds


def pool(compute: FakeCompute, healthy: bool = True, clock: Clock | None = None) -> FacePool:
    async def health(url: str) -> bool:
        return healthy

    return FacePool([A, B], port=8010, compute=compute, health=health, clock=clock or Clock())


def test_vms_are_listed_in_failover_order() -> None:
    assert parse_vms(" us-central1-a/face-a, bad, /x, us-central1-b/face-b ") == [A, B]


async def test_a_stopped_server_is_started_on_the_first_warm_and_only_once() -> None:
    compute, clock = FakeCompute(), Clock()
    faces = pool(compute, clock=clock)
    assert (await faces.warm()).state == "starting"
    compute.status[A] = "STAGING"
    clock.tick()
    assert (await faces.warm()).state == "starting"
    assert compute.started == [A]


async def test_a_running_server_is_loading_until_its_health_answers() -> None:
    assert (await pool(FakeCompute(a="RUNNING"), healthy=False).warm()).state == "loading"
    ready = await pool(FakeCompute(a="RUNNING")).warm()
    assert (ready.state, ready.url) == ("ready", "http://10.0.0.1:8010")


async def test_the_address_is_never_told_to_the_page() -> None:
    public = (await pool(FakeCompute(a="RUNNING")).warm()).public()
    assert set(public) == {"state", "elapsedS", "expectedS"}


async def test_ready_url_is_empty_until_the_server_is_up() -> None:
    assert await pool(FakeCompute()).ready_url() == ""
    assert await pool(FakeCompute(b="RUNNING")).ready_url() == "http://10.0.0.2:8010"


async def test_a_zone_out_of_gpus_fails_over_to_the_next() -> None:
    compute, clock = FakeCompute(), Clock()
    faces = pool(compute, clock=clock)
    await faces.warm()
    compute.ops["op-1"] = {"status": "DONE", "error": {"errors": [{"code": "ZONE_RESOURCE_POOL_EXHAUSTED"}]}}
    clock.tick()
    assert (await faces.warm()).state == "starting"
    assert compute.started == [A, B]
    # The failed zone is left alone for a while, then tried again.
    compute.ops["op-2"] = {"status": "DONE", "error": {"errors": [{"code": "ZONE_RESOURCE_POOL_EXHAUSTED"}]}}
    clock.tick()
    assert (await faces.warm()).state == "unavailable"
    clock.tick(ZONE_COOLDOWN_S)
    assert (await faces.warm()).state == "starting"
    assert compute.started == [A, B, A]


async def test_a_refused_start_call_fails_over_too() -> None:
    compute = FakeCompute()

    async def refuse(vm: FaceVm) -> str:
        compute.started.append(vm)
        if vm == A:
            raise httpx.HTTPStatusError("quota", request=httpx.Request("POST", "x"), response=httpx.Response(403))
        return "op"

    compute.start = refuse  # type: ignore[method-assign]
    assert (await pool(compute).warm()).state == "starting"
    assert compute.started == [A, B]


async def test_a_server_idling_off_is_not_started_until_it_has_stopped() -> None:
    compute = FakeCompute(a="STOPPING")
    assert (await pool(compute).warm()).state == "starting"
    assert compute.started == []


@pytest.mark.parametrize(("url", "state"), [("http://face:8010/", "ready"), ("", "unavailable")])
async def test_a_fixed_server_is_ready_whenever_it_is_configured(url: str, state: str) -> None:
    server = FixedServer(url)
    assert (await server.warm()).state == state
    assert await server.ready_url() == url.rstrip("/")
