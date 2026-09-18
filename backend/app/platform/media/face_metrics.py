"""Per-second face measurements recorded on the device (`PUT /sessions/{id}/media/face-metrics`).

Numbers only — the app analyses camera frames on the device and discards them.
They're stored with the session's recordings (and deleted with them) and used
for eye contact, expression and composure feedback.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, ConfigDict, Field

from app.core.errors import Conflict, NotFound
from app.platform.auth.dependencies import AuthUser
from app.platform.clients import clients
from app.platform.firestore.paths import UserPaths, require_id
from app.platform.ratelimit import rate_limit
from app.platform.sessions import SessionStatus
from app.platform.storage.objects import user_content
from app.platform.storage.paths import StoragePaths
from app.platform.users import ConsentKind, require_consents

router = APIRouter(prefix="/sessions", tags=["sessions"])

#: Two hours at one entry per second; live rounds are capped well below this.
MAX_SECONDS = 2 * 60 * 60

Fraction = Annotated[float, Field(ge=0, le=1)]


class FaceSecondIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    t: Annotated[int, Field(ge=0, le=MAX_SECONDS)]
    present: Fraction
    eye: Fraction
    smile: Fraction
    move: Fraction
    # In-person panels: share of the second turned toward whoever was speaking.
    toSpeaker: Fraction | None = None


class FaceMetricsBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    seconds: Annotated[list[FaceSecondIn], Field(max_length=MAX_SECONDS)]


@router.put("/{session_id}/media/face-metrics", status_code=204)
async def save_face_metrics(
    session_id: str,
    body: FaceMetricsBody,
    user: Annotated[AuthUser, Depends(rate_limit("face_metrics", limit=20, window_seconds=3600))],
) -> Response:
    session_id = require_id(session_id)
    await require_consents(user, ConsentKind.RECORDING)
    ref = clients.firestore().document(UserPaths(user.uid).session(session_id))
    snap = await ref.get()
    if not snap.exists:
        raise NotFound()
    data = snap.to_dict() or {}
    if data.get("status") not in (SessionStatus.LIVE.value, SessionStatus.ENDED.value) or (
        (data.get("media") or {}).get("deleted")
    ):
        raise Conflict("this session can't take face measurements")

    # One entry per second: a later entry for the same second (after a reconnect) wins.
    seconds = sorted({s.t: s for s in body.seconds}.values(), key=lambda s: s.t)
    payload = {"version": 2, "seconds": [s.model_dump(exclude_none=True) for s in seconds]}
    await user_content().write(
        StoragePaths(user.uid).face_metrics(session_id), json.dumps(payload).encode(), "application/json"
    )
    await ref.update({"media.faceMetrics": {"seconds": len(seconds), "updatedAt": datetime.now(UTC)}})
    return Response(status_code=204)
