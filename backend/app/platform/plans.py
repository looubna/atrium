"""Plans and entitlements.

v1 is free with quotas. The plan is a server-set field on `users/{uid}`; no
client can write it. A future StoreKit integration only needs to set that
field from verified App Store Server Notifications — limits and enforcement
stay as they are.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

from app.core.settings import Settings


class PlanId(StrEnum):
    FREE = "free"
    INTERNAL = "internal"


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
    return PlanLimits(
        live_minutes_month=settings.free_live_minutes_month,
        max_round_minutes=45,
        concurrent_live_sessions=1,
        sessions_day=6,
        blueprint_generations_day=5,
        evaluations_day=6,
        reprocess_day=2,
        resumes_max=10,
        applications_max=25,
    )
