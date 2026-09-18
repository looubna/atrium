"""Short-lived access links for private objects.

Deployed: Cloud Storage V4 signed URLs, signed keylessly through IAM signBlob
with the runtime service account. Local and test: HMAC-signed links to a
local-only route that streams from the filesystem store. Object names always
come from server-built paths, never from the client.
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import secrets
import time
from datetime import timedelta
from urllib.parse import quote, urlencode

from app.core.settings import Env, get_settings

_LOCAL_SECRET = secrets.token_bytes(32)


def _local_signature(bucket: str, name: str, expires: int, disposition: str) -> str:
    message = f"{bucket}\n{name}\n{expires}\n{disposition}".encode()
    return hmac.new(_LOCAL_SECRET, message, hashlib.sha256).hexdigest()


def verify_local_signature(bucket: str, name: str, expires: int, disposition: str, signature: str) -> bool:
    if expires < int(time.time()):
        return False
    return hmac.compare_digest(_local_signature(bucket, name, expires, disposition), signature)


async def signed_get_url(
    bucket: str, name: str, *, expires_in: timedelta, content_type: str, download_filename: str | None = None
) -> str:
    settings = get_settings()
    disposition = f'attachment; filename="{download_filename}"' if download_filename else "inline"
    if settings.app_env in (Env.LOCAL, Env.TEST):
        expires = int(time.time() + expires_in.total_seconds())
        query = urlencode({"exp": expires, "disp": disposition, "type": content_type,
                           "sig": _local_signature(bucket, name, expires, disposition)})
        return f"/api/v1/local-objects/{quote(bucket)}/{quote(name)}?{query}"

    import google.auth
    from google.auth.transport.requests import Request

    from app.platform.clients import clients

    def sign() -> str:
        credentials, _ = google.auth.default()
        credentials.refresh(Request())  # type: ignore[no-untyped-call]
        blob = clients.storage().bucket(bucket).blob(name)
        return str(
            blob.generate_signed_url(
                version="v4",
                method="GET",
                expiration=expires_in,
                response_type=content_type,
                response_disposition=disposition,
                service_account_email=getattr(credentials, "service_account_email", None),
                access_token=credentials.token,
            )
        )

    return await asyncio.to_thread(sign)


def _upload_grant(size: int, content_type: str) -> str:
    return f"upload:{size}:{content_type}"


def verify_local_upload_signature(
    bucket: str, name: str, expires: int, size: int, content_type: str, signature: str
) -> bool:
    return verify_local_signature(bucket, name, expires, _upload_grant(size, content_type), signature)


async def resumable_upload_url(
    bucket: str, name: str, *, content_type: str, size: int, origin: str | None, expires_in: timedelta
) -> str:
    """A resumable upload session for exactly one new object of the declared type and size.

    Cloud Storage: the session URI itself authorizes the upload (valid up to a week, so it is
    handed only to the owner); `if_generation_match=0` refuses to overwrite, and `origin` enables
    CORS for the app. Local and test: an HMAC-signed link to a route implementing the same
    chunked PUT protocol, valid for `expires_in`.
    """
    settings = get_settings()
    if settings.app_env in (Env.LOCAL, Env.TEST):
        expires = int(time.time() + expires_in.total_seconds())
        query = urlencode({"exp": expires, "size": size, "type": content_type,
                           "sig": _local_signature(bucket, name, expires, _upload_grant(size, content_type))})
        return f"/api/v1/local-uploads/{quote(bucket)}/{quote(name)}?{query}"

    from app.platform.clients import clients

    def create() -> str:
        blob = clients.storage().bucket(bucket).blob(name)
        return str(
            blob.create_resumable_upload_session(
                content_type=content_type, size=size, origin=origin, if_generation_match=0
            )
        )

    return await asyncio.to_thread(create)
