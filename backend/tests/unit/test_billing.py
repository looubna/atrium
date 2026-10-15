from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

import pytest

from app.core.errors import ServiceUnavailable, Unauthorized
from app.core.settings import get_settings
from app.platform import billing
from app.platform.billing import plan_from_entitlements, revenuecat_webhook
from app.platform.plans import PlanId
from app.platform.users import effective_plan

NOW = datetime(2026, 9, 28, 12, 0, tzinfo=UTC)
LATER = "2026-10-28T12:00:00Z"
EARLIER = "2026-09-01T12:00:00Z"


def test_the_largest_active_entitlement_decides() -> None:
    assert plan_from_entitlements({}, NOW) == (PlanId.FREE, None)
    assert plan_from_entitlements({"pro": {"expires_date": LATER}}, NOW)[0] is PlanId.PRO
    # Upgraded to Pro Max while Pro still runs: Pro Max wins.
    both = {"pro": {"expires_date": LATER}, "pro_max": {"expires_date": LATER}}
    assert plan_from_entitlements(both, NOW)[0] is PlanId.PRO_MAX
    # An expired Pro Max gives nothing; the active Pro still counts.
    mixed = {"pro_max": {"expires_date": EARLIER}, "pro": {"expires_date": LATER}}
    plan, ends = plan_from_entitlements(mixed, NOW)
    assert plan is PlanId.PRO and ends == datetime(2026, 10, 28, 12, 0, tzinfo=UTC)


def test_a_promo_code_plan_lasts_only_its_days() -> None:
    assert effective_plan({"plan": "free"}, NOW) is PlanId.FREE
    promo = {"plan": "free", "promoPlan": "pro", "promoUntil": NOW + timedelta(days=3)}
    assert effective_plan(promo, NOW) is PlanId.PRO
    assert effective_plan(promo, NOW + timedelta(days=4)) is PlanId.FREE
    # A paying subscriber keeps their own plan; an internal account is never downgraded.
    assert effective_plan({**promo, "plan": "pro_max"}, NOW) is PlanId.PRO_MAX
    assert effective_plan({"plan": "internal"}, NOW) is PlanId.INTERNAL


class _Request:
    def __init__(self, body: dict[str, Any]) -> None:
        self.body = body

    async def json(self) -> dict[str, Any]:
        return self.body


async def test_the_webhook_needs_the_secret_and_re_checks_revenuecat(monkeypatch: pytest.MonkeyPatch) -> None:
    event = _Request({"event": {"type": "INITIAL_PURCHASE", "app_user_id": "uid1", "product_id": "x"}})
    with pytest.raises(ServiceUnavailable):
        await revenuecat_webhook(event, authorization="anything")  # billing not configured
    monkeypatch.setenv("REVENUECAT_WEBHOOK_SECRET", "s3cret")
    get_settings.cache_clear()
    with pytest.raises(Unauthorized):
        await revenuecat_webhook(event, authorization="wrong")

    calls: list[str] = []

    async def fetch(uid: str) -> dict[str, Any]:
        calls.append(uid)
        return {"pro": {"expires_date": LATER}}

    async def apply(uid: str, entitlements: dict[str, Any], now: datetime | None = None) -> PlanId:
        return plan_from_entitlements(entitlements, NOW)[0]

    monkeypatch.setattr(billing, "fetch_entitlements", fetch)
    monkeypatch.setattr(billing, "apply_subscription", apply)
    assert await revenuecat_webhook(event, authorization="s3cret") == {"status": "ok", "plan": "pro"}
    assert calls == ["uid1"]  # the plan came from RevenueCat's API, not from the event
    anonymous = _Request({"event": {"app_user_id": "$RCAnonymousID:abc"}})
    assert (await revenuecat_webhook(anonymous, authorization="s3cret"))["status"] == "ignored"
