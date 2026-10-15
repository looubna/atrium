from __future__ import annotations

import pytest

from app.core.settings import get_settings
from app.platform import plans
from app.platform.plans import PlanId, limits_for, live_minutes
from app.platform.usage import Metric, Period, period_key

LIVE = Metric.LIVE_SECONDS.value


def _usage(monkeypatch: pytest.MonkeyPatch, **seconds: int) -> None:
    """Pretend the account has talked this many seconds in each period (all / month / day)."""

    async def totals(self: object, uid: str, period: Period, now: object = None) -> dict[str, int]:
        return {m.value: 0 for m in Metric} | {LIVE: seconds.get(period.value, 0)}

    monkeypatch.setattr(plans.UsageService, "totals", totals)


def test_the_plans_and_their_minutes() -> None:
    settings = get_settings()
    free = limits_for(PlanId.FREE, settings)
    assert free.trial_minutes_total == 20 and free.live_minutes_day is None
    pro, pro_max = limits_for(PlanId.PRO, settings), limits_for(PlanId.PRO_MAX, settings)
    assert (pro.live_minutes_month, pro.live_minutes_day) == (600, 60)  # 10 h a month, 1 h a day
    assert (pro_max.live_minutes_month, pro_max.live_minutes_day) == (1200, 120)  # 20 h a month, 2 h a day
    # An unknown plan is treated as free, never as paid.
    assert limits_for("gold", settings).trial_minutes_total == 20
    assert period_key(Period.ALL) == "all"


async def test_free_minutes_are_a_one_time_trial(monkeypatch: pytest.MonkeyPatch) -> None:
    free = limits_for(PlanId.FREE, get_settings())
    # 15 minutes used over the account's life, none this month: 5 left, not 20.
    _usage(monkeypatch, all=15 * 60, month=0)
    minutes = await live_minutes(None, "u", free)
    assert minutes["leftSeconds"] == 5 * 60 and minutes["allowanceMinutes"] == 20
    _usage(monkeypatch, all=25 * 60)
    assert (await live_minutes(None, "u", free))["leftSeconds"] == 0


async def test_paid_plans_count_the_month_and_the_day(monkeypatch: pytest.MonkeyPatch) -> None:
    settings = get_settings()
    # Pro: the trial used long ago doesn't matter, only this month (590 of 600 minutes used).
    _usage(monkeypatch, all=900 * 60, month=590 * 60)
    assert (await live_minutes(None, "u", limits_for(PlanId.PRO, settings)))["leftSeconds"] == 10 * 60
    # Pro Max: plenty left this month, but today's fair-use 2 hours are almost used.
    _usage(monkeypatch, month=100 * 60, day=115 * 60)
    minutes = await live_minutes(None, "u", limits_for(PlanId.PRO_MAX, settings))
    assert minutes["leftSeconds"] == 5 * 60 and minutes["todayLeftSeconds"] == 5 * 60
