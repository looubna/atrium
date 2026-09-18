"""Identity comes only from a verified Firebase ID token.

No route reads a user ID from the request body or query. Handlers receive an
`AuthUser` built from the token's claims, and every data access is scoped to
`AuthUser.uid`.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Annotated, Any

import jwt
from fastapi import Depends, Header
from firebase_admin import app_check, auth
from starlette.concurrency import run_in_threadpool

from app.core.errors import Forbidden, Unauthorized
from app.core.logging import uid_var
from app.core.settings import get_settings
from app.platform.clients import clients

log = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class AuthUser:
    uid: str
    email_verified: bool
    sign_in_provider: str
    auth_time: int

    @property
    def is_password_account(self) -> bool:
        return self.sign_in_provider == "password"

    @property
    def verified_for_ai(self) -> bool:
        """Email/password accounts must verify their address; Apple/Google are verified by the IdP."""
        return self.email_verified or not self.is_password_account


class InvalidCredentials(Unauthorized):
    code = "invalid_token"


class RevokedCredentials(Unauthorized):
    code = "token_revoked"


class AppCheckFailed(Unauthorized):
    code = "app_check_failed"
    title = "This app could not be verified"


def _bearer(authorization: str | None) -> str:
    if not authorization:
        raise Unauthorized()
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise InvalidCredentials()
    return token.strip()


async def verify_id_token(token: str, *, check_revoked: bool) -> AuthUser:
    app = clients.firebase_app()
    try:
        claims: dict[str, Any] = await run_in_threadpool(
            auth.verify_id_token, token, app, check_revoked
        )
    except auth.RevokedIdTokenError as exc:
        raise RevokedCredentials() from exc
    except auth.UserDisabledError as exc:
        raise Forbidden("This account is disabled") from exc
    except (auth.InvalidIdTokenError, ValueError) as exc:
        raise InvalidCredentials() from exc
    except auth.CertificateFetchError as exc:
        log.warning("firebase certificate fetch failed")
        raise InvalidCredentials() from exc

    firebase_claims = claims.get("firebase") or {}
    return AuthUser(
        uid=str(claims["uid"]),
        email_verified=bool(claims.get("email_verified", False)),
        sign_in_provider=str(firebase_claims.get("sign_in_provider", "unknown")),
        auth_time=int(claims.get("auth_time", 0)),
    )


async def verify_app_check(token: str | None) -> None:
    settings = get_settings()
    if not settings.app_check_enforced:
        return
    if not token:
        raise AppCheckFailed()
    app = clients.firebase_app()
    try:
        await run_in_threadpool(app_check.verify_token, token, app)
    except (ValueError, jwt.PyJWTError) as exc:
        raise AppCheckFailed() from exc


async def verify_credentials(
    id_token: str, app_check_token: str | None, *, check_revoked: bool
) -> AuthUser:
    """Shared by HTTP dependencies and the WebSocket handshake."""
    await verify_app_check(app_check_token)
    user = await verify_id_token(id_token, check_revoked=check_revoked)
    uid_var.set(user.uid)
    return user


async def _current_user(
    authorization: Annotated[str | None, Header()] = None,
    x_firebase_appcheck: Annotated[str | None, Header()] = None,
) -> AuthUser:
    return await verify_credentials(_bearer(authorization), x_firebase_appcheck, check_revoked=False)


async def _current_user_strict(
    authorization: Annotated[str | None, Header()] = None,
    x_firebase_appcheck: Annotated[str | None, Header()] = None,
) -> AuthUser:
    return await verify_credentials(_bearer(authorization), x_firebase_appcheck, check_revoked=True)


# Most routes verify signature and expiry locally. Sensitive routes (upload
# sessions, account deletion, AI generation) also check revocation, which
# costs a network round trip.
current_user = Annotated[AuthUser, Depends(_current_user)]
current_user_strict = Annotated[AuthUser, Depends(_current_user_strict)]
