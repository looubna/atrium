"""Paid plans through RevenueCat (`/api/v1/billing/...`).

The app buys a subscription through RevenueCat (Samsung Galaxy Store billing on Android), logged in as
the user's Firebase uid. RevenueCat then calls the webhook; the webhook never trusts the event's
contents: it asks RevenueCat's REST API which entitlements that subscriber really has, and sets
`users/{uid}.plan` from them (the largest active one wins; none active → free). An internal account
is never changed.

Promo codes (for the Shipaton judges) grant a paid plan for some days without any purchase:
`promoCodes/{code}` documents, created by an admin script, each usable once. Clients can't read them
(Firestore rules deny any collection not listed).
"""

from __future__ import annotations

import hmac
import logging
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any

import httpx
from fastapi import APIRouter, Depends, Header, Request
from google.cloud import firestore
from pydantic import BaseModel, Field

from app.core.errors import Conflict, NotFound, ServiceUnavailable, Unauthorized
from app.core.settings import get_settings
from app.modules.interview.api import EmailNotVerified
from app.platform.auth.dependencies import AuthUser, current_user
from app.platform.clients import clients
from app.platform.firestore.paths import UserPaths
from app.platform.plans import PAID_PLANS, PlanId, live_minutes
from app.platform.ratelimit import rate_limit
from app.platform.trial import check as check_trial
from app.platform.trial import client_ip
from app.platform.users import ensure_user, plan_limits

log = logging.getLogger(__name__)

router = APIRouter(prefix="/billing", tags=["billing"])

REVENUECAT_API = "https://api.revenuecat.com/v1"
#: RevenueCat entitlement id → plan. Order matters: the largest active entitlement decides.
ENTITLEMENTS: dict[str, PlanId] = {"pro_max": PlanId.PRO_MAX, "pro": PlanId.PRO}
PROMO_COLLECTION = "promoCodes"


def plan_from_entitlements(entitlements: dict[str, Any], now: datetime) -> tuple[PlanId, datetime | None]:
    """The plan a subscriber's active entitlements give, and when it renews or ends."""
    for entitlement_id, plan in ENTITLEMENTS.items():
        info = entitlements.get(entitlement_id)
        if not info:
            continue
        expires = info.get("expires_date")
        ends = datetime.fromisoformat(expires.replace("Z", "+00:00")) if expires else None
        if ends is None or ends > now:
            return plan, ends
    return PlanId.FREE, None


async def fetch_entitlements(app_user_id: str) -> dict[str, Any]:
    key = get_settings().revenuecat_api_key.get_secret_value()
    if not key:
        raise ServiceUnavailable("billing is not configured")
    async with httpx.AsyncClient(timeout=10) as http:
        response = await http.get(f"{REVENUECAT_API}/subscribers/{app_user_id}",
                                  headers={"Authorization": f"Bearer {key}"})
    response.raise_for_status()
    return ((response.json().get("subscriber") or {}).get("entitlements")) or {}


async def apply_subscription(uid: str, entitlements: dict[str, Any], now: datetime | None = None) -> PlanId:
    """Set the account's plan from its verified entitlements. Returns the plan now in force."""
    now = now or datetime.now(UTC)
    ref = clients.firestore().document(UserPaths(uid).user())
    snap = await ref.get()
    if not snap.exists:
        raise NotFound()
    current = (snap.to_dict() or {}).get("plan")
    if current == PlanId.INTERNAL.value:
        return PlanId.INTERNAL
    plan, ends = plan_from_entitlements(entitlements, now)
    await ref.update({"plan": plan.value, "planRenewsAt": ends, "planUpdatedAt": firestore.SERVER_TIMESTAMP})
    if plan.value != current:
        log.info("plan changed", extra={"data": {"from": current, "to": plan.value}})
    return plan


@router.post("/revenuecat", include_in_schema=False)
async def revenuecat_webhook(
    request: Request, authorization: Annotated[str | None, Header()] = None
) -> dict[str, str]:
    """RevenueCat's event webhook. Only the secret authorizes it; the event only says who to re-check."""
    secret = get_settings().revenuecat_webhook_secret.get_secret_value()
    if not secret:
        raise ServiceUnavailable("billing is not configured")
    if not authorization or not hmac.compare_digest(authorization.encode(), secret.encode()):
        raise Unauthorized()
    event = (await request.json()).get("event") or {}
    uid = str(event.get("app_user_id") or "")
    # Anonymous RevenueCat ids ($RCAnonymousID:…) aren't accounts: the app always logs in with the uid.
    if not uid or uid.startswith("$RCAnonymousID"):
        return {"status": "ignored"}
    try:
        plan = await apply_subscription(uid, await fetch_entitlements(uid))
    except NotFound:
        return {"status": "unknown user"}
    return {"status": "ok", "plan": plan.value}


