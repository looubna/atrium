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
from app.modules.interview.interviewers import PANEL_AVATARS, lead_for, panel_for
from app.platform.auth.dependencies import AuthUser
from app.platform.clients import clients
from app.platform.faces import face_server
from app.platform.firestore.paths import UserPaths, require_id
from app.platform.ratelimit import rate_limit
from app.platform.users import ConsentKind, require_consents

router = APIRouter(prefix="/interview/sessions", tags=["interview"])

#: The in-person panel is one shot of the lead and both colleagues at the table, prepared on the face
#: server as a single face with one speaker per person (`speakers/` beside it): the lead is 0, the
#: colleagues follow in `PANEL_IN_PERSON` order. The page names the speaker before each turn.
PANEL_ROOM_FACE = "panel_room"


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
    person = lead_for(context.get("roundType"), in_person=context.get("mode") == "in_person")

    settings = get_settings()
    url = await face_server().ready_url()  # "" while it is still starting
    secret = settings.livetalking_secret.get_secret_value()
    if not url or not secret:
        raise ServiceUnavailable("no face server is configured")
    # One test recording stands in for everyone until the interviewers are recorded.
    override = settings.livetalking_avatar.strip()

    in_person = context.get("mode") == "in_person"
    if in_person and context.get("panel") == "panel":
        room = livetalking.mapped_face(PANEL_ROOM_FACE, settings.livetalking_faces)
        if not room:
            raise ServiceUnavailable("no face for the meeting room")
        return {
            **livetalking.session(url, secret, room),
            "name": person.name,
            "role": person.role,
            "avatar": room,
            "panel": [],
            "speakers": [person.name, *(m.name for m in panel_for(True).colleagues)],
        }

    lead_face = livetalking.face_for(person.avatar_id, settings.livetalking_faces, override)

    panel: list[dict[str, str]] = []
    if context.get("panel") == "panel":
        for member in panel_for(context.get("mode") == "in_person").colleagues:
            # Their own recording, remapped by `livetalking_faces` like anyone else's, so a
            # colleague can borrow a recorded face until they have one. No stand-in here: the
            # point of the stand-in is that *someone* has a face, and a colleague wearing the
            # lead's would put the same person on two tiles at once.
            face = livetalking.mapped_face(PANEL_AVATARS.get(member.name, ""), settings.livetalking_faces)
            if not face or face == lead_face:
                continue  # no recording of their own, or it would be the lead's twin
            panel.append({"name": member.name, "role": member.role, "avatar": face,
                          **livetalking.session(url, secret, face)})

    return {
        **livetalking.session(url, secret, lead_face),
        "name": person.name,
        "role": person.role,
        # Which recording is actually playing. The client needs it to know how that recording
        # frames its person, so the live face can be drawn into the right chair in the room shot.
        "avatar": lead_face,
        "panel": panel,
    }
