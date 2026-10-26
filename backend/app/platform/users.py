"""User profile, consent and usage endpoints (`/api/v1/me`)."""

from __future__ import annotations

import logging
import re
import unicodedata
from dataclasses import asdict, replace
from datetime import UTC, datetime
from enum import StrEnum
from typing import Annotated, Any

from fastapi import APIRouter, Path
from google.api_core.exceptions import AlreadyExists
from google.cloud import firestore
from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.core.errors import ConsentRequired, Forbidden
from app.core.settings import get_settings
from app.platform.auth.dependencies import AuthUser, current_user
from app.platform.clients import clients
from app.platform.firestore.paths import UserPaths
from app.platform.plans import PlanId, PlanLimits, limits_for, live_minutes
from app.platform.usage import Period, UsageService

log = logging.getLogger(__name__)

# Bump when the consent text shown in the app changes; users re-consent.
CURRENT_CONSENT_VERSION = "2026-10-24"


class ConsentKind(StrEnum):
    AI_PROCESSING = "ai_processing"
    RECORDING = "recording"
    #: Optional: send the camera video to AI for body-language feedback (whole session at low resolution,
    #: flagged moments at high resolution: `app/platform/media/body_review.py`).
    VIDEO_ANALYSIS = "video_analysis"


class AccountDeleting(Forbidden):
    code = "account_deleting"
    title = "This account is being deleted"


class Consent(BaseModel):
    kind: ConsentKind
    accepted: bool
    version: str | None
    current: bool
    updatedAt: datetime | None = None


class Profile(BaseModel):
    uid: str
    displayName: str | None
    plan: PlanId
    createdAt: datetime | None
    consents: list[Consent]
    consentVersion: str = CURRENT_CONSENT_VERSION
    emailVerified: bool
    signInProvider: str


class ProfileUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    displayName: Annotated[str, Field(min_length=1, max_length=80)]

    @field_validator("displayName")
    @classmethod
    def _clean(cls, value: str) -> str:
        value = unicodedata.normalize("NFC", value).strip()
        if not value or any(unicodedata.category(ch).startswith("C") for ch in value):
            raise ValueError("display name contains invalid characters")
        return re.sub(r"\s+", " ", value)


class ConsentUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    accepted: bool
    version: Annotated[str, Field(pattern=r"^\d{4}-\d{2}-\d{2}$")]


class UsageView(BaseModel):
    plan: PlanId
    limits: dict[str, int | None]
    month: dict[str, int]
    today: dict[str, int]


async def _deleted(uid: str) -> bool:
    from app.platform.firestore.paths import deletion_path, uid_hash

    salt = get_settings().analytics_salt.get_secret_value()
    return bool((await clients.firestore().document(deletion_path(uid_hash(uid, salt))).get()).exists)


async def ensure_user(user: AuthUser) -> dict[str, Any]:
    """Create the profile on first contact; refuse accounts being deleted."""
    ref = clients.firestore().document(UserPaths(user.uid).user())
    snap = await ref.get()
    if snap.exists:
        data = snap.to_dict() or {}
    elif await _deleted(user.uid):
        # A token issued before deletion must not bring back an empty profile.
        raise AccountDeleting()
    else:
        # create() is atomic create-if-absent, so parallel first requests (the app loads the
        # profile and usage together) need no transaction and cannot contend for a lock.
        new = {"plan": PlanId.FREE.value, "displayName": None, "createdAt": firestore.SERVER_TIMESTAMP}
        try:
            await ref.create(new)
            data = {**new, "createdAt": None}
            # The owner's "new account" email alert (a Cloud Monitoring log alert) matches this line.
            log.info("new account created")
        except AlreadyExists:
            data = (await ref.get()).to_dict() or {}
    if (data.get("deletion") or {}).get("status"):
        raise AccountDeleting()
    return data


def effective_plan(data: dict[str, Any], now: datetime | None = None) -> PlanId:
    """The plan the account is on now: its subscription, or a promo code's plan while it lasts."""
    plan = PlanId(data["plan"]) if data.get("plan") in set(PlanId) else PlanId.FREE
    until = data.get("promoUntil")
    if plan is PlanId.FREE and isinstance(until, datetime) and until > (now or datetime.now(UTC)):
        return PlanId(data["promoPlan"]) if data.get("promoPlan") in set(PlanId) else PlanId.PRO
    return plan


class TrialUsed(Forbidden):
    code = "trial_used"
    title = "Your free minutes are used up"


#: Less than this left of the trial counts as used up: the live gateway refuses a session under it too.
TRIAL_LEFT_MIN_SECONDS = 30


