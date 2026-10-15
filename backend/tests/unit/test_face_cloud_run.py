"""Cloud Run first, VMs as the backup: `CloudRunFaces` and `FirstAvailable` (app/platform/faces/pool.py)."""

from __future__ import annotations

from typing import Any

import pytest

from app.platform.faces.pool import (
    CLOUD_RUN_GIVE_UP_S,
    CLOUD_RUN_RETRY_S,
    REGION_SPILL_S,
    CloudRunFaces,
    CloudRunRegions,
    FirstAvailable,
    Warmth,
)

URL = "https://atrium-face-abc-uc.a.run.app"


class Clock:
    def __init__(self) -> None:
        self.now = 1_790_000_000.0

    def __call__(self) -> float:
        return self.now


class Health:
    """Answers like `/atrium/health`: open conversations, or None while no instance is up."""

    def __init__(self, up: bool = True) -> None:
        self.up = up
        self.asked: list[str] = []

    async def __call__(self, url: str) -> int | None:
        self.asked.append(url)
        return 0 if self.up else None


class Backup:
    def __init__(self) -> None:
        self.calls = 0

    async def warm(self) -> Warmth:
        self.calls += 1
        return Warmth("ready", url="https://10-0-0-1.sslip.io")


@pytest.mark.asyncio
async def test_ready_when_an_instance_answers() -> None:
    faces = CloudRunFaces(URL + "/", health=Health(up=True), clock=Clock())
    warmth = await faces.warm()
    assert warmth.state == "ready" and warmth.url == URL
    assert await faces.ready_url() == URL


@pytest.mark.asyncio
async def test_starting_while_cold_then_ready() -> None:
    clock, health = Clock(), Health(up=False)
    faces = CloudRunFaces(URL, health=health, clock=clock)
    first = await faces.warm()
    assert first.state == "starting" and first.elapsed_s == 0
    clock.now += 30
    assert (await faces.warm()).elapsed_s == pytest.approx(30)
    assert await faces.ready_url() == ""
    health.up = True
    clock.now += 10
    ready = await faces.warm()
    assert ready.state == "ready" and ready.elapsed_s == pytest.approx(40)


@pytest.mark.asyncio
async def test_gives_up_then_tries_again_later() -> None:
    clock, health = Clock(), Health(up=False)
    faces = CloudRunFaces(URL, health=health, clock=clock)
    await faces.warm()
    clock.now += CLOUD_RUN_GIVE_UP_S
    assert (await faces.warm()).state == "unavailable"
    asked = len(health.asked)
    clock.now += 60
    assert (await faces.warm()).state == "unavailable"
    assert len(health.asked) == asked  # not asked again while given up
    health.up = True
    clock.now += CLOUD_RUN_RETRY_S
    assert (await faces.warm()).state == "ready"


@pytest.mark.asyncio
async def test_first_available_uses_cloud_run_and_never_wakes_the_vms() -> None:
    backup = Backup()
    first = FirstAvailable(CloudRunFaces(URL, health=Health(up=True), clock=Clock()), backup)  # type: ignore[arg-type]
    assert await first.ready_url() == URL
    assert backup.calls == 0


@pytest.mark.asyncio
async def test_first_available_keeps_waiting_for_a_cold_start() -> None:
    backup = Backup()
    first = FirstAvailable(CloudRunFaces(URL, health=Health(up=False), clock=Clock()), backup)  # type: ignore[arg-type]
    assert (await first.warm()).state == "starting"
    assert backup.calls == 0


@pytest.mark.asyncio
async def test_first_available_falls_back_to_the_vms() -> None:
    clock, backup = Clock(), Backup()
    first = FirstAvailable(CloudRunFaces(URL, health=Health(up=False), clock=clock), backup)  # type: ignore[arg-type]
    await first.warm()
    clock.now += CLOUD_RUN_GIVE_UP_S
    assert await first.ready_url() == "https://10-0-0-1.sslip.io"
    assert backup.calls == 1


@pytest.mark.asyncio
async def test_no_backup_means_unavailable() -> None:
    clock: Any = Clock()
    first = FirstAvailable(CloudRunFaces(URL, health=Health(up=False), clock=clock), None)
    await first.warm()
    clock.now += CLOUD_RUN_GIVE_UP_S
    assert (await first.warm()).state == "unavailable"


# ── several regions ────────────────────────────────────────────────────────────────────────────────

EU = "https://atrium-face-abc-ew.a.run.app"


@pytest.mark.asyncio
async def test_regions_use_the_first_when_it_is_ready() -> None:
    us, eu = Health(up=True), Health(up=True)
    clock = Clock()
    regions = CloudRunRegions([CloudRunFaces(URL, health=us, clock=clock), CloudRunFaces(EU, health=eu, clock=clock)])
    assert await regions.ready_url() == URL
    assert eu.asked == []  # the second region is never woken for nothing


@pytest.mark.asyncio
async def test_regions_wait_for_the_first_before_waking_the_next() -> None:
    us, eu = Health(up=False), Health(up=True)
    clock = Clock()
    regions = CloudRunRegions([CloudRunFaces(URL, health=us, clock=clock), CloudRunFaces(EU, health=eu, clock=clock)])
    assert (await regions.warm()).state == "starting"
    clock.now += REGION_SPILL_S - 1
    assert (await regions.warm()).state == "starting"
    assert eu.asked == []


@pytest.mark.asyncio
async def test_regions_spill_to_the_next_when_the_first_stays_busy() -> None:
    us, eu = Health(up=False), Health(up=True)
    clock = Clock()
    regions = CloudRunRegions([CloudRunFaces(URL, health=us, clock=clock), CloudRunFaces(EU, health=eu, clock=clock)])
    await regions.warm()
    clock.now += REGION_SPILL_S
    assert await regions.ready_url() == EU


@pytest.mark.asyncio
async def test_regions_all_down_falls_back_to_the_vms() -> None:
    clock, backup = Clock(), Backup()
    regions = CloudRunRegions([
        CloudRunFaces(URL, health=Health(up=False), clock=clock),
        CloudRunFaces(EU, health=Health(up=False), clock=clock),
    ])
    first = FirstAvailable(regions, backup)  # type: ignore[arg-type]
    await first.warm()
    clock.now += REGION_SPILL_S
    await first.warm()  # the second region starts its own clock now
    clock.now += CLOUD_RUN_GIVE_UP_S
    assert await first.ready_url() == "https://10-0-0-1.sslip.io"
