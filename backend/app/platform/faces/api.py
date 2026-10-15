"""`POST /faces/warm`: start the face server now, so it is up by the time the candidate sits down.

The page calls this as soon as someone opens the setup of a session with a face, then keeps
calling it while they are on their way in: every call reports how far the start has got, and
holds a running server up so it does not idle off under them.
"""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends

from app.platform.auth.dependencies import AuthUser
from app.platform.faces import face_server
from app.platform.faces.ice import ice_servers
from app.platform.ratelimit import rate_limit

router = APIRouter(prefix="/faces", tags=["faces"])


@router.post("/warm")
async def warm(
    _user: Annotated[AuthUser, Depends(rate_limit("faces_warm", limit=900, window_seconds=3600))],
) -> dict[str, Any]:
    return (await face_server().warm()).public()


@router.get("/ice")
async def ice(
    _user: Annotated[AuthUser, Depends(rate_limit("faces_ice", limit=300, window_seconds=3600))],
) -> dict[str, Any]:
    """Where the face video can travel: STUN for the direct route, and the TURN relay when configured."""
    return {"iceServers": await ice_servers()}
