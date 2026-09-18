from __future__ import annotations

import httpx
import pytest
from google.cloud import firestore

from app.core.errors import ConsentRequired
from app.platform.auth.dependencies import AuthUser
from app.platform.users import CURRENT_CONSENT_VERSION, ConsentKind, require_consents
from tests.integration.conftest import as_user

ME = "/api/v1/me"
CONSENT_OK = {"accepted": True, "version": CURRENT_CONSENT_VERSION}


async def test_unauthenticated_is_rejected(api: httpx.AsyncClient) -> None:
    r = await api.get(ME)
    assert r.status_code == 401


async def test_first_contact_creates_free_profile(api: httpx.AsyncClient, db: firestore.AsyncClient) -> None:
    r = await api.get(ME, headers=as_user("alice"))
    assert r.status_code == 200
    body = r.json()
    assert body["uid"] == "alice"
    assert body["plan"] == "free"
    assert {c["kind"]: c["current"] for c in body["consents"]} == {
        "ai_processing": False, "recording": False, "video_analysis": False,
    }
    assert (await db.document("users/alice").get()).exists

    again = await api.get(ME, headers=as_user("alice"))
    assert again.json()["createdAt"] is not None


async def test_profile_update_is_validated_and_cannot_change_plan(api: httpx.AsyncClient) -> None:
    r = await api.patch(ME, headers=as_user("alice"), json={"displayName": "  Ada   Lovelace "})
    assert r.status_code == 200
    assert r.json()["displayName"] == "Ada Lovelace"

    escalate = await api.patch(ME, headers=as_user("alice"), json={"displayName": "Ada", "plan": "internal"})
    assert escalate.status_code == 422

    control_chars = "bad" + chr(7) + "name"
    control = await api.patch(ME, headers=as_user("alice"), json={"displayName": control_chars})
    assert control.status_code == 422

    assert (await api.get(ME, headers=as_user("alice"))).json()["plan"] == "free"


async def test_users_are_isolated(api: httpx.AsyncClient) -> None:
    await api.patch(ME, headers=as_user("alice"), json={"displayName": "Alice"})
    await api.patch(ME, headers=as_user("bob"), json={"displayName": "Bob"})
    assert (await api.get(ME, headers=as_user("alice"))).json()["displayName"] == "Alice"
    assert (await api.get(ME, headers=as_user("bob"))).json()["displayName"] == "Bob"


async def test_consent_lifecycle(api: httpx.AsyncClient) -> None:
    url = f"{ME}/consents/ai_processing"
    stale = await api.put(url, headers=as_user("alice"), json={"accepted": True, "version": "2020-01-01"})
    assert stale.status_code == 403
    assert stale.json()["code"] == "consent_required"

    ok = await api.put(url, headers=as_user("alice"), json=CONSENT_OK)
    assert ok.status_code == 200
    assert ok.json()["current"] is True

    user = AuthUser(uid="alice", email_verified=True, sign_in_provider="apple.com", auth_time=0)
    await require_consents(user, ConsentKind.AI_PROCESSING)
    with pytest.raises(ConsentRequired):
        await require_consents(user, ConsentKind.AI_PROCESSING, ConsentKind.RECORDING)

    withdrawn = await api.put(url, headers=as_user("alice"), json={**CONSENT_OK, "accepted": False})
    assert withdrawn.json()["current"] is False
    with pytest.raises(ConsentRequired):
        await require_consents(user, ConsentKind.AI_PROCESSING)


async def test_unknown_consent_kind(api: httpx.AsyncClient) -> None:
    r = await api.put(f"{ME}/consents/marketing", headers=as_user("alice"), json=CONSENT_OK)
    assert r.status_code == 422


async def test_account_being_deleted_is_locked(api: httpx.AsyncClient, db: firestore.AsyncClient) -> None:
    await db.document("users/carol").set({"plan": "free", "deletion": {"status": "pending"}})
    r = await api.get(ME, headers=as_user("carol"))
    assert r.status_code == 403
    assert r.json()["code"] == "account_deleting"


async def test_usage_reports_plan_limits(api: httpx.AsyncClient) -> None:
    r = await api.get(f"{ME}/usage", headers=as_user("alice"))
    assert r.status_code == 200
    body = r.json()
    assert body["plan"] == "free"
    assert body["limits"]["concurrent_live_sessions"] == 1
    assert body["month"]["liveSeconds"] == 0
