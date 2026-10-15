"""Plans and entitlements.

The plan is a server-set field on `users/{uid}`; no client can write it. Free accounts get a
one-time trial of live minutes; the paid plans (sold through RevenueCat, `platform/billing.py`)
get a monthly allowance. The billing webhook only sets that field — limits and enforcement stay
here and in the live gateway.

What a live minute costs (voice model, transcription and the coach, about $0.10 at worst, so ~$6
an hour) is why the paid plans are priced on typical use (about 40% of the hours) and carry a daily
fair-use line, so one heavy user can't cost more than they pay:
Pro $49.99 = 10 h a month (1 h a day), Pro Max $89.99 = 20 h a month (2 h a day).
Fixed costs besides the minutes (the face server's SSD ~$17 and static IP ~$7 a month, ~$24 in all) are
covered by the margin of two or three subscribers, so they don't change the prices.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Any

from app.core.settings import Settings
from app.platform.usage import Metric, Period, UsageService


class PlanId(StrEnum):
    FREE = "free"
    PRO = "pro"
    PRO_MAX = "pro_max"
    INTERNAL = "internal"


#: The plans a subscription buys, in order from smallest to largest.
PAID_PLANS = (PlanId.PRO, PlanId.PRO_MAX)


@dataclass(frozen=True, slots=True)
class PlanLimits:
    live_minutes_month: int
    max_round_minutes: int
    concurrent_live_sessions: int
    sessions_day: int
    blueprint_generations_day: int
    evaluations_day: int
    reprocess_day: int
    resumes_max: int
    applications_max: int
    #: Practice Center rounds analysed per day (speech-to-text plus a short AI assessment each).
    practice_rounds_day: int = 40
    #: Round preparation guides written per day (one model call each; opening a written one is free).
    round_guides_day: int = 15
    #: Oral exam courses kept, materials per course, and analyses of them per day.
    courses_max: int = 10
    materials_per_course_max: int = 40
    exam_analyses_day: int = 6
    #: Debates kept, materials attached to one, and preparations (research plus a brief) per day.
    debates_max: int = 20
    materials_per_debate_max: int = 20
    debate_preparations_day: int = 8
    #: Live minutes for the account's whole life instead of per month (the free trial); None = monthly.
    trial_minutes_total: int | None = None
    #: Live minutes per day on top of the month (the paid plans' fair use); None = no daily line.
    live_minutes_day: int | None = None


def _paid(minutes_month: int, sessions_day: int, *, minutes_day: int | None = None) -> PlanLimits:
    return PlanLimits(
        live_minutes_month=minutes_month,
        max_round_minutes=60,
        concurrent_live_sessions=1,
        sessions_day=sessions_day,
        blueprint_generations_day=20,
        evaluations_day=sessions_day,
        reprocess_day=10,
        resumes_max=30,
        applications_max=100,
        practice_rounds_day=120,
        round_guides_day=40,
        courses_max=40,
        materials_per_course_max=100,
        exam_analyses_day=20,
        debates_max=80,
        materials_per_debate_max=50,
        debate_preparations_day=20,
        live_minutes_day=minutes_day,
    )


def limits_for(plan: PlanId | str, settings: Settings) -> PlanLimits:
    try:
        plan_id = PlanId(plan)
    except ValueError:
        plan_id = PlanId.FREE
    if plan_id is PlanId.INTERNAL:
        return PlanLimits(
            live_minutes_month=1200,
            max_round_minutes=60,
            concurrent_live_sessions=1,
            sessions_day=40,
            blueprint_generations_day=40,
            evaluations_day=40,
            reprocess_day=20,
            resumes_max=50,
            applications_max=200,
            practice_rounds_day=200,
            round_guides_day=100,
            courses_max=100,
            materials_per_course_max=200,
            exam_analyses_day=40,
            debates_max=200,
            materials_per_debate_max=100,
            debate_preparations_day=40,
        )
    if plan_id is PlanId.PRO:
        return _paid(600, 40, minutes_day=60)
    if plan_id is PlanId.PRO_MAX:
        return _paid(1200, 60, minutes_day=120)
    return PlanLimits(
        live_minutes_month=settings.free_trial_minutes,
        max_round_minutes=45,
        concurrent_live_sessions=1,
        sessions_day=6,
        blueprint_generations_day=5,
        evaluations_day=6,
        reprocess_day=2,
        resumes_max=10,
        applications_max=25,
        trial_minutes_total=settings.free_trial_minutes,
    )


async def live_minutes(db: Any, uid: str, limits: PlanLimits) -> dict[str, int | None]:
    """What the account may still talk live, in seconds, and what binds it.

    `leftSeconds` is the smallest of: the trial's remainder (free), the month's remainder (paid),
    and today's remainder (plans with a daily line). `allowanceMinutes` is the headline number.
    """
    usage = UsageService(db)
    live = Metric.LIVE_SECONDS.value
    if limits.trial_minutes_total is not None:
        allowance, used = limits.trial_minutes_total, (await usage.totals(uid, Period.ALL))[live]
    else:
        allowance, used = limits.live_minutes_month, (await usage.totals(uid, Period.MONTH))[live]
    left = allowance * 60 - used
    day_left = None
    if limits.live_minutes_day is not None:
        day_left = max(0, limits.live_minutes_day * 60 - (await usage.totals(uid, Period.DAY))[live])
        left = min(left, day_left)
    return {"allowanceMinutes": allowance, "usedSeconds": used, "leftSeconds": max(0, left),
            "todayLeftSeconds": day_left}