class BillingStatus(BaseModel):
    plan: PlanId
    #: The subscription's own plan, and when it renews (None without one).
    subscription: PlanId
    renewsAt: datetime | None
    promoUntil: datetime | None
    allowanceMinutes: int
    minutesLeft: int
    #: Only for plans with a daily fair-use line.
    todayMinutesLeft: int | None
    isTrial: bool


@router.get("/status", response_model=BillingStatus)
async def status(user: current_user) -> BillingStatus:
    """What the paywall and the account sheet show: the plan and the live minutes left."""
    data = await ensure_user(user)
    plan, limits = await plan_limits(user, practice=False)
    minutes = await live_minutes(clients.firestore(), user.uid, limits)
    subscription = PlanId(data["plan"]) if data.get("plan") in set(PlanId) else PlanId.FREE
    today = minutes["todayLeftSeconds"]
    return BillingStatus(
        plan=plan,
        subscription=subscription,
        renewsAt=data.get("planRenewsAt"),
        promoUntil=data.get("promoUntil") if plan is not subscription else None,
        allowanceMinutes=int(minutes["allowanceMinutes"] or 0),
        minutesLeft=int(minutes["leftSeconds"] or 0) // 60,
        todayMinutesLeft=None if today is None else int(today) // 60,
        isTrial=limits.trial_minutes_total is not None,
    )


@router.post("/sync", response_model=BillingStatus)
async def sync(user: Annotated[AuthUser, Depends(rate_limit("billing_sync", limit=30, window_seconds=3600))]
               ) -> BillingStatus:
    """Right after a purchase or restore: re-check RevenueCat now instead of waiting for the webhook."""
    await ensure_user(user)
    await apply_subscription(user.uid, await fetch_entitlements(user.uid))
    return await status(user)


class TrialCheck(BaseModel):
    #: Android's per-app device id (Settings.Secure.ANDROID_ID); absent on the web.
    deviceId: Annotated[str, Field(max_length=128, pattern=r"^[A-Za-z0-9_-]*$")] = ""


@router.post("/trial-check", response_model=BillingStatus)
async def trial_check(
    body: TrialCheck,
    request: Request,
    user: Annotated[AuthUser, Depends(rate_limit("trial_check", limit=20, window_seconds=3600))],
) -> BillingStatus:
    """Right after sign-in: decide once whether this account gets the free trial (platform/trial.py)."""
    await ensure_user(user)
    ip = client_ip(request.headers.get("x-forwarded-for"), request.client.host if request.client else None)
    await check_trial(user.uid, device_id=body.deviceId or None, ip=ip)
    return await status(user)


class Redeem(BaseModel):
    code: Annotated[str, Field(min_length=4, max_length=40, pattern=r"^[A-Za-z0-9-]+$")]


class PromoCodeUsed(Conflict):
    code = "promo_code_used"
    title = "This code has already been used"


@router.post("/redeem", response_model=BillingStatus)
async def redeem(
    body: Redeem,
    user: Annotated[AuthUser, Depends(rate_limit("promo_redeem", limit=10, window_seconds=3600))],
) -> BillingStatus:
    """Unlock a paid plan with a one-time code (judges, press): no purchase, for the code's days.

    Verified email only, and 10 tries an hour per account: guessing a code (32^6 per prefix) would take
    many verified accounts and years.
    """
    if not user.verified_for_ai:
        raise EmailNotVerified()
    await ensure_user(user)
    db = clients.firestore()
    code_ref = db.collection(PROMO_COLLECTION).document(body.code.strip().upper())
    user_ref = db.document(UserPaths(user.uid).user())

    @firestore.async_transactional
    async def claim(transaction: firestore.AsyncTransaction) -> None:
        snap = await code_ref.get(transaction=transaction)
        if not snap.exists:
            raise NotFound()
        promo = snap.to_dict() or {}
        if promo.get("usedBy") == user.uid:
            return  # entered again: the days it gave run from the first use, not from now
        if promo.get("usedBy"):
            raise PromoCodeUsed()
        redeem_by = promo.get("redeemBy")  # codes made before this field never lapse
        if isinstance(redeem_by, datetime) and redeem_by < datetime.now(UTC):
            raise NotFound()
        plan = promo.get("plan") if promo.get("plan") in {p.value for p in PAID_PLANS} else PlanId.PRO.value
        until = datetime.now(UTC) + timedelta(days=int(promo.get("days") or 14))
        transaction.update(code_ref, {"usedBy": user.uid, "usedAt": firestore.SERVER_TIMESTAMP})
        transaction.update(user_ref, {"promoPlan": plan, "promoUntil": until})

    await claim(db.transaction())
    return await status(user)
