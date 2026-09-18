"""Audio of a moment's improved answer (`POST /sessions/{id}/moments/{eventId}/example-audio`).

Synthesized once per evaluation run, moment and voice, kept with the session and
served through short-lived signed links.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query

from app.core.errors import NotFound
from app.core.settings import get_settings
from app.platform.ai.tts import Voice, speak_example
from app.platform.auth.dependencies import AuthUser
from app.platform.clients import clients
from app.platform.firestore.paths import UserPaths, require_id
from app.platform.ratelimit import rate_limit
from app.platform.storage.objects import user_content
from app.platform.storage.paths import StoragePaths
from app.platform.storage.signing import signed_get_url
from app.platform.users import ConsentKind, require_consents

router = APIRouter(prefix="/sessions", tags=["sessions"])

LINK_TTL = timedelta(minutes=90)
FORMATS = (("mp3", "audio/mpeg"), ("wav", "audio/wav"))


@router.post("/{session_id}/moments/{event_id}/example-audio")
async def example_audio(
    session_id: str,
    event_id: str,
    user: Annotated[AuthUser, Depends(rate_limit("example_audio", limit=60, window_seconds=3600))],
    voice: Annotated[Voice, Query()] = "warm",
) -> dict[str, Any]:
    session_id, event_id = require_id(session_id), require_id(event_id)
    await require_consents(user, ConsentKind.AI_PROCESSING)
    db, paths = clients.firestore(), UserPaths(user.uid)
    session = (await db.document(paths.session(session_id)).get()).to_dict()
    run_id = (session or {}).get("currentEvaluationRunId")
    if not run_id:
        raise NotFound()
    event = (await db.document(f"{paths.events(session_id, str(run_id))}/{event_id}").get()).to_dict()
    text = str((event or {}).get("example") or "").strip()
    if not text:
        raise NotFound("this moment has no example answer")

    bucket = get_settings().user_content_bucket
    storage, store = StoragePaths(user.uid), user_content()
    for extension, content_type in FORMATS:
        name = storage.example_audio(session_id, str(run_id), event_id, voice, extension)
        if await store.exists(name):
            return await _link(bucket, name, content_type)

    spoken = await speak_example(text, voice)
    name = storage.example_audio(session_id, str(run_id), event_id, voice, spoken.extension)
    await store.write(name, spoken.audio, spoken.content_type)
    return await _link(bucket, name, spoken.content_type)


async def _link(bucket: str, name: str, content_type: str) -> dict[str, Any]:
    url = await signed_get_url(bucket, name, expires_in=LINK_TTL, content_type=content_type)
    return {"url": url, "expiresAt": (datetime.now(UTC) + LINK_TTL).isoformat()}