async def plan_limits(user: AuthUser, *, practice: bool = True) -> tuple[PlanId, PlanLimits]:
    """The account's plan and limits.

    `practice` (the default): the caller is about to start or prepare practice, so a free account whose
    trial minutes are used up is refused (`TrialUsed`; the app opens the paywall). Only callers that just
    show or check the limits pass `practice=False`.
    """
    from app.platform.trial import trial_allowed

    data = await ensure_user(user)
    plan = effective_plan(data)
    limits = limits_for(plan, get_settings())
    # One trial per person: a free account whose trial check said no has no free minutes (plans are unaffected).
    if limits.trial_minutes_total is not None and not trial_allowed(data):
        limits = replace(limits, trial_minutes_total=0, live_minutes_month=0)
    # After the trial's minutes, no practice of any kind until a plan: not only the live rooms.
    if practice and limits.trial_minutes_total is not None:
        left = (await live_minutes(clients.firestore(), user.uid, limits))["leftSeconds"] or 0
        if left < TRIAL_LEFT_MIN_SECONDS:
            raise TrialUsed()
    return plan, limits


async def load_consents(uid: str) -> list[Consent]:
    db = clients.firestore()
    paths = UserPaths(uid)
    refs = [db.document(paths.consent(kind.value)) for kind in ConsentKind]
    result: list[Consent] = []
    async for snap in db.get_all(refs):
        kind = ConsentKind(snap.id)
        data = snap.to_dict() or {}
        accepted = bool(data.get("accepted", False))
        version = data.get("version")
        result.append(
            Consent(
                kind=kind,
                accepted=accepted,
                version=version,
                current=accepted and version == CURRENT_CONSENT_VERSION,
                updatedAt=data.get("updatedAt"),
            )
        )
    result.sort(key=lambda c: list(ConsentKind).index(c.kind))
    return result


async def require_consents(user: AuthUser, *kinds: ConsentKind) -> None:
    """Gate AI processing and recording on current, explicit consent (App Store 5.1.2(i))."""
    consents = {c.kind: c for c in await load_consents(user.uid)}
    missing = [k.value for k in kinds if not (consents.get(k) and consents[k].current)]
    if missing:
        raise ConsentRequired(extra={"missing": missing, "version": CURRENT_CONSENT_VERSION})


router = APIRouter(prefix="/me", tags=["me"])


async def _profile(user: AuthUser, data: dict[str, Any]) -> Profile:
    return Profile(
        uid=user.uid,
        displayName=data.get("displayName"),
        plan=effective_plan(data),
        createdAt=data.get("createdAt"),
        consents=await load_consents(user.uid),
        emailVerified=user.email_verified,
        signInProvider=user.sign_in_provider,
    )


@router.get("", response_model=Profile)
async def get_me(user: current_user) -> Profile:
    return await _profile(user, await ensure_user(user))


@router.patch("", response_model=Profile)
async def update_me(body: ProfileUpdate, user: current_user) -> Profile:
    await ensure_user(user)
    ref = clients.firestore().document(UserPaths(user.uid).user())
    await ref.update({"displayName": body.displayName, "updatedAt": firestore.SERVER_TIMESTAMP})
    snap = await ref.get()
    return await _profile(user, snap.to_dict() or {})


@router.put("/consents/{kind}", response_model=Consent)
async def set_consent(kind: Annotated[ConsentKind, Path()], body: ConsentUpdate, user: current_user) -> Consent:
    await ensure_user(user)
    if body.accepted and body.version != CURRENT_CONSENT_VERSION:
        # Accepting an outdated text is not consent to the current processing.
        raise ConsentRequired(extra={"version": CURRENT_CONSENT_VERSION})
    ref = clients.firestore().document(UserPaths(user.uid).consent(kind.value))
    update: dict[str, Any] = {
        "accepted": body.accepted,
        "version": body.version,
        "updatedAt": firestore.SERVER_TIMESTAMP,
    }
    update["acceptedAt" if body.accepted else "withdrawnAt"] = firestore.SERVER_TIMESTAMP
    await ref.set(update, merge=True)
    return next(c for c in await load_consents(user.uid) if c.kind is kind)


@router.get("/usage", response_model=UsageView)
async def get_usage(user: current_user) -> UsageView:
    plan, limits = await plan_limits(user, practice=False)
    usage = UsageService(clients.firestore())
    return UsageView(
        plan=plan,
        limits=asdict(limits),
        month=await usage.totals(user.uid, Period.MONTH),
        today=await usage.totals(user.uid, Period.DAY),
    )
