"""The work behind the checklist: research one opportunity, read one material.

Both jobs update the preparation as they go, because the screen is drawn from it (§10). They
are separate tasks rather than one pipeline for a plain reason: research is about the
scholarship and is shared between candidates, while reading a file is about one person and
happens whenever they add one — often while research is still running.

Neither job is allowed to leave a stage `running`. A worker that dies mid-task is invisible
to the candidate, who would watch a line that never moves; so every exit path writes a state,
and failure is a state like any other.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any

from app.modules.admission.agents.analyzer import ApplicationAnalyzer
from app.modules.admission.agents.researcher import OpportunityResearcher
from app.modules.admission.agents.strategist import PreparationEngine
from app.modules.admission.cache import COLLECTION, cache_key, from_document, is_fresh, to_document
from app.modules.admission.candidate import CandidateProfile
from app.modules.admission.catalogs import parse_kind
from app.modules.admission.preparations import Stage, StageState, mark_stage, status_for
from app.modules.exam.materials import IMAGE_KINDS, UnsupportedMaterial, extract_text
from app.platform.clients import clients
from app.platform.firestore.paths import UserPaths
from app.platform.storage.objects import user_content
from app.platform.storage.paths import StoragePaths

log = logging.getLogger(__name__)

#: How many sources have to turn up before research counts as having found the opportunity
#: rather than a page that mentions it.
ENOUGH_SOURCES = 2


async def _update(uid: str, prep_id: str, stage: Stage, state: StageState, *, note: str = "", **fields: Any) -> None:
    """Move one line of the checklist, and recompute where the preparation stands.

    Read-modify-write rather than a field update: `stages` is a list, and two jobs finishing
    at once would otherwise overwrite each other's line.
    """
    ref = clients.firestore().document(UserPaths(uid).admission_preparation(prep_id))
    snap = await ref.get()
    if not snap.exists:
        return
    data = snap.to_dict() or {}
    stages = mark_stage(list(data.get("stages", [])), stage, state, note=note)
    await ref.update({"stages": stages, "status": str(status_for(stages)), "updatedAt": datetime.now(UTC), **fields})


async def research_opportunity(payload: dict[str, Any]) -> None:
    """Find out what this scholarship or programme is, and what its interview is like.

    The cache is checked first: a second candidate applying to the same cycle should not pay
    for the same searches, and more importantly should not get a *different* account of the
    same scholarship because the model saw different pages that day.
    """
    uid, prep_id = str(payload["uid"]), str(payload["preparationId"])
    db = clients.firestore()
    snap = await db.document(UserPaths(uid).admission_preparation(prep_id)).get()
    if not snap.exists:
        return
    prep = snap.to_dict() or {}
    name, cycle = str(prep.get("name", "")), str(prep.get("cycle", ""))
    kind = parse_kind(prep.get("kind"))
    key = cache_key(name, kind, cycle)

    cached = await db.document(f"{COLLECTION}/{key}").get()
    if cached.exists and is_fresh(cached.to_dict() or {}):
        profile = from_document(cached.to_dict() or {})
        if profile is not None:
            await _update(
                uid,
                prep_id,
                Stage.RESEARCH,
                StageState.SKIPPED,
                note="Already researched for this cycle",
                opportunityKey=key,
            )
            return

    await _update(uid, prep_id, Stage.RESEARCH, StageState.RUNNING)
    try:
        profile, problems, _ = await OpportunityResearcher().run(
            uid=uid, name=name, kind=kind, cycle=cycle, program=str(prep.get("program", ""))
        )
    except Exception:
        # The candidate still has an interview to practise; they simply get it without a
        # briefing. Logged with the preparation so a thin result can be traced to its run.
        log.exception("admission research failed", extra={"preparationId": prep_id})
        await _update(uid, prep_id, Stage.RESEARCH, StageState.FAILED, note="The research could not be completed")
        return

    if problems:
        log.info("admission research corrected %d claims", len(problems), extra={"preparationId": prep_id})

    await db.document(f"{COLLECTION}/{key}").set(to_document(profile, queries=[]))

    # Nobody has to upload anything (§4 asks only for the name), so a preparation with no
    # materials is finished rather than waiting on a document that is not coming.
    materials = db.collection(UserPaths(uid).admission_materials(prep_id))
    if not [s async for s in materials.limit(1).stream()]:
        await _update(uid, prep_id, Stage.MATERIALS, StageState.SKIPPED, note="No application materials added")

    thin = profile.is_thin() or len(profile.sources) < ENOUGH_SOURCES
    await _update(
        uid,
        prep_id,
        Stage.RESEARCH,
        StageState.DONE,
        # Said plainly rather than hidden: a scholarship nobody has written about is a real
        # finding, and a candidate told that will not expect a briefing that cannot exist.
        note=(
            "Little is published about this one, so the preparation is thinner than usual"
            if thin
            else f"Read {len(profile.sources)} sources"
        ),
        opportunityKey=key,
    )
    await _prepare(uid, prep_id)


async def read_material(payload: dict[str, Any]) -> None:
    """Turn one uploaded file, link or pasted text into plain text for the analyzer.

    Extraction itself belongs to the exam module, which already handles PDF, DOCX and images
    and the ways each of them fails; this job only puts the result where the analyzer will
    look for it and keeps the checklist honest about how it went.

    Pasted text needs no extraction, and an image is left to be looked at rather than read:
    a photographed transcript is evidence, and OCR of it would be a worse copy of what the
    model can already see.
    """
    uid, prep_id = str(payload["uid"]), str(payload["preparationId"])
    material_id = str(payload["materialId"])
    ref = clients.firestore().document(UserPaths(uid).admission_material(prep_id, material_id))
    snap = await ref.get()
    if not snap.exists:
        return
    data = snap.to_dict() or {}

    await _update(uid, prep_id, Stage.MATERIALS, StageState.RUNNING)
    store = user_content()
    kind = str(data.get("fileKind", ""))

    if data.get("source") == "text" or data.get("textPath"):
        await ref.update({"status": "ready"})
        await _analyze(uid, prep_id)
        return
    if data.get("source") == "link":
        # Fetching the page belongs with the researcher, which already reads the web under
        # the rules this module cares about. Left pending for it rather than half-read here.
        await ref.update({"status": "ready"})
        await _analyze(uid, prep_id)
        return
    if kind in IMAGE_KINDS:
        await ref.update({"status": "ready"})
        await _analyze(uid, prep_id)
        return

    try:
        text = extract_text(kind, await store.read(str(data["storagePath"])))  # type: ignore[arg-type]
    except (UnsupportedMaterial, FileNotFoundError, KeyError) as exc:
        log.info("admission material could not be read: %s", exc, extra={"materialId": material_id})
        await ref.update({"status": "failed", "failureReason": "the file could not be read"})
        # The others are still readable. One unreadable scan must not cost the candidate the
        # profile their CV and study plan would have built.
        await _analyze(uid, prep_id)
        return

    text_path = StoragePaths(uid).admission_material_text(prep_id, material_id)
    await store.write(text_path, text.encode(), "text/plain; charset=utf-8")
    await ref.update({"status": "ready", "textPath": text_path, "textChars": len(text)})
    await _analyze(uid, prep_id)



async def _analyze(uid: str, prep_id: str) -> None:
    """Read the application as a whole, once every document that can be read has been.

    Re-run rather than incremental: a candidate's story is read across their documents, and a
    study plan means something different once the CV beside it is known. Cheap enough to
    repeat — one call over text that is already extracted — and the alternative is a profile
    that depends on the order files were dropped in.

    Waits for the stragglers instead of analysing half a folder, because a claim missing its
    evidence is dropped, and dropping it for a file that arrives two seconds later would make
    the profile quietly wrong.
    """
    db = clients.firestore()
    materials = [s async for s in db.collection(UserPaths(uid).admission_materials(prep_id)).stream()]
    if any((s.to_dict() or {}).get("status") == "pending" for s in materials):
        return

    prep_ref = db.document(UserPaths(uid).admission_preparation(prep_id))
    prep = (await prep_ref.get()).to_dict() or {}
    store = user_content()

    documents: list[tuple[str, str, str]] = []
    for snap in materials:
        data = snap.to_dict() or {}
        if data.get("status") != "ready":
            continue
        text = ""
        if path := data.get("textPath"):
            try:
                text = (await store.read(str(path))).decode("utf-8", "replace")
            except FileNotFoundError:
                continue
        documents.append((snap.id, str(data.get("title", "")), text))

    try:
        profile, types, problems = await ApplicationAnalyzer().run(
            uid=uid, opportunity=str(prep.get("name", "")), materials=documents
        )
    except Exception:
        log.exception("admission analysis failed", extra={"preparationId": prep_id})
        await _update(uid, prep_id, Stage.MATERIALS, StageState.FAILED, note="Your application could not be read")
        return

    if problems:
        log.info("admission analysis corrected %d claims", len(problems), extra={"preparationId": prep_id})

    # What each document turned out to be, shown beside it in the list (§4).
    for material_id, material_type in types.items():
        await db.document(UserPaths(uid).admission_material(prep_id, material_id)).update({"type": str(material_type)})

    claims = len(profile.claims())
    failed = sum(1 for s in materials if (s.to_dict() or {}).get("status") == "failed")
    if profile.is_thin():
        note = "Your documents did not say much we could quote"
    else:
        note = f"Read {len(documents)} documents, {claims} things to talk about"
    if failed:
        # Named rather than swallowed: the candidate can re-upload the one that failed, and
        # cannot if nobody tells them a file was left out.
        note += f" ({failed} could not be read)"

    await prep_ref.update({"candidateProfile": profile.model_dump(mode="json")})
    await _update(
        uid,
        prep_id,
        Stage.MATERIALS,
        # Nothing readable at all is a failure the candidate should see; otherwise this stage
        # did its job, whatever one file did.
        StageState.FAILED if not documents else StageState.DONE,
        note="None of your documents could be read" if not documents else note,
    )
    await _prepare(uid, prep_id)


async def _prepare(uid: str, prep_id: str) -> None:
    """Join the two halves, once both have had their turn.

    Called by whichever of research and analysis finishes last, rather than queued as a third
    job: the work is one model call over two profiles that are already in hand, and a queued
    task would mean the candidate watching a line that is waiting on a worker rather than on
    anything real.

    Runs with whatever exists. A candidate who uploaded nothing still gets the questions this
    opportunity asks everyone; a scholarship nobody has written about still gets questions
    drawn from the candidate's own file. Refusing to prepare either of them because the other
    half is missing would be refusing the only thing we could still do for them.
    """
    db = clients.firestore()
    ref = db.document(UserPaths(uid).admission_preparation(prep_id))
    snap = await ref.get()
    if not snap.exists:
        return
    data = snap.to_dict() or {}

    stages = list(data.get("stages", []))
    outstanding = {
        str(entry.get("stage"))
        for entry in stages
        if str(entry.get("state")) in {str(StageState.PENDING), str(StageState.RUNNING)}
        and str(entry.get("stage")) != str(Stage.PREPARATION)
    }
    if outstanding:
        return

    key = str(data.get("opportunityKey") or "")
    opportunity = None
    if key:
        entry = await db.document(f"{COLLECTION}/{key}").get()
        opportunity = from_document(entry.to_dict() or {}) if entry.exists else None
    if opportunity is None:
        await _update(
            uid, prep_id, Stage.PREPARATION, StageState.SKIPPED, note="Nothing was found about this one to prepare from"
        )
        return

    candidate = CandidateProfile.model_validate(data.get("candidateProfile") or {})

    await _update(uid, prep_id, Stage.PREPARATION, StageState.RUNNING)
    try:
        plan, problems = await PreparationEngine().run(uid=uid, opportunity=opportunity, candidate=candidate)
    except Exception:
        log.exception("admission preparation failed", extra={"preparationId": prep_id})
        await _update(uid, prep_id, Stage.PREPARATION, StageState.FAILED, note="The preparation could not be written")
        return

    if problems:
        log.info("admission preparation corrected %d items", len(problems), extra={"preparationId": prep_id})

    await ref.update({"plan": plan.model_dump(mode="json")})
    await _update(
        uid,
        prep_id,
        Stage.PREPARATION,
        StageState.DONE,
        note=(
            "Too little to prepare from, so this is thin"
            if plan.is_thin()
            else f"{len(plan.questions)} questions to be ready for"
        ),
    )


TASKS = {"research_opportunity": research_opportunity, "read_material": read_material}
