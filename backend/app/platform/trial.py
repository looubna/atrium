"""One free trial per person, not per email address.

New accounts get the free trial's live minutes (plans.py) unless one of these says it has already been
had: the phone (Android's per-app device id) already gave a trial to another account, the email is from
a throwaway service, or too many trials started from one network today. The app asks once, right after
sign-in (`POST /billing/trial-check`); the answer is stored on the account (`users/{uid}.trial`) and
never re-decided.

Deliberately fail-open, so nobody loses minutes by mistake: an account that was never checked (the
check failed, an older app, accounts from before this existed) keeps its trial, and paid or internal
plans are never affected. Device ids and IP addresses are stored only as keyed hashes.
"""

from __future__ import annotations

import hashlib
import hmac
import ipaddress
import logging
from datetime import UTC, datetime
from functools import lru_cache
from pathlib import Path
from typing import Any

from firebase_admin import auth
from google.cloud import firestore
from starlette.concurrency import run_in_threadpool

from app.core.settings import get_settings
from app.platform.clients import clients
from app.platform.firestore.paths import UserPaths

log = logging.getLogger(__name__)

#: New free trials allowed from one network (IP address) per day: loose, since phone networks and
#: offices share addresses.
TRIALS_PER_IP_DAY = 3
DEVICES = "trialDevices"
NETWORKS = "trialNetworks"


@lru_cache
def disposable_domains() -> frozenset[str]:
    lines = (Path(__file__).with_name("disposable_domains.txt")).read_text().splitlines()
    return frozenset(line.strip().lower() for line in lines if line.strip() and not line.startswith("#"))


def is_disposable(email: str) -> bool:
    domain = email.rsplit("@", 1)[-1].strip().lower()
    # Subdomains of a listed domain (mail.mailinator.com) count too.
    parts = domain.split(".")
    return any(".".join(parts[i:]) in disposable_domains() for i in range(len(parts) - 1))


def _keyed(value: str) -> str:
    salt = get_settings().analytics_salt.get_secret_value()
    return hmac.new(salt.encode(), value.encode(), hashlib.sha256).hexdigest()


def client_ip(forwarded_for: str | None, peer: str | None) -> str | None:
    """The caller's public address: the first X-Forwarded-For hop (Cloud Run's front end sets it)."""
    candidate = (forwarded_for or "").split(",")[0].strip() or (peer or "")
    try:
        address = ipaddress.ip_address(candidate)
    except ValueError:
        return None
    # Local development and private networks don't identify anyone.
    return None if address.is_private or address.is_loopback else str(address)


async def _email(uid: str) -> str:
    try:
        return (await run_in_threadpool(auth.get_user, uid)).email or ""
    except Exception:  # the check is best-effort; never block on it
        return ""


async def check(uid: str, *, device_id: str | None, ip: str | None, now: datetime | None = None) -> dict[str, Any]:
    """Decide, once, whether this account gets the free trial. Returns the stored decision."""
    now = now or datetime.now(UTC)
    db = clients.firestore()
    user_ref = db.document(UserPaths(uid).user())
    existing = ((await user_ref.get()).to_dict() or {}).get("trial")
    if existing:
        return existing

    reason = ""
    if is_disposable(await _email(uid)):
        reason = "disposable_email"
    device_ref = db.collection(DEVICES).document(_keyed(f"device:{device_id}")) if device_id else None
    network_ref = db.collection(NETWORKS).document(f"{_keyed(f'ip:{ip}')}-{now:%Y%m%d}") if ip else None

    @firestore.async_transactional
    async def decide(transaction: firestore.AsyncTransaction) -> dict[str, Any]:
        nonlocal reason
        device = (await device_ref.get(transaction=transaction)).to_dict() if device_ref else None
        network = (await network_ref.get(transaction=transaction)).to_dict() if network_ref else None
        if not reason and device and device.get("uid") not in (None, uid):
            reason = "device_used"
        if not reason and network and int(network.get("count", 0)) >= TRIALS_PER_IP_DAY:
            reason = "network_limit"
        decision = {"eligible": not reason, "reason": reason, "checkedAt": now}
        transaction.set(user_ref, {"trial": decision}, merge=True)
        if not reason:
            if device_ref:
                transaction.set(device_ref, {"uid": uid, "at": now})
            if network_ref:
                transaction.set(network_ref, {"count": int((network or {}).get("count", 0)) + 1, "at": now})
        return decision

    decision = await decide(db.transaction())
    if not decision["eligible"]:
        log.info("free trial not granted", extra={"data": {"reason": decision["reason"]}})
    return decision


def trial_allowed(user_data: dict[str, Any]) -> bool:
    """False only when a check decided so; unchecked accounts keep their trial (fail-open)."""
    return (user_data.get("trial") or {}).get("eligible") is not False
