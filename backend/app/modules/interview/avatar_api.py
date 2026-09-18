"""A face for the interviewer (`POST /interview/sessions/{id}/avatar-session`).

The candidate's browser never sees the face server's secret and never chooses the face: it asks
for a session, and the server picks the interviewer for that round and returns a short-lived
signed token naming that person's recording.

The avatar is decoration over a working interview. If the face server is not configured, is
slow, or fails, this returns 503 and the call proceeds on audio alone — nothing in the live
session or the evaluation depends on it.
"""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends

from app.core.errors import NotFound, ServiceUnavailable
from app.core.settings import get_settings
from app.modules.interview import livetalking
from app.modules.interview.interviewers import PANEL_AVATARS, PANEL_COLLEAGUES, interviewer_for
from app.platform.auth.dependencies import AuthUser
from app.platform.clients import clients
from app.platform.firestore.paths import UserPaths, require_id
from app.platform.ratelimit import rate_limit
from app.platform.users import ConsentKind, require_consents

router = APIRouter(prefix="/interview/sessions", tags=["interview"])


@router.post("/{session_id}/avatar-session")
async def avatar_session(
    session_id: str,
    user: Annotated[AuthUser, Depends(rate_limit("avatar_session", limit=30, window_seconds=3600))],
) -> dict[str, Any]:
    session_id = require_id(session_id)
    await require_consents(user, ConsentKind.AI_PROCESSING)

    snap = await clients.firestore().document(UserPaths(user.uid).session(session_id)).get()
    if not snap.exists:
        raise NotFound()
    context = (snap.to_dict() or {}).get("context") or {}
    person = interviewer_for(context.get("roundType"))

    settings = get_settings()
    url = settings.livetalking_url.strip()
    secret = settings.livetalking_secret.get_secret_value()
    if not url or not secret:
        raise ServiceUnavailable("no face server is configured")
    # One test recording stands in for everyone until the interviewers are recorded.
    override = settings.livetalking_avatar.strip()

    panel: list[dict[str, str]] = []
    if context.get("panel") == "panel" and not override:
        for member in PANEL_COLLEAGUES:
            face = PANEL_AVATARS.get(member.name)
            if not face:
                continue  # that colleague speaks without a face
            panel.append({"name": member.name, "role": member.role, **livetalking.session(url, secret, face)})

    return {
        **livetalking.session(url, secret, override or person.avatar_id),
        "name": person.name,
        "role": person.role,
        "panel": panel,
    }
