"""Preparing for one scholarship or admission interview (`/api/v1/admission/preparations`).

The candidate names the opportunity and hands over whatever they already have. That is the
whole of the input (§4): nothing here asks them to classify a document, pick a track, or fill
in a form about themselves, because the analyzer works out what each file is and the
researcher works out what the opportunity wants.

Creating a preparation returns immediately and starts the work behind it (§10). The candidate
watches a checklist rather than a spinner, and may add materials while research is still
running — the two stages are independent, and a scholarship's own guidelines are often the
last thing somebody finds.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Annotated, Any

from fastapi import APIRouter, File, Response, UploadFile, status
from google.api_core.exceptions import AlreadyExists
from pydantic import BaseModel, ConfigDict, Field, HttpUrl

from app.core.errors import NotFound, PayloadTooLarge, QuotaExceeded, ServiceUnavailable, UnsupportedMedia
from app.modules.admission import MODULE_ID
from app.modules.admission.cache import COLLECTION as RESEARCH_COLLECTION
from app.modules.admission.cache import current_cycle
from app.modules.admission.cache import from_document as profile_from_document
from app.modules.admission.catalogs import MATERIAL_LABELS, parse_kind, parse_material_type
from app.modules.admission.preparations import (
    Stage,
    StageState,
    from_document,
    mark_stage,
    to_document,
)
from app.modules.exam.materials import CONTENT_TYPES, EXTENSIONS, UnsupportedMaterial, detect_kind
from app.modules.interview.api import EmailNotVerified
from app.modules.interview.sanitize import clean_phrase, clean_text
from app.platform.auth.dependencies import current_user
from app.platform.clients import clients
from app.platform.firestore.paths import UserPaths, client_uuid, new_id, require_id
from app.platform.jobs.module_tasks import enqueue_module_task
from app.platform.runtime_config import ai_enabled
from app.platform.storage.objects import user_content
from app.platform.storage.paths import StoragePaths
from app.platform.users import ConsentKind, plan_limits, require_consents

log = logging.getLogger(__name__)

router = APIRouter(prefix="/admission/preparations", tags=["admission"])

#: One person does not prepare for fifty scholarships at once, and each one costs a research
#: run. Generous enough that nobody hits it while preparing honestly.
MAX_PREPARATIONS = 20
#: Enough for a CV, a statement, a study plan, a proposal, essays and the funder's own pages.
MAX_MATERIALS = 20
MAX_PASTED_CHARS = 50_000
MAX_UPLOAD_BYTES = 20 * 1024 * 1024


class PreparationCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    name: Annotated[str, Field(min_length=1, max_length=160)]
    #: "scholarship", "admission" or "both" (§4's three-way choice).
    kind: str = "both"
    #: The programme or department, when the candidate knows it. Sharpens the research and is
    #: routinely unknown at this stage, so it is never required.
    program: Annotated[str, Field(max_length=160)] = ""


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


def _material_view(material_id: str, data: dict[str, Any]) -> dict[str, Any]:
    kind = parse_material_type(data.get("type"))
    return {
        "id": material_id,
        "title": data.get("title", ""),
        "source": data.get("source", "upload"),
        "type": str(kind),
        # What the analyzer decided it is, in the candidate's words. Blank until it has read
        # it: guessing on the filename and showing that as fact is how "essay_final_v3.pdf"
        # becomes a research proposal on screen.
        "typeLabel": MATERIAL_LABELS.get(kind, "") if data.get("type") else "",
        "status": data.get("status", "pending"),
        "createdAt": data.get("createdAt"),
    }


async def _preparation_ref(uid: str, prep_id: str) -> Any:
    ref = clients.firestore().document(UserPaths(uid).admission_preparation(require_id(prep_id)))
    if not (await ref.get()).exists:
        raise NotFound()
    return ref


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_preparation(body: PreparationCreate, user: current_user) -> dict[str, Any]:
    """Start preparing. Returns at once; the research runs behind the checklist."""
    if not user.verified_for_ai:
        raise EmailNotVerified()
    await require_consents(user, ConsentKind.AI_PROCESSING)
    if not await ai_enabled():
        raise ServiceUnavailable()
    await plan_limits(user)  # refuses once a free account's trial minutes are used up

    prep_id = client_uuid(body.id)
    db, paths = clients.firestore(), UserPaths(user.uid)
    ref = db.document(paths.admission_preparation(prep_id))
    if (existing := await ref.get()).exists:
        return from_document(prep_id, existing.to_dict() or {}).model_dump(mode="json")

    count = len([s async for s in db.collection(paths.admission_preparations()).limit(MAX_PREPARATIONS + 1).stream()])
    if count >= MAX_PREPARATIONS:
        raise QuotaExceeded(extra={"metric": "admissionPreparations", "limit": MAX_PREPARATIONS})

    kind = parse_kind(body.kind)
    cycle = current_cycle()
    doc = to_document(
        name=clean_phrase(body.name, 160),
        kind=kind,
        cycle=cycle,
        program=clean_phrase(body.program, 160),
    )
    try:
        await ref.create(doc)
    except AlreadyExists:
        doc = (await ref.get()).to_dict() or doc
        return from_document(prep_id, doc).model_dump(mode="json")

    await _start_research(user.uid, prep_id, doc)
    return from_document(prep_id, (await ref.get()).to_dict() or doc).model_dump(mode="json")


async def _start_research(uid: str, prep_id: str, doc: dict[str, Any]) -> None:
    """Queue the research, and say so on the checklist even if the queue is unavailable.

    A preparation whose job never started must not sit at "pending" for ever looking like it
    is working: the candidate would wait on nothing. If the queue refuses the task the stage
    is marked failed immediately, which the app reads as "let them in with what there is".
    """
    queued = await enqueue_module_task(
        MODULE_ID,
        "research_opportunity",
        {"uid": uid, "preparationId": prep_id},
        name_parts=(uid, prep_id),
    )
    ref = clients.firestore().document(UserPaths(uid).admission_preparation(prep_id))
    stages = mark_stage(
        doc["stages"],
        Stage.RESEARCH,
        StageState.RUNNING if queued else StageState.FAILED,
        note="" if queued else "Could not start the research just now",
    )
    await ref.update({"stages": stages, "updatedAt": datetime.now(UTC)})


@router.get("")
async def list_preparations(user: current_user) -> list[dict[str, Any]]:
    query = (
        clients.firestore()
        .collection(UserPaths(user.uid).admission_preparations())
        .order_by("createdAt", direction="DESCENDING")
    )
    return [from_document(s.id, s.to_dict() or {}).model_dump(mode="json") async for s in query.limit(50).stream()]


@router.get("/{prep_id}")
async def get_preparation(prep_id: str, user: current_user) -> dict[str, Any]:
    """What the app polls while the checklist fills in."""
    snap = await clients.firestore().document(UserPaths(user.uid).admission_preparation(require_id(prep_id))).get()
    if not snap.exists:
        raise NotFound()
    return from_document(prep_id, snap.to_dict() or {}).model_dump(mode="json")


@router.get("/{prep_id}/opportunity")
async def get_opportunity(prep_id: str, user: current_user) -> dict[str, Any]:
    """What research found: the dashboard's "what we researched" (§20).

    Read from the shared cache rather than copied into the preparation, so a refreshed
    profile reaches everyone preparing for that cycle.
    """
    snap = await clients.firestore().document(UserPaths(user.uid).admission_preparation(require_id(prep_id))).get()
    if not snap.exists:
        raise NotFound()
    data = snap.to_dict() or {}
    key = str(data.get("opportunityKey") or "")
    if not key:
        raise NotFound()
    entry = await clients.firestore().document(f"{RESEARCH_COLLECTION}/{key}").get()
    profile = profile_from_document(entry.to_dict() or {}) if entry.exists else None
    if profile is None:
        raise NotFound()
    return profile.model_dump(mode="json")


@router.get("/{prep_id}/plan")
async def get_plan(prep_id: str, user: current_user) -> dict[str, Any]:
    """What to prepare: the questions, what stands out, what the file leaves unexplained.

    Separate from the preparation itself so the checklist stays small enough to poll every
    couple of seconds while this is still being written.
    """
    snap = await clients.firestore().document(UserPaths(user.uid).admission_preparation(require_id(prep_id))).get()
    if not snap.exists:
        raise NotFound()
    plan = (snap.to_dict() or {}).get("plan")
    if not plan:
        raise NotFound()
    return dict(plan)


@router.get("/{prep_id}/candidate")
async def get_candidate(prep_id: str, user: current_user) -> dict[str, Any]:
    """The candidate as their own documents describe them, with the quotes behind each claim."""
    snap = await clients.firestore().document(UserPaths(user.uid).admission_preparation(require_id(prep_id))).get()
    if not snap.exists:
        raise NotFound()
    profile = (snap.to_dict() or {}).get("candidateProfile")
    if not profile:
        raise NotFound()
    return dict(profile)


@router.delete("/{prep_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_preparation(prep_id: str, user: current_user) -> Response:
    db = clients.firestore()
    ref = db.document(UserPaths(user.uid).admission_preparation(require_id(prep_id)))
    if not (await ref.get()).exists:
        raise NotFound()
    await user_content().delete_prefix(StoragePaths(user.uid).admission_prefix(prep_id))
    await db.recursive_delete(ref)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{prep_id}/materials")
async def list_materials(prep_id: str, user: current_user) -> list[dict[str, Any]]:
    await _preparation_ref(user.uid, prep_id)
    query = clients.firestore().collection(UserPaths(user.uid).admission_materials(prep_id)).order_by("createdAt")
    return [_material_view(s.id, s.to_dict() or {}) async for s in query.limit(MAX_MATERIALS * 2).stream()]


async def _add_material(uid: str, prep_id: str, material_id: str, doc: dict[str, Any]) -> dict[str, Any]:
    """Store one material and queue the read of it. Shared by upload, link and paste."""
    db, paths = clients.firestore(), UserPaths(uid)
    prep = db.document(paths.admission_preparation(prep_id))
    count = len([s async for s in db.collection(paths.admission_materials(prep_id)).limit(MAX_MATERIALS + 1).stream()])
    if count >= MAX_MATERIALS:
        raise QuotaExceeded(extra={"metric": "admissionMaterials", "limit": MAX_MATERIALS})

    ref = db.document(paths.admission_material(prep_id, material_id))
    try:
        await ref.create(doc)
    except AlreadyExists:
        return _material_view(material_id, (await ref.get()).to_dict() or doc)

    await prep.update({"materialCount": count + 1, "updatedAt": datetime.now(UTC)})
    await enqueue_module_task(
        MODULE_ID,
        "read_material",
        {"uid": uid, "preparationId": prep_id, "materialId": material_id},
        name_parts=(uid, prep_id, material_id),
    )
    return _material_view(material_id, doc)


@router.post("/{prep_id}/materials", status_code=status.HTTP_201_CREATED)
async def upload_material(
    prep_id: str, user: current_user, file: Annotated[UploadFile, File()], id: str = ""
) -> dict[str, Any]:
    await _preparation_ref(user.uid, prep_id)
    material_id = client_uuid(id) if id else new_id()
    data = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise PayloadTooLarge()
    try:
        kind = detect_kind(file.filename or "", data)
    except UnsupportedMaterial as exc:
        raise UnsupportedMedia(str(exc), extra={"accepts": sorted(EXTENSIONS)}) from None

    path = StoragePaths(user.uid).admission_material(prep_id, material_id)
    await user_content().write(path, data, CONTENT_TYPES.get(kind, "application/octet-stream"))
    return await _add_material(
        user.uid,
        prep_id,
        material_id,
        {
            "title": clean_phrase(file.filename or "Document", 160),
            "source": "upload",
            "storagePath": path,
            "fileKind": str(kind),
            "status": "pending",
            "type": "",
            "createdAt": datetime.now(UTC),
        },
    )


@router.post("/{prep_id}/materials/link", status_code=status.HTTP_201_CREATED)
async def add_link(prep_id: str, body: LinkMaterial, user: current_user) -> dict[str, Any]:
    await _preparation_ref(user.uid, prep_id)
    return await _add_material(
        user.uid,
        prep_id,
        client_uuid(body.id),
        {
            "title": clean_phrase(body.title, 160) or str(body.url),
            "source": "link",
            "url": str(body.url),
            "status": "pending",
            "type": "",
            "createdAt": datetime.now(UTC),
        },
    )


@router.post("/{prep_id}/materials/text", status_code=status.HTTP_201_CREATED)
async def add_text(prep_id: str, body: TextMaterial, user: current_user) -> dict[str, Any]:
    await _preparation_ref(user.uid, prep_id)
    material_id = client_uuid(body.id)
    text = clean_text(body.text, MAX_PASTED_CHARS)
    path = StoragePaths(user.uid).admission_material_text(prep_id, material_id)
    await user_content().write(path, text.encode(), "text/plain; charset=utf-8")
    return await _add_material(
        user.uid,
        prep_id,
        material_id,
        {
            "title": clean_phrase(body.title, 160) or "Pasted text",
            "source": "text",
            "textPath": path,
            "status": "pending",
            "type": "",
            "createdAt": datetime.now(UTC),
        },
    )


@router.delete("/{prep_id}/materials/{material_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_material(prep_id: str, material_id: str, user: current_user) -> Response:
    db, paths = clients.firestore(), UserPaths(user.uid)
    ref = db.document(paths.admission_material(prep_id, require_id(material_id)))
    snap = await ref.get()
    if not snap.exists:
        raise NotFound()
    data = snap.to_dict() or {}
    for key in ("storagePath", "textPath"):
        if path := data.get(key):
            await user_content().delete(str(path))
    await ref.delete()
    count = len([s async for s in db.collection(paths.admission_materials(prep_id)).limit(MAX_MATERIALS + 1).stream()])
    await db.document(paths.admission_preparation(prep_id)).update(
        {"materialCount": count, "updatedAt": datetime.now(UTC)}
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)

