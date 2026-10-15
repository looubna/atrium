"""`POST /faces/warm`: start the face server now, so it is up by the time the candidate sits down.

The page calls this as soon as someone opens the setup of a session with a face, then keeps
calling it while they are on their way in: every call reports how far the start has got, and
holds a running server up so it does not idle off under them.

Both routes cost money (a GPU woken, relay traffic), so only an account that could start a live
session gets them: a verified email and live minutes left, as the live gateway requires.
"""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends

from app.core.errors import Forbidden
from app.platform.auth.dependencies import AuthUser
from app.platform.clients import clients
from app.platform.faces import face_server
from app.platform.faces.ice import ice_servers
from app.platform.faces.pool import Warmth
from app.platform.plans import live_minutes
from app.platform.ratelimit import rate_limit
from app.platform.users import plan_limits

router = APIRouter(prefix="/faces", tags=["faces"])

#: The live gateway refuses a session with less than this left; a face is no use without one.
MIN_LIVE_SECONDS = 30


class NoLiveMinutes(Forbidden):
    code = "no_live_minutes"
    title = "No live minutes left"


async def may_go_live(user: AuthUser) -> bool:
    """Whether this account could start a live session now (the gateway's own checks)."""
    if not user.verified_for_ai:
        return False
    _, limits = await plan_limits(user, practice=False)
    return int((await live_minutes(clients.firestore(), user.uid, limits))["leftSeconds"] or 0) >= MIN_LIVE_SECONDS


@router.post("/warm")
async def warm(
    user: Annotated[AuthUser, Depends(rate_limit("faces_warm", limit=900, window_seconds=3600))],
) -> dict[str, Any]:
    # "Unavailable" rather than an error: the page then simply runs the session on its voice.
    if not await may_go_live(user):
        return Warmth("unavailable").public()
    return (await face_server().warm()).public()


@router.get("/ice")
async def ice(
    user: Annotated[AuthUser, Depends(rate_limit("faces_ice", limit=300, window_seconds=3600))],
) -> dict[str, Any]:
    """Where the face video can travel: STUN for the direct route, and the TURN relay when configured."""
    if not await may_go_live(user):
        raise NoLiveMinutes()
    return {"iceServers": await ice_servers()}
