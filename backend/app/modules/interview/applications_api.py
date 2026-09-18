"""Job applications and their interview blueprints (`/api/v1/interview/applications`)."""

from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Header, Response, status
from google.api_core.exceptions import AlreadyExists
from google.cloud.firestore_v1.base_query import FieldFilter
from pydantic import BaseModel, ConfigDict, Field

from app.core.errors import Conflict, NotFound, PreconditionFailed, QuotaExceeded, ServiceUnavailable
from app.modules.interview import MODULE_ID
from app.modules.interview.api import EmailNotVerified
from app.modules.interview.blueprint import (
    BlueprintDraft,
    BlueprintRejected,
    QuestionFamilyDraft,
    ReportedQuestionDraft,
    RoundDraft,
    RubricItemDraft,
    SourceDraft,
    validate_blueprint,
)
from app.modules.interview.prep import write_guide
from app.modules.interview.retry import competency_name
from app.modules.interview.sanitize import clean_phrase
from app.platform.ai.gateway import StructuredOutputError
from app.platform.auth.dependencies import AuthUser, current_user
from app.platform.clients import clients
from app.platform.firestore.paths import UserPaths, client_uuid, new_id, require_id
from app.platform.jobs.module_tasks import enqueue_module_task
from app.platform.ratelimit import rate_limit
from app.platform.runtime_config import ai_enabled
from app.platform.usage import Metric, Period, UsageService
from app.platform.users import ConsentKind, plan_limits, require_consents

log = logging.getLogger(__name__)

router = APIRouter(prefix="/interview/applications", tags=["interview"])

#: A generation normally finishes within a few minutes; one older than this is treated as lost.
STALE_GENERATION = timedelta(minutes=15)


class ApplicationCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    company: Annotated[str, Field(min_length=1, max_length=120)]
    roleTitle: Annotated[str, Field(min_length=1, max_length=160)]
    location: Annotated[str, Field(max_length=120)] = ""
    jobDescription: Annotated[str, Field(max_length=50_000)] = ""
    resumeId: str | None = None


def _application_view(app_id: str, data: dict[str, Any], *, full: bool = False) -> dict[str, Any]:
    view = {
        "id": app_id,
        **{k: data.get(k) for k in ("company", "roleTitle", "location", "resumeId", "activeBlueprintId", "status")},
        "createdAt": data.get("createdAt"),
    }
    if full:
        view["jobDescription"] = data.get("jobDescription", "")
    return view


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_application(body: ApplicationCreate, user: current_user) -> dict[str, Any]:
    app_id = client_uuid(body.id)
    db, paths = clients.firestore(), UserPaths(user.uid)
    ref = db.document(paths.application(app_id))
    existing = await ref.get()
    if existing.exists:
        return _application_view(app_id, existing.to_dict() or {})
    if body.resumeId is not None and not (await db.document(paths.resume(require_id(body.resumeId))).get()).exists:
        raise NotFound("resume not found")
    _, limits = await plan_limits(user)
    count = len([s async for s in db.collection(paths.applications()).limit(limits.applications_max + 1).stream()])
    if count >= limits.applications_max:
        raise QuotaExceeded(extra={"metric": "applications", "limit": limits.applications_max})
    doc = {
        "company": clean_phrase(body.company, 120),
        "roleTitle": clean_phrase(body.roleTitle, 160),
        "location": clean_phrase(body.location, 120),
        "jobDescription": body.jobDescription.strip(),
        "resumeId": body.resumeId,
        "activeBlueprintId": None,
        "status": "draft",
        "createdAt": datetime.now(UTC),
    }
    try:
        await ref.create(doc)
    except AlreadyExists:
        doc = (await ref.get()).to_dict() or doc
    return _application_view(app_id, doc)


@router.get("")
async def list_applications(user: current_user) -> list[dict[str, Any]]:
    query = clients.firestore().collection(UserPaths(user.uid).applications()).order_by(
        "createdAt", direction="DESCENDING"
    )
    return [_application_view(s.id, s.to_dict() or {}) async for s in query.limit(50).stream()]


@router.get("/{application_id}")
async def get_application(application_id: str, user: current_user) -> dict[str, Any]:
    snap = await clients.firestore().document(UserPaths(user.uid).application(application_id)).get()
    if not snap.exists:
        raise NotFound()
    return _application_view(application_id, snap.to_dict() or {}, full=True)


