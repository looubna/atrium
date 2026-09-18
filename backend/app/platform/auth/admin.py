"""Firebase Auth administration used by account deletion (behind an interface for tests)."""

from __future__ import annotations

from typing import Protocol

from firebase_admin import auth
from starlette.concurrency import run_in_threadpool

from app.platform.clients import clients


class AuthAdmin(Protocol):
    async def disable_and_revoke(self, uid: str) -> None: ...

    async def delete_user(self, uid: str) -> None: ...


class FirebaseAuthAdmin:
    async def disable_and_revoke(self, uid: str) -> None:
        app = clients.firebase_app()
        try:
            await run_in_threadpool(auth.update_user, uid, disabled=True, app=app)
            await run_in_threadpool(auth.revoke_refresh_tokens, uid, app)
        except auth.UserNotFoundError:
            return

    async def delete_user(self, uid: str) -> None:
        try:
            await run_in_threadpool(auth.delete_user, uid, clients.firebase_app())
        except auth.UserNotFoundError:
            return


def auth_admin() -> AuthAdmin:
    override = clients.overrides.get("auth_admin")
    if override is not None:
        return override  # type: ignore[no-any-return]
    return FirebaseAuthAdmin()
