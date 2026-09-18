"""Debates, their materials, and the preparation a debate is built from (`/api/v1/debate/...`).

The three ways in from §4 all land on `POST /debate/debates`:

  * "I have a topic"       — `topic` is the motion the user typed.
  * "Give me a topic"      — the app first calls `POST /debate/topics:suggest` and sends the
                             one the user picked as `topic`.
  * "From my materials"    — no topic; documents are attached, and preparation finds the
                             motions in them.

Every setting is optional and defaulted (§5): a debate created with nothing but a topic is
a complete, sensible debate. Nothing here asks the user to classify anything.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any

from fastapi import APIRouter, Depends, File, Response, UploadFile, status
from google.api_core.exceptions import AlreadyExists
from google.cloud import firestore
from google.cloud.firestore_v1.base_query import FieldFilter
from pydantic import BaseModel, ConfigDict, Field, HttpUrl

from app.core.errors import (
    BadRequest,
    Conflict,
    NotFound,
    PayloadTooLarge,
    QuotaExceeded,
    ServiceUnavailable,
    UnsupportedMedia,
)
from app.core.settings import get_settings
from app.modules.debate import MODULE_ID
from app.modules.debate.catalogs import (
    DebateFormat,
    Difficulty,
    Focus,
    Position,
    PositionMode,
    assign_positions,
    parse_position,
)
from app.modules.debate.topics import needs_research, normalise_motion, suggest_topics
from app.modules.exam.materials import CONTENT_TYPES, EXTENSIONS, UnsupportedMaterial, detect_kind
from app.modules.interview.api import EmailNotVerified
from app.modules.interview.sanitize import clean_phrase, clean_text
from app.platform.auth.dependencies import AuthUser, current_user
from app.platform.clients import clients
from app.platform.firestore.paths import UserPaths, client_uuid, new_id
from app.platform.jobs.module_tasks import enqueue_module_task
from app.platform.ratelimit import rate_limit
from app.platform.runtime_config import ai_enabled
from app.platform.storage.objects import user_content
from app.platform.storage.paths import StoragePaths
from app.platform.usage import Metric, Period, UsageService
from app.platform.users import ConsentKind, plan_limits, require_consents

log = logging.getLogger(__name__)

router = APIRouter(prefix="/debate", tags=["debate"])

#: A preparation normally finishes in a minute or two; an older one lost its worker.
STALE_PREPARATION = timedelta(minutes=15)
MAX_PASTED_CHARS = 50_000
#: Defaults chosen so that a user who configures nothing gets a good debate (§5).
DEFAULT_MINUTES = 15
MIN_MINUTES = 5
MAX_MINUTES = 60


class CreateDebate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: Annotated[str, Field(description="Client-generated UUIDv4; retrying with the same id is safe.")]
    #: Empty only when material is going to be attached: preparation then finds the motion.
    topic: Annotated[str, Field(max_length=300)] = ""
    #: Every one of these has a sensible default; the simple screen sends none of them.
    format: DebateFormat = DebateFormat.FREE
    difficulty: Difficulty = Difficulty.INTERMEDIATE
    positionMode: PositionMode = PositionMode.USER
    #: The side the user wants, when they chose one themselves.
    position: Position | None = None
    durationMinutes: Annotated[int, Field(ge=MIN_MINUTES, le=MAX_MINUTES)] = DEFAULT_MINUTES
    #: None means "decide from the topic" — the usual case (§7).
    researchEnabled: bool | None = None
    voice: bool = True


class UpdateDebate(BaseModel):
    """Changing the settings of a debate that has not been prepared yet."""

    model_config = ConfigDict(extra="forbid")

    topic: Annotated[str, Field(max_length=300)] | None = None
    format: DebateFormat | None = None
    difficulty: Difficulty | None = None
    positionMode: PositionMode | None = None
    position: Position | None = None
    durationMinutes: Annotated[int, Field(ge=MIN_MINUTES, le=MAX_MINUTES)] | None = None
    researchEnabled: bool | None = None
    voice: bool | None = None


class SuggestTopics(BaseModel):
    model_config = ConfigDict(extra="forbid")
    #: What the user is interested in, if they said. Empty asks for a spread of subjects.
    interest: Annotated[str, Field(max_length=200)] = ""


class LinkMaterial(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    url: HttpUrl
    title: Annotated[str, Field(max_length=160)] = ""


class TextMaterial(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    text: Annotated[str, Field(min_length=1, max_length=MAX_PASTED_CHARS)]
    title: Annotated[str, Field(max_length=160)] = ""


def _debate_view(debate_id: str, data: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": debate_id,
        "topic": data.get("topic"),
        "motion": data.get("motion"),
        "status": data.get("status"),
        "format": data.get("format"),
        "difficulty": data.get("difficulty"),
        "positionMode": data.get("positionMode"),
        "askedPosition": data.get("askedPosition"),
        # Only set once preparation has settled them (or the debate started without any).
        "userPosition": data.get("userPosition"),
        "aiPosition": data.get("aiPosition"),
        "durationMinutes": data.get("durationMinutes"),
        "researchEnabled": data.get("researchEnabled"),
        "willResearch": data.get("willResearch"),
        "voice": data.get("voice", True),
        "materialCount": data.get("materialCount", 0),
        "activePrepId": data.get("activePrepId"),
        "createdAt": data.get("createdAt"),
    }


def _material_view(material_id: str, data: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": material_id,
        "source": data.get("source"),
        "name": data.get("name"),
        "url": data.get("url"),
        "status": data.get("status"),
        "failureReason": data.get("failureReason"),
        "sizeBytes": data.get("sizeBytes"),
        "createdAt": data.get("createdAt"),
    }


async def _debate_ref(uid: str, debate_id: str):  # type: ignore[no-untyped-def]
    ref = clients.firestore().document(UserPaths(uid).debate(debate_id))
    if not (await ref.get()).exists:
        raise NotFound()
    return ref


# ---------------------------------------------------------------------------
# Topics


@router.post("/topics:suggest")
async def topics_suggest(
    body: SuggestTopics,
    user: Annotated[AuthUser, Depends(rate_limit("debate_topics", limit=30, window_seconds=3600))],
) -> dict[str, Any]:
    """Motions to choose from, for "Give me a topic"."""
    if not user.verified_for_ai:
        raise EmailNotVerified()
    await require_consents(user, ConsentKind.AI_PROCESSING)
    if not await ai_enabled():
        raise ServiceUnavailable()
    return {"topics": await suggest_topics(user.uid, clean_phrase(body.interest, 200))}


# ---------------------------------------------------------------------------
# Debates


@router.post("/debates", status_code=status.HTTP_201_CREATED)
async def create_debate(body: CreateDebate, user: current_user) -> dict[str, Any]:
    debate_id = client_uuid(body.id)
    db, paths = clients.firestore(), UserPaths(user.uid)
    ref = db.document(paths.debate(debate_id))
    existing = await ref.get()
    if existing.exists:
        return _debate_view(debate_id, existing.to_dict() or {})

    _, limits = await plan_limits(user)
    count = len([s async for s in db.collection(paths.debates()).limit(limits.debates_max + 1).stream()])
    if count >= limits.debates_max:
        raise QuotaExceeded(extra={"metric": "debates", "limit": limits.debates_max})

    topic = normalise_motion(body.topic)
    asked = body.position
    if body.positionMode is PositionMode.USER and asked is None:
        # "I'll pick my side" with no side picked yet: FOR is the side the motion is worded
        # from, which is what a user who did not think about it expects.
        asked = Position.FOR
    doc: dict[str, Any] = {
        "topic": topic,
        "motion": None,
        "status": "draft",
        "format": body.format.value,
        "difficulty": body.difficulty.value,
        "positionMode": body.positionMode.value,
        "askedPosition": asked.value if asked else None,
        "userPosition": None,
        "aiPosition": None,
        "durationMinutes": body.durationMinutes,
        "researchEnabled": body.researchEnabled,
        # What would happen if they started now, so the app can say "we'll look this up first".
        "willResearch": needs_research(topic, asked=body.researchEnabled) if topic else None,
        "voice": body.voice,
        "materialCount": 0,
        "activePrepId": None,
        "createdAt": datetime.now(UTC),
    }
    try:
        await ref.create(doc)
    except AlreadyExists:
        doc = (await ref.get()).to_dict() or doc
    return _debate_view(debate_id, doc)


@router.get("/debates")
async def list_debates(user: current_user) -> list[dict[str, Any]]:
    query = clients.firestore().collection(UserPaths(user.uid).debates()).order_by("createdAt", direction="DESCENDING")
    return [_debate_view(s.id, s.to_dict() or {}) async for s in query.limit(50).stream()]


@router.get("/debates/{debate_id}")
async def get_debate(debate_id: str, user: current_user) -> dict[str, Any]:
    snap = await clients.firestore().document(UserPaths(user.uid).debate(debate_id)).get()
    if not snap.exists:
        raise NotFound()
    return _debate_view(debate_id, snap.to_dict() or {})


@router.patch("/debates/{debate_id}")
async def update_debate(debate_id: str, body: UpdateDebate, user: current_user) -> dict[str, Any]:
    """Change the settings before the debate is prepared.

    Positions are settled by preparation and never re-rolled afterwards, so a prepared
    debate refuses changes: the user starts a new one instead, which costs them nothing.
    """
    ref = await _debate_ref(user.uid, debate_id)
    current = (await ref.get()).to_dict() or {}
    if current.get("activePrepId"):
        raise Conflict("this debate has already been prepared")

    values: dict[str, Any] = {}
    if body.topic is not None:
        values["topic"] = normalise_motion(body.topic)
    for field, value in (
        ("format", body.format), ("difficulty", body.difficulty), ("positionMode", body.positionMode),
    ):
        if value is not None:
            values[field] = value.value
    if body.position is not None:
        values["askedPosition"] = body.position.value
    if body.durationMinutes is not None:
        values["durationMinutes"] = body.durationMinutes
    if body.researchEnabled is not None:
        values["researchEnabled"] = body.researchEnabled
    if body.voice is not None:
        values["voice"] = body.voice
    if not values:
        return _debate_view(debate_id, current)

    merged = {**current, **values}
    topic = str(merged.get("topic") or "")
    values["willResearch"] = needs_research(topic, asked=merged.get("researchEnabled")) if topic else None
    values["updatedAt"] = datetime.now(UTC)
    await ref.update(values)
    return _debate_view(debate_id, (await ref.get()).to_dict() or merged)


@router.delete("/debates/{debate_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_debate(debate_id: str, user: current_user) -> Response:
    db = clients.firestore()
    ref = db.document(UserPaths(user.uid).debate(debate_id))
    if not (await ref.get()).exists:
        raise NotFound()
    await user_content().delete_prefix(StoragePaths(user.uid).debate_prefix(debate_id))
    await db.recursive_delete(ref)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------------------
# Materials


async def _add_material(
    user: AuthUser, debate_id: str, material_id: str, doc: dict[str, Any], *, extract: bool
) -> dict[str, Any]:
    db, paths = clients.firestore(), UserPaths(user.uid)
    ref = db.document(paths.debate_material(debate_id, material_id))
    existing = await ref.get()
    if existing.exists:
        return _material_view(material_id, existing.to_dict() or {})
    _, limits = await plan_limits(user)
    count = len(
        [
            s
            async for s in db.collection(paths.debate_materials(debate_id))
            .limit(limits.materials_per_debate_max + 1)
            .stream()
        ]
    )
    if count >= limits.materials_per_debate_max:
        raise QuotaExceeded(extra={"metric": "materials", "limit": limits.materials_per_debate_max})
    doc = {**doc, "createdAt": datetime.now(UTC)}
    try:
        await ref.create(doc)
    except AlreadyExists:
        return _material_view(material_id, (await ref.get()).to_dict() or doc)
    await db.document(paths.debate(debate_id)).update(
        # Incremented rather than written, so two uploads at once cannot lose one another.
        {"materialCount": firestore.Increment(1), "status": "draft", "updatedAt": datetime.now(UTC)}
    )
    if extract:
        await enqueue_module_task(
            MODULE_ID, "extract_debate_material",
            {"uid": user.uid, "debateId": debate_id, "materialId": material_id},
            name_parts=(debate_id, material_id),
        )
    return _material_view(material_id, doc)


@router.get("/debates/{debate_id}/materials")
async def list_materials(debate_id: str, user: current_user) -> list[dict[str, Any]]:
    await _debate_ref(user.uid, debate_id)
    query = clients.firestore().collection(UserPaths(user.uid).debate_materials(debate_id)).order_by("createdAt")
    return [_material_view(s.id, s.to_dict() or {}) async for s in query.limit(100).stream()]


@router.post("/debates/{debate_id}/materials", status_code=status.HTTP_201_CREATED)
async def upload_material(
    debate_id: str,
    file: Annotated[UploadFile, File()],
    user: Annotated[AuthUser, Depends(rate_limit("debate_material_upload", limit=120, window_seconds=3600))],
) -> dict[str, Any]:
    # The document is read by AI to find what can be debated in it.
    await require_consents(user, ConsentKind.AI_PROCESSING)
    await _debate_ref(user.uid, debate_id)
    settings = get_settings()
    data = await file.read(settings.max_material_bytes + 1)
    if len(data) > settings.max_material_bytes:
        raise PayloadTooLarge(f"Each file can be up to {settings.max_material_bytes // 1_048_576} MB")
    try:
        kind = detect_kind(file.filename or "", data)
    except UnsupportedMaterial as exc:
        raise UnsupportedMedia("Upload a PDF, Word, PowerPoint, text file or image") from exc

    material_id = new_id()
    storage_path = StoragePaths(user.uid).debate_material_original(debate_id, material_id, EXTENSIONS[kind])
    await user_content().write(storage_path, data, CONTENT_TYPES[kind], create_only=True)
    doc = {
        "source": "file",
        "name": clean_phrase(file.filename or f"material.{kind}", 160),
        "kind": kind,
        "contentType": CONTENT_TYPES[kind],
        "sizeBytes": len(data),
        "storagePath": storage_path,
        "status": "processing",
    }
    return await _add_material(user, debate_id, material_id, doc, extract=True)


@router.post("/debates/{debate_id}/materials/link", status_code=status.HTTP_201_CREATED)
async def add_link(
    debate_id: str,
    body: LinkMaterial,
    user: Annotated[AuthUser, Depends(rate_limit("debate_material_upload", limit=120, window_seconds=3600))],
) -> dict[str, Any]:
    await require_consents(user, ConsentKind.AI_PROCESSING)
    await _debate_ref(user.uid, debate_id)
    url = str(body.url)
    if len(url) > 2_000:
        raise UnsupportedMedia("That link is too long")
    # Links are never fetched from here: the grounded researcher searches the web itself.
    # Nothing in this service ever requests a URL a user supplied.
    doc = {
        "source": "link",
        "name": clean_phrase(body.title, 160) or url[:160],
        "url": url,
        "status": "ready",
    }
    return await _add_material(user, debate_id, client_uuid(body.id), doc, extract=False)


@router.post("/debates/{debate_id}/materials/text", status_code=status.HTTP_201_CREATED)
async def add_text(
    debate_id: str,
    body: TextMaterial,
    user: Annotated[AuthUser, Depends(rate_limit("debate_material_upload", limit=120, window_seconds=3600))],
) -> dict[str, Any]:
    await require_consents(user, ConsentKind.AI_PROCESSING)
    await _debate_ref(user.uid, debate_id)
    material_id = client_uuid(body.id)
    text = clean_text(body.text, MAX_PASTED_CHARS)
    if not text:
        raise UnsupportedMedia("That text has nothing readable in it")
    storage_path = StoragePaths(user.uid).debate_material_text(debate_id, material_id)
    await user_content().write(storage_path, text.encode(), "text/plain; charset=utf-8")
    doc = {
        "source": "text",
        "name": clean_phrase(body.title, 160) or "Pasted text",
        "kind": "txt",
        "sizeBytes": len(text.encode()),
        "textPath": storage_path,
        "status": "ready",
    }
    return await _add_material(user, debate_id, material_id, doc, extract=False)


@router.delete("/debates/{debate_id}/materials/{material_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_material(debate_id: str, material_id: str, user: current_user) -> Response:
    db, paths = clients.firestore(), UserPaths(user.uid)
    ref = db.document(paths.debate_material(debate_id, material_id))
    if not (await ref.get()).exists:
        raise NotFound()
    await user_content().delete_prefix(StoragePaths(user.uid).debate_material_prefix(debate_id, material_id))
    await ref.delete()
    remaining = len([s async for s in db.collection(paths.debate_materials(debate_id)).limit(200).stream()])
    await db.document(paths.debate(debate_id)).update({"materialCount": remaining})
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------------------
# Preparation


@router.post("/debates/{debate_id}/preparations:generate", status_code=status.HTTP_202_ACCEPTED)
async def generate_preparation(
    debate_id: str,
    user: Annotated[AuthUser, Depends(rate_limit("debate_preparation", limit=20, window_seconds=3600))],
) -> dict[str, Any]:
    db, paths = clients.firestore(), UserPaths(user.uid)
    debate_ref = await _debate_ref(user.uid, debate_id)
    debate = (await debate_ref.get()).to_dict() or {}
    if not user.verified_for_ai:
        raise EmailNotVerified()
    await require_consents(user, ConsentKind.AI_PROCESSING)
    if not await ai_enabled():
        raise ServiceUnavailable()
    if not debate.get("topic") and not int(debate.get("materialCount", 0)):
        raise BadRequest("give a topic or attach something to debate from")

    running = db.collection(paths.debate_preps(debate_id)).where(
        filter=FieldFilter("status", "in", ["queued", "preparing"])
    )
    now = datetime.now(UTC)
    async for snap in running.limit(5).stream():
        current = snap.to_dict() or {}
        started = current.get("startedAt") or current.get("createdAt")
        if started is not None and now - started < STALE_PREPARATION:
            raise Conflict("this debate is already being prepared")
        await snap.reference.update({"status": "failed", "failureReason": "stalled"})

    _, limits = await plan_limits(user)
    await UsageService(db).reserve(
        user.uid, Metric.DEBATE_PREPS, 1, limit=limits.debate_preparations_day, period=Period.DAY
    )
    prep_id = new_id()
    versions = [s async for s in db.collection(paths.debate_preps(debate_id)).stream()]
    await db.document(paths.debate_prep(debate_id, prep_id)).set(
        {"status": "queued", "version": len(versions) + 1, "attempts": 0, "createdAt": now}
    )
    await debate_ref.update({"status": "preparing"})
    await enqueue_module_task(
        MODULE_ID, "prepare_debate", {"uid": user.uid, "debateId": debate_id, "prepId": prep_id},
        name_parts=(debate_id, prep_id),
    )
    return {"prepId": prep_id, "status": "queued"}


@router.get("/debates/{debate_id}/preparations/{prep_id}")
async def get_preparation(debate_id: str, prep_id: str, user: current_user) -> dict[str, Any]:
    """What the user sees before the debate (§10).

    The brief holds both sides' arguments, because the opponent argues from the same
    document. The user is shown their own side, the concepts, the evidence and where they
    will be pressed — never the opponent's plan of attack, which would make the debate a
    rehearsal instead of a debate.
    """
    snap = await clients.firestore().document(UserPaths(user.uid).debate_prep(debate_id, prep_id)).get()
    if not snap.exists:
        raise NotFound()
    data = snap.to_dict() or {}
    data.pop("research", None)  # kept only so a retry need not search again
    user_position = parse_position(data.get("userPosition"))
    mine = (
        data.get("argumentsFor", []) if user_position is Position.FOR else data.get("argumentsAgainst", [])
    )
    return {
        "id": prep_id,
        "status": data.get("status"),
        "failureReason": data.get("failureReason"),
        "progress": data.get("progress"),
        "motion": data.get("motion"),
        "userPosition": data.get("userPosition"),
        "aiPosition": data.get("aiPosition"),
        "positionMode": data.get("positionMode"),
        "researchEnabled": data.get("researchEnabled"),
        "topicContext": data.get("topicContext"),
        "concepts": data.get("concepts", []),
        # Facts keep the label that says what kind of claim each one is.
        "keyFacts": data.get("keyFacts", []),
        "sources": data.get("sources", []),
        "searchSuggestionsHtml": data.get("searchSuggestionsHtml"),
        # What they should be ready to defend: their own side, with the weakness of each.
        "yourArguments": mine,
        "challengeAreas": data.get("challengeAreas", []),
        "caveats": data.get("caveats", []),
        "materialSummary": data.get("materialSummary"),
        "materialContradictions": data.get("materialContradictions", []),
        # Motions found in the material, for a debate started from documents.
        "materialTopics": data.get("materialTopics", []),
        "unsourcedClaims": data.get("unsourcedClaims", []),
    }


__all__ = ["DEFAULT_MINUTES", "Focus", "assign_positions", "router"]