@router.delete("/{application_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_application(application_id: str, user: current_user) -> Response:
    db = clients.firestore()
    ref = db.document(UserPaths(user.uid).application(application_id))
    if not (await ref.get()).exists:
        raise NotFound()
    await db.recursive_delete(ref)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{application_id}/blueprints:generate", status_code=status.HTTP_202_ACCEPTED)
async def generate_blueprint(
    application_id: str,
    user: Annotated[AuthUser, Depends(rate_limit("blueprint_generate", limit=10, window_seconds=3600))],
) -> dict[str, Any]:
    db, paths = clients.firestore(), UserPaths(user.uid)
    app_ref = db.document(paths.application(application_id))
    if not (await app_ref.get()).exists:
        raise NotFound()
    if not user.verified_for_ai:
        raise EmailNotVerified()
    await require_consents(user, ConsentKind.AI_PROCESSING)
    if not await ai_enabled():
        raise ServiceUnavailable()
    running = db.collection(paths.blueprints(application_id)).where(
        filter=FieldFilter("status", "in", ["queued", "researching"])
    )
    now = datetime.now(UTC)
    async for snap in running.limit(5).stream():
        current = snap.to_dict() or {}
        started = current.get("startedAt") or current.get("createdAt")
        if started is not None and now - started < STALE_GENERATION:
            raise Conflict("an interview journey is already being prepared")
        # It never finished (for example its task was lost): retire it so a new one can start.
        await snap.reference.update({"status": "failed", "failureReason": "stalled"})

    _, limits = await plan_limits(user)
    await UsageService(db).reserve(user.uid, Metric.BLUEPRINTS, 1, limit=limits.blueprint_generations_day,
                                   period=Period.DAY)
    versions = [s async for s in db.collection(paths.blueprints(application_id)).stream()]
    blueprint_id = new_id()
    await db.document(paths.blueprint(application_id, blueprint_id)).set(
        {"status": "queued", "source": "agent", "version": len(versions) + 1, "attempts": 0,
         "createdAt": datetime.now(UTC)}
    )
    await app_ref.update({"status": "researching"})
    await enqueue_module_task(
        MODULE_ID, "generate_blueprint",
        {"uid": user.uid, "applicationId": application_id, "blueprintId": blueprint_id},
        name_parts=(application_id, blueprint_id),
    )
    return {"blueprintId": blueprint_id, "status": "queued"}


@router.get("/{application_id}/blueprints/{blueprint_id}")
async def get_blueprint(application_id: str, blueprint_id: str, user: current_user) -> dict[str, Any]:
    snap = await clients.firestore().document(UserPaths(user.uid).blueprint(application_id, blueprint_id)).get()
    if not snap.exists:
        raise NotFound()
    data = snap.to_dict() or {}
    data.pop("research", None)  # full research notes are kept only to resume a failed generation
    ids = {cid for r in data.get("rounds", []) for cid in r.get("competencyIds", [])}
    return {"id": blueprint_id, **data, "competencyNames": {cid: competency_name(cid) for cid in ids}}


class RoundEdit(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str | None = None
    type: Annotated[str, Field(max_length=40)]
    customLabel: Annotated[str, Field(max_length=60)] = ""
    title: Annotated[str, Field(min_length=1, max_length=100)]
    format: Annotated[str, Field(max_length=120)] = ""
    durationMinutes: Annotated[int, Field(ge=0, le=240)] = 0
    competencyIds: list[str] | None = None
    questionFamilies: list[Annotated[str, Field(max_length=80)]] | None = None


class BlueprintEdit(BaseModel):
    model_config = ConfigDict(extra="forbid")
    rounds: Annotated[list[RoundEdit], Field(min_length=1, max_length=12)]


def _draft_from_stored(rounds: list[RoundEdit], current: dict[str, Any]) -> tuple[BlueprintDraft, dict[int, str]]:
    originals = {r.get("id"): r for r in current.get("rounds", [])}
    drafts: list[RoundDraft] = []
    ids: dict[int, str] = {}
    for order, edit in enumerate(rounds, start=1):
        original = originals.get(edit.id) if edit.id else None
        base = original or {}
        if original is not None and edit.id:
            ids[order] = edit.id
        families = base.get("questionFamilies", [])
        if edit.questionFamilies is not None:
            by_name = {f.get("name"): f for f in families}
            families = [
                by_name.get(name, {"name": name, "description": "", "exampleQuestions": []})
                for name in edit.questionFamilies
            ]
        drafts.append(
            RoundDraft(
                order=order,
                type=edit.type,
                customLabel=edit.customLabel,
                title=edit.title,
                format=edit.format,
                durationMinutes=edit.durationMinutes,
                competencyIds=edit.competencyIds if edit.competencyIds is not None else base.get("competencyIds", []),
                questionFamilies=[QuestionFamilyDraft(**f) for f in families],
                reportedQuestions=[ReportedQuestionDraft(**q) for q in base.get("reportedQuestions", [])],
                resumeFocus=base.get("resumeFocus", []),
                roleFocus=base.get("roleFocus", []),
                companyFocus=base.get("companyFocus", []),
                rubric=[RubricItemDraft(**r) for r in base.get("rubric", [])],
                confidence=base.get("confidence", "medium"),
                rationale=base.get("rationale") or "Added by you.",
                evidenceSourceIds=base.get("evidenceSourceIds", []),
            )
        )
    draft = BlueprintDraft(
        processSummary=current.get("processSummary", ""),
        companySummary=current.get("companySummary", ""),
        roleSummary=current.get("roleSummary", ""),
        rounds=drafts,
        sources=[SourceDraft(**s) for s in current.get("sources", [])],
        caveats=current.get("caveats", []),
    )
    return draft, ids


@router.put("/{application_id}/blueprints/{blueprint_id}")
async def edit_blueprint(
    application_id: str,
    blueprint_id: str,
    body: BlueprintEdit,
    user: current_user,
    if_match: Annotated[str | None, Header(alias="If-Match")] = None,
) -> dict[str, Any]:
    """Saves the user's corrections as a new version; the edited version must be the one they loaded."""
    db, paths = clients.firestore(), UserPaths(user.uid)
    snap = await db.document(paths.blueprint(application_id, blueprint_id)).get()
    if not snap.exists:
        raise NotFound()
    current = snap.to_dict() or {}
    if current.get("status") != "ready":
        raise Conflict("this interview journey can't be edited yet")
    if if_match is None or if_match.strip('"') != str(current.get("version")):
        raise PreconditionFailed()

    draft, ids = _draft_from_stored(body.rounds, current)
    try:
        fields, _ = validate_blueprint(draft, existing_ids=ids)
    except BlueprintRejected as exc:
        raise Conflict("; ".join(exc.problems[:3])) from exc

    versions = [s async for s in db.collection(paths.blueprints(application_id)).stream()]
    new_blueprint_id = new_id()
    doc = {
        **fields,
        "searchSuggestionsHtml": current.get("searchSuggestionsHtml", ""),
        "status": "ready",
        "source": "user_edit",
        "basedOn": blueprint_id,
        "version": len(versions) + 1,
        "createdAt": datetime.now(UTC),
    }
    await db.document(paths.blueprint(application_id, new_blueprint_id)).set(doc)
    await db.document(paths.application(application_id)).update({"activeBlueprintId": new_blueprint_id})
    return {"id": new_blueprint_id, **doc}


# -- round preparation guides ------------------------------------------------


async def _guide_inputs(uid: str, application_id: str, blueprint_id: str, round_id: str) -> tuple[
    dict[str, Any], dict[str, Any], dict[str, Any]
]:
    db, paths = clients.firestore(), UserPaths(uid)
    app_snap = await db.document(paths.application(application_id)).get()
    bp_snap = await db.document(paths.blueprint(application_id, blueprint_id)).get()
    if not app_snap.exists or not bp_snap.exists:
        raise NotFound()
    blueprint = bp_snap.to_dict() or {}
    round_id = require_id(round_id)
    round_doc = next((r for r in blueprint.get("rounds", []) if r.get("id") == round_id), None)
    if blueprint.get("status") != "ready" or round_doc is None:
        raise NotFound()
    return app_snap.to_dict() or {}, blueprint, round_doc


@router.get("/{application_id}/blueprints/{blueprint_id}/rounds/{round_id}/guide")
async def get_round_guide(application_id: str, blueprint_id: str, round_id: str, user: current_user) -> dict[str, Any]:
    snap = await clients.firestore().document(
        UserPaths(user.uid).round_guide(application_id, blueprint_id, round_id)
    ).get()
    if not snap.exists:
        raise NotFound()
    return {"roundId": round_id, **(snap.to_dict() or {})}


@router.post("/{application_id}/blueprints/{blueprint_id}/rounds/{round_id}/guide")
async def write_round_guide(
    application_id: str,
    blueprint_id: str,
    round_id: str,
    user: Annotated[AuthUser, Depends(rate_limit("round_guide", limit=30, window_seconds=3600))],
) -> dict[str, Any]:
    """Writes (or rewrites) the preparation guide for one round; the candidate waits for it."""
    if not user.verified_for_ai:
        raise EmailNotVerified()
    await require_consents(user, ConsentKind.AI_PROCESSING)
    if not await ai_enabled():
        raise ServiceUnavailable()
    application, blueprint, round_doc = await _guide_inputs(user.uid, application_id, blueprint_id, round_id)
    db, paths = clients.firestore(), UserPaths(user.uid)
    _, limits = await plan_limits(user)
    await UsageService(db).reserve(user.uid, Metric.ROUND_GUIDES, 1, limit=limits.round_guides_day, period=Period.DAY)

    resume_profile = None
    if resume_id := application.get("resumeId"):
        resume = (await db.document(paths.resume(str(resume_id))).get()).to_dict() or {}
        if isinstance(resume.get("profile"), dict):
            resume_profile = resume["profile"]
    try:
        guide = await write_guide(user.uid, application, blueprint, round_doc, resume_profile)
    except (StructuredOutputError, ValueError) as exc:
        log.warning("round guide rejected", extra={"error": type(exc).__name__})
        raise ServiceUnavailable() from exc
    stored = {**guide, "createdAt": datetime.now(UTC), "hasResume": resume_profile is not None}
    await db.document(paths.round_guide(application_id, blueprint_id, round_id)).set(stored)
    return {"roundId": round_id, **stored}
