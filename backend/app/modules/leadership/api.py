"""Leadership calls (`/api/v1/leadership/...`).

A session is one video call the user leads: the full simulation (several situations in one
team call) or one specific scenario. The team is played live on `/sessions/{id}/live`.
"""

from __future__ import annotations

from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, status
from google.api_core.exceptions import AlreadyExists
from pydantic import BaseModel, ConfigDict, Field

from app.core.errors import NotFound, ServiceUnavailable, ValidationFailed
from app.core.settings import get_settings
from app.modules.interview import livetalking
from app.modules.interview.api import GRACE_MS, EmailNotVerified
from app.modules.interview.sanitize import clean_phrase
from app.modules.leadership import MODULE_ID
from app.modules.leadership.scenarios import FULL_SEQUENCE, Scenario, briefing, scenario_of, world_of
from app.modules.leadership.world import DOMAINS, write_world
from app.platform.auth.dependencies import AuthUser
from app.platform.clients import clients
from app.platform.faces import face_server
from app.platform.firestore.paths import UserPaths, client_uuid, require_id
from app.platform.ratelimit import rate_limit
from app.platform.runtime_config import ai_enabled
from app.platform.sessions import new_session_document
from app.platform.usage import Metric, Period, UsageService
from app.platform.users import ConsentKind, plan_limits, require_consents

router = APIRouter(prefix="/leadership", tags=["leadership"])


class CreateSession(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: Annotated[str, Field(description="Client-generated UUIDv4; retrying with the same id is safe.")]
    mode: Literal["full", "scenario"] = "full"
    scenario: Scenario | None = None
    durationMinutes: Annotated[int, Field(ge=5, le=60)] = 20
    #: The user's field (a `DOMAINS` key) or their own words, and their job title: the call is set there.
    domain: Annotated[str, Field(max_length=80)] = ""
    jobTitle: Annotated[str, Field(max_length=80)] = ""


class SessionCreated(BaseModel):
    id: str
    status: str
    maxDurationMs: int
    liveUrl: str
    #: Who is on the call, the one who speaks most first: name, role, face id.
    team: list[dict[str, str]]
    #: The manager's pre-read: what happened, who is on the call, what the meeting is for.
    briefing: dict[str, Any]


def _team(context: dict[str, Any]) -> list[dict[str, str]]:
    members = world_of(context).on_call(scenario_of(context))
    return [{"key": m.key, "name": m.name, "role": m.role, "avatar": m.avatar_id} for m in members]


def _briefing(context: dict[str, Any]) -> dict[str, Any]:
    return briefing(scenario_of(context), world_of(context))


#: The whole team in one face (`infra/livetalking/recordings/leadership/room.mp4`): Laura top-left,
#: Marcus top-right, Nadia bottom-left, each a 640x360 webcam tile of one 1280x720 stream. The page
#: cuts it into their tiles. One stream means one voice track and one renderer on the face server:
#: three separate faces could not all keep 25 fps, and their voices broke up.
ROOM_FACE = "lr_{}"
#: Where each person sits in the room face, as (x, y) of their 640x360 tile.
ROOM_TILES = {"laura": (0, 0), "marcus": (640, 0), "nadia": (0, 360)}


def _created(session_id: str, data: dict[str, Any]) -> SessionCreated:
    return SessionCreated(
        id=session_id,
        status=str(data.get("status", "")),
        maxDurationMs=int(data.get("maxDurationMs", 0)),
        liveUrl=f"/api/v1/sessions/{session_id}/live",
        team=_team(data.get("context") or {}),
        briefing=_briefing(data.get("context") or {}),
    )


@router.post("/sessions", status_code=status.HTTP_201_CREATED, response_model=SessionCreated)
async def create_session(
    body: CreateSession,
    user: Annotated[AuthUser, Depends(rate_limit("leadership_sessions", limit=30, window_seconds=3600))],
) -> SessionCreated:
    session_id = client_uuid(body.id)
    if body.mode == "scenario" and body.scenario is None:
        raise ValidationFailed("choose a scenario")
    if not user.verified_for_ai:
        raise EmailNotVerified()
    await require_consents(user, ConsentKind.AI_PROCESSING, ConsentKind.RECORDING)
    if not await ai_enabled():
        raise ServiceUnavailable()

    db = clients.firestore()
    ref = db.document(UserPaths(user.uid).session(session_id))
    existing = await ref.get()
    if existing.exists:
        return _created(session_id, existing.to_dict() or {})

    _, limits = await plan_limits(user)
    minutes = min(body.durationMinutes, limits.max_round_minutes)
    context: dict[str, Any] = {"mode": body.mode, "durationMinutes": minutes}
    if body.mode == "scenario" and body.scenario is not None:
        context["scenario"] = body.scenario.value
    # Set in the user's own field: the scenarios this call uses, rewritten for it.
    domain = DOMAINS.get(body.domain) or clean_phrase(body.domain, 80)
    job_title = clean_phrase(body.jobTitle, 80)
    if domain:
        context.update(domain=domain, jobTitle=job_title)
        shown = [body.scenario] if body.mode == "scenario" and body.scenario else list(FULL_SEQUENCE)
        context["world"] = (await write_world(user.uid, domain, job_title, shown)).to_doc()

    await UsageService(db).reserve(user.uid, Metric.SESSIONS, 1, limit=limits.sessions_day, period=Period.DAY)
    doc = new_session_document(module=MODULE_ID, context=context, max_duration_ms=minutes * 60_000 + GRACE_MS)
    try:
        await ref.create(doc)
    except AlreadyExists:
        await UsageService(db).record(user.uid, {Metric.SESSIONS: -1}, period=Period.DAY)
        doc = (await ref.get()).to_dict() or doc
    return _created(session_id, doc)


@router.post("/sessions/{session_id}/avatar-session")
async def avatar_session(
    session_id: str,
    user: Annotated[AuthUser, Depends(rate_limit("avatar_session", limit=30, window_seconds=3600))],
) -> dict[str, Any]:
    """Everyone's live face on the call. A 503 means no faces: the call runs on voices and name tiles."""
    session_id = require_id(session_id)
    await require_consents(user, ConsentKind.AI_PROCESSING)
    snap = await clients.firestore().document(UserPaths(user.uid).session(session_id)).get()
    if not snap.exists:
        raise NotFound()
    team = _team((snap.to_dict() or {}).get("context") or {})

    settings = get_settings()
    url = await face_server().ready_url()  # "" while it is still starting
    secret = settings.livetalking_secret.get_secret_value()
    if not url or not secret:
        raise ServiceUnavailable("no face server")
    lead = team[0]
    if len(team) == 1:  # a one-to-one: that person's own face
        return {**livetalking.session(url, secret, lead["avatar"]), "name": lead["name"], "role": lead["role"],
                "avatar": lead["avatar"], "panel": []}
    room = ROOM_FACE.format(lead["key"])
    return {
        **livetalking.session(url, secret, room),
        "name": lead["name"],
        "role": lead["role"],
        "avatar": room,
        "panel": [],
        # The room face paints whoever the page names, in this order (the lead first).
        "speakers": [m["name"] for m in team],
        "tiles": {m["name"]: ROOM_TILES[m["key"]] for m in team},
    }
