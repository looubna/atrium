from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

import pytest

from app.platform import users
from app.platform.auth.dependencies import AuthUser
from app.platform.plans import PlanId
from app.platform.trial import client_ip, is_disposable, trial_allowed

USER = AuthUser(uid="u1", email_verified=True, sign_in_provider="password", auth_time=0)


def test_throwaway_email_services_are_recognised() -> None:
    assert is_disposable("someone@mailinator.com")
    assert is_disposable("someone@mail.mailinator.com")  # a subdomain of a listed service
    assert is_disposable("x@10minutemail.com")
    for real in ("a@gmail.com", "a@outlook.com", "a@naver.com", "a@icloud.com", "a@university.ac.kr", ""):
        assert not is_disposable(real)


def test_only_public_addresses_identify_a_network() -> None:
    # The last hop is the one Google's front end appended; earlier ones come from the client.
    assert client_ip("1.2.3.4, 8.8.4.4", "10.0.0.2") == "8.8.4.4"
    assert client_ip("8.8.4.4", "10.0.0.2") == "8.8.4.4"
    assert client_ip(None, "8.8.8.8") == "8.8.8.8"
    assert client_ip(None, "127.0.0.1") is None  # local development
    assert client_ip("192.168.1.5", None) is None
    assert client_ip("not-an-ip", None) is None


def test_the_trial_is_kept_unless_a_check_said_no() -> None:
    assert trial_allowed({})  # never checked (older app, check failed, accounts from before): fail-open
    assert trial_allowed({"trial": {"eligible": True}})
    assert not trial_allowed({"trial": {"eligible": False, "reason": "device_used"}})


async def _limits(monkeypatch: pytest.MonkeyPatch, data: dict[str, Any]) -> tuple[PlanId, Any]:
    async def ensure(user: AuthUser) -> dict[str, Any]:
        return data

    monkeypatch.setattr(users, "ensure_user", ensure)
    return await users.plan_limits(USER, practice=False)


async def test_a_refused_trial_only_removes_free_minutes(monkeypatch: pytest.MonkeyPatch) -> None:
    refused = {"trial": {"eligible": False, "reason": "device_used"}}
    plan, limits = await _limits(monkeypatch, {"plan": "free", **refused})
    assert plan is PlanId.FREE and limits.trial_minutes_total == 0
    # Everything else about the free plan is unchanged.
    assert limits.sessions_day == 6
    # A paying or internal account is never affected by the trial check.
    _, pro = await _limits(monkeypatch, {"plan": "pro", **refused})
    assert pro.live_minutes_month == 600
    _, internal = await _limits(monkeypatch, {"plan": "internal", **refused})
    assert internal.live_minutes_month == 1200
    # And an account nobody checked keeps its 20 minutes.
    _, unchecked = await _limits(monkeypatch, {"plan": "free"})
    assert unchecked.trial_minutes_total == 20


class _Socket:
    def __init__(self) -> None:
        self.headers = {"x-forwarded-for": "1.2.3.4, 8.8.4.4"}
        self.client = None


def _gateway() -> Any:
    from app.platform.agents.live_gateway import LiveGateway

    gateway = object.__new__(LiveGateway)
    gateway.ws = _Socket()
    gateway.user = USER
    return gateway


async def test_a_client_that_never_asked_is_decided_at_its_first_session(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.platform.agents import live_gateway

    asked: list[tuple[str, Any, Any]] = []

    async def check(uid: str, *, device_id: Any, ip: Any) -> dict[str, Any]:
        asked.append((uid, device_id, ip))
        return {"eligible": True}

    monkeypatch.setattr(live_gateway, "check_trial", check)
    await _gateway()._decide_trial()
    assert asked == [("u1", None, "8.8.4.4")]  # the hop Google appended, not the client's

    async def broken(uid: str, *, device_id: Any, ip: Any) -> dict[str, Any]:
        raise RuntimeError("firestore down")

    monkeypatch.setattr(live_gateway, "check_trial", broken)
    await _gateway()._decide_trial()  # fail-open: never stops the session


def test_the_walk_in_is_neither_billed_nor_taken_from_the_minutes(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.platform.agents import live_gateway

    gateway = _gateway()
    gateway.connected_at, gateway.usage_seconds_recorded, gateway.quota_remaining_ms = 100.0, 0.0, 60_000
    monkeypatch.setattr(live_gateway.time, "monotonic", lambda: 125.0)  # sat down 25 s after connecting
    gateway._credit_walk_in()
    assert gateway.usage_seconds_recorded == 25 and gateway.quota_remaining_ms == 85_000


async def test_once_the_free_minutes_are_used_no_practice_starts(monkeypatch: pytest.MonkeyPatch) -> None:
    left = {"seconds": 0}

    async def ensure(user: AuthUser) -> dict[str, Any]:
        return {"plan": "free"}

    async def minutes(db: Any, uid: str, limits: Any) -> dict[str, int | None]:
        return {"leftSeconds": left["seconds"]}

    monkeypatch.setattr(users, "ensure_user", ensure)
    monkeypatch.setattr(users, "live_minutes", minutes)
    monkeypatch.setattr(users.clients, "firestore", lambda: None)

    with pytest.raises(users.TrialUsed):
        await users.plan_limits(USER)  # every room, drill and preparation starts here
    left["seconds"] = 29  # under what a live session needs: used up too
    with pytest.raises(users.TrialUsed):
        await users.plan_limits(USER)
    # Showing the plan, the paywall or a past session's feedback still works.
    plan, _ = await users.plan_limits(USER, practice=False)
    assert plan is PlanId.FREE
    left["seconds"] = 600
    assert (await users.plan_limits(USER))[0] is PlanId.FREE


async def test_paid_and_promo_accounts_are_never_stopped_by_the_trial(monkeypatch: pytest.MonkeyPatch) -> None:
    async def minutes(db: Any, uid: str, limits: Any) -> dict[str, int | None]:
        raise AssertionError("a paid plan never looks at the trial")

    monkeypatch.setattr(users, "live_minutes", minutes)
    for data in ({"plan": "pro"}, {"plan": "internal"},
                 {"plan": "free", "promoPlan": "pro", "promoUntil": datetime.now(UTC) + timedelta(days=3)}):
        async def ensure(user: AuthUser, data: dict[str, Any] = data) -> dict[str, Any]:
            return data

        monkeypatch.setattr(users, "ensure_user", ensure)
        await users.plan_limits(USER)
