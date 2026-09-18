"""Account deletion.

`DELETE /api/v1/me` (recent sign-in required) marks the account as deleting,
ends any live session lock and queues the deletion task. The task, on the
worker:
1. disables the Firebase user and revokes refresh tokens;
2. runs module deletion hooks;
3. deletes the user's objects in both buckets and their processing files;
4. deletes server-side state (jobs, live session state, locks) and the whole
   `users/{uid}` subtree;
5. deletes the Firebase user and writes a tombstone keyed by a salted hash
   (no personal data), which also stops a still-valid ID token from recreating
   an empty profile.
Two sweeps repeat steps 3-4 later (after any in-flight request and after ID
tokens issued before disabling have expired).
"""

from __future__ import annotations

import logging
import time
from datetime import UTC, datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Response, status
from google.cloud.firestore_v1.base_query import FieldFilter

from app.core.errors import Unauthorized
from app.core.settings import get_settings
from app.modules.registry import registry
from app.platform.auth.admin import auth_admin
from app.platform.auth.dependencies import AuthUser, _current_user_strict
from app.platform.clients import clients
from app.platform.firestore.paths import UserPaths, deletion_path, uid_hash
from app.platform.jobs.queue import TaskRequest, task_name, task_queue
from app.platform.storage.objects import processing, user_content
from app.platform.storage.paths import StoragePaths, processing_prefix

log = logging.getLogger(__name__)

RECENT_LOGIN_SECONDS = 10 * 60
SWEEP_DELAYS_S = (30 * 60, 65 * 60)
DELETION_QUEUE = "maintenance"
DELETION_PATH = "/internal/account-deletion"


class RecentLoginRequired(Unauthorized):
    code = "recent_login_required"
    title = "Sign in again to delete your account"


router = APIRouter(prefix="/me", tags=["me"])


@router.delete("", status_code=status.HTTP_202_ACCEPTED)
async def delete_account(user: Annotated[AuthUser, Depends(_current_user_strict)]) -> Response:
    if time.time() - user.auth_time > RECENT_LOGIN_SECONDS:
        raise RecentLoginRequired()
    db = clients.firestore()
    now = datetime.now(UTC)
    await db.document(UserPaths(user.uid).user()).set(
        {"deletion": {"status": "pending", "requestedAt": now}}, merge=True
    )
    await db.document(f"liveLocks/{user.uid}").set({"sessionId": None, "until": now}, merge=True)
    await db.document(deletion_path(uid_hash(user.uid, get_settings().analytics_salt.get_secret_value()))).set(
        {"status": "pending", "requestedAt": now}
    )
    await enqueue_deletion(user.uid, pass_number=0)
    log.info("account deletion requested")
    return Response(status_code=status.HTTP_202_ACCEPTED)


async def enqueue_deletion(uid: str, *, pass_number: int, delay_s: int = 0) -> None:
    await task_queue().enqueue(
        TaskRequest(
            queue=DELETION_QUEUE,
            path=DELETION_PATH,
            payload={"uid": uid, "pass": pass_number},
            name=task_name("delete", uid_hash(uid, get_settings().analytics_salt.get_secret_value())[:32],
                           str(pass_number)),
            delay_seconds=delay_s,
        )
    )


async def purge_user_data(uid: str) -> dict[str, int]:
    db = clients.firestore()
    counts = {"objects": 0, "jobs": 0, "liveSessions": 0}

    jobs = db.collection("jobs").where(filter=FieldFilter("uid", "==", uid))
    async for snap in jobs.stream():
        counts["objects"] += await processing().delete_prefix(processing_prefix(snap.id))
        await snap.reference.delete()
        counts["jobs"] += 1

    live = db.collection("liveSessions").where(filter=FieldFilter("uid", "==", uid))
    async for snap in live.stream():
        await snap.reference.delete()
        counts["liveSessions"] += 1

    counts["objects"] += await user_content().delete_prefix(StoragePaths(uid).user_prefix())
    await db.document(f"liveLocks/{uid}").delete()
    await db.recursive_delete(db.document(UserPaths(uid).user()))
    return counts


async def run_deletion(payload: dict[str, Any]) -> None:
    uid = str(payload["uid"])
    pass_number = int(payload.get("pass", 0))
    hashed = uid_hash(uid, get_settings().analytics_salt.get_secret_value())
    admin = auth_admin()

    if pass_number == 0:
        await admin.disable_and_revoke(uid)
        for hook in registry.deletion_hooks():
            await hook(uid)

    counts = await purge_user_data(uid)

    tombstone = clients.firestore().document(deletion_path(hashed))
    if pass_number == 0:
        await admin.delete_user(uid)
        await tombstone.set({"status": "completed", "completedAt": datetime.now(UTC), "sweeps": 0}, merge=True)
        for index, delay in enumerate(SWEEP_DELAYS_S, start=1):
            await enqueue_deletion(uid, pass_number=index, delay_s=delay)
    else:
        await tombstone.set({"sweeps": pass_number, "lastSweepAt": datetime.now(UTC)}, merge=True)
    log.info("account data purged", extra={"pass": pass_number, **counts})


async def is_deleted_account(uid: str) -> bool:
    salt = get_settings().analytics_salt.get_secret_value()
    return bool((await clients.firestore().document(deletion_path(uid_hash(uid, salt))).get()).exists)
