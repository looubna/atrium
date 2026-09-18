"""Competency progress across sessions (`/api/v1/competencies`)."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Query
from google.cloud import firestore
from google.cloud.firestore_v1.base_query import FieldFilter

from app.core.errors import NotFound
from app.modules.registry import registry
from app.platform.auth.dependencies import current_user
from app.platform.clients import clients
from app.platform.competencies.catalog import COMMUNICATION
from app.platform.firestore.paths import UserPaths, require_competency_id

router = APIRouter(prefix="/competencies", tags=["competencies"])


def _name(competency_id: str, module: str | None) -> str:
    if competency_id in COMMUNICATION:
        return COMMUNICATION[competency_id].name
    try:
        return str(registry.service(str(module), "competency_name")(competency_id))
    except LookupError:
        return competency_id


@router.get("")
async def list_competencies(user: current_user) -> list[dict[str, Any]]:
    db = clients.firestore()
    items = []
    async for snap in db.collection(UserPaths(user.uid).competencies()).stream():
        data = snap.to_dict() or {}
        items.append(
            {
                "id": snap.id,
                "name": _name(snap.id, data.get("module")),
                **{k: data.get(k) for k in ("layer", "module", "current", "best", "attempts", "lastScore",
                                            "lastDelta", "lastSessionId", "updatedAt")},
            }
        )
    items.sort(key=lambda c: (c["layer"] != "communication", c["name"]))
    return items


@router.get("/{competency_id}/history")
async def competency_history(
    competency_id: str, user: current_user, limit: Annotated[int, Query(ge=1, le=100)] = 20
) -> list[dict[str, Any]]:
    competency_id = require_competency_id(competency_id)
    db = clients.firestore()
    if not (await db.document(UserPaths(user.uid).competency(competency_id)).get()).exists:
        raise NotFound()
    query = (
        db.collection(UserPaths(user.uid).competency_history())
        .where(filter=FieldFilter("competencyId", "==", competency_id))
        .order_by("at", direction=firestore.Query.DESCENDING)
        .limit(limit)
    )
    return [
        {k: (snap.to_dict() or {}).get(k) for k in ("score", "confidence", "sessionId", "context", "at")}
        async for snap in query.stream()
    ]
