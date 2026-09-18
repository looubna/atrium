"""Exam module background tasks, run on the worker through the platform's module task route.

Two jobs: read one uploaded material into text, and analyse a whole course's
material into the knowledge map an exam is built from.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import time
from datetime import UTC, datetime, timedelta
from typing import Any

from google.api_core.exceptions import GoogleAPICallError
from google.cloud import firestore

from app.core.settings import AiProvider, Env, get_settings
from app.modules.exam.agents.analyst import ExamAnalyst, MaterialInput
from app.modules.exam.knowledge import KnowledgeMapRejected
from app.modules.exam.materials import IMAGE_KINDS, UnsupportedMaterial, extract_text, guess_type
from app.platform.ai.gateway import AiUnavailable, MediaRef, ResearchResult
from app.platform.clients import clients
from app.platform.firestore.paths import UserPaths, require_id
from app.platform.jobs.module_tasks import RetryableTaskError
from app.platform.storage.objects import user_content
from app.platform.storage.paths import StoragePaths

log = logging.getLogger(__name__)

MAX_ATTEMPTS = 3
#: How long an analysis waits for files that are still being read before going ahead without them.
MATERIAL_WAIT_S = 120.0
MATERIAL_POLL_S = 2.0
#: An analysis still "analyzing" after this lost its worker.
CLAIM_STALE = timedelta(minutes=15)


async def extract_material(payload: dict[str, Any]) -> None:
    """Reads one uploaded file into plain text, with a first guess at what it is."""
    uid = str(payload["uid"])
    course_id, material_id = require_id(str(payload["courseId"])), require_id(str(payload["materialId"]))
    ref = clients.firestore().document(UserPaths(uid).material(course_id, material_id))
    snap = await ref.get()
    data = snap.to_dict() or {}
    if not snap.exists or data.get("status") != "processing":
        return
    kind = str(data.get("kind", ""))
    if kind in IMAGE_KINDS:
        # Nothing to extract: the analyst looks at the picture itself.
        await ref.update({"status": "ready", "detectedType": "other"})
        return

    store = user_content()
    try:
        text = extract_text(kind, await store.read(str(data["storagePath"])))  # type: ignore[arg-type]
    except UnsupportedMaterial as exc:
        await ref.update({"status": "failed", "failureReason": str(exc)})
        return
    except FileNotFoundError:
        await ref.update({"status": "failed", "failureReason": "the file could not be read"})
        return
    text_path = StoragePaths(uid).material_text(course_id, material_id)
    await store.write(text_path, text.encode(), "text/plain; charset=utf-8")
    await ref.update(
        {
            "status": "ready",
            "textPath": text_path,
            "textChars": len(text),
            "detectedType": guess_type(str(data.get("name", "")), text),
            "readyAt": datetime.now(UTC),
        }
    )


class AnalysisProgress:
    """Streams progress into `analysis.progress`; the app listens to the document live.

    Best-effort and throttled (Firestore sustains about one write per second per document): a
    failed progress write never fails the analysis, and the final result always replaces it.
    """

    MIN_INTERVAL_S = 1.0

    def __init__(self, ref: firestore.AsyncDocumentReference) -> None:
        self.ref = ref
        self.state: dict[str, Any] = {
            "stage": "starting", "summary": "", "topics": [], "materials": [], "notes": "", "sources": [],
            "busy": False,
        }
        self._last_write = 0.0
        self._flush: asyncio.Task[None] | None = None
        self._closed = False

    def snapshot(self, stage: str | None = None) -> dict[str, Any]:
        return {**self.state, **({"stage": stage} if stage else {}), "updatedAt": datetime.now(UTC)}

    async def stage(self, stage: str) -> None:
        self.state["stage"] = stage
        self.state["busy"] = False
        await self._write_now()

    async def waiting(self, seconds: float) -> None:
        self.state["busy"] = True
        await self._write_now()

    async def draft(self, *, summary: str, topics: list[dict[str, Any]], materials: list[dict[str, Any]]) -> None:
        self.state["busy"] = False
        self.state["summary"] = summary
        self.state["topics"] = topics
        self.state["materials"] = materials
        await self._write_soon()

    async def research(
        self, *, notes: str | None = None, sources: list[dict[str, str]] | None = None
    ) -> None:
        self.state["busy"] = False
        if notes is not None:
            self.state["notes"] = notes
        if sources is not None:
            self.state["sources"] = sources[:10]
        await self._write_soon()

    async def _write_soon(self) -> None:
        if self._closed:
            return
        wait = self.MIN_INTERVAL_S - (time.monotonic() - self._last_write)
        if wait <= 0:
            await self._write_now()
        elif self._flush is None or self._flush.done():
            self._flush = asyncio.create_task(self._write_after(wait))

    async def _write_after(self, delay: float) -> None:
        await asyncio.sleep(delay)
        await self._write_now()

    async def _write_now(self) -> None:
        if self._closed:
            return
        self._last_write = time.monotonic()
        try:
            await self.ref.update({"progress": self.snapshot()})
        except GoogleAPICallError as exc:
            log.warning("analysis progress not saved", extra={"error": type(exc).__name__})

    async def close(self) -> None:
        """Stop writing; call before storing the result so a late update can't overwrite it."""
        self._closed = True
        if self._flush is not None and not self._flush.done():
            self._flush.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._flush


async def _claim_analysis(ref: firestore.AsyncDocumentReference) -> dict[str, Any] | None:
    """Start an analysis: a queued one, or one whose worker died mid-way."""
    now = datetime.now(UTC)

    @firestore.async_transactional
    async def txn(transaction: firestore.AsyncTransaction) -> dict[str, Any] | None:
        snap = await ref.get(transaction=transaction)
        data = snap.to_dict() or {}
        started = data.get("startedAt")
        abandoned = data.get("status") == "analyzing" and started is not None and now - started > CLAIM_STALE
        if not snap.exists or not (data.get("status") == "queued" or abandoned):
            return None
        transaction.update(ref, {"status": "analyzing", "startedAt": now, "progress": None})
        return data

    return await txn(clients.firestore().transaction())


async def _wait_for_materials(uid: str, course_id: str) -> list[tuple[str, dict[str, Any]]]:
    """Every material, once the files still being read have finished (or the wait runs out)."""
    db = clients.firestore()
    deadline = time.monotonic() + MATERIAL_WAIT_S
    query = db.collection(UserPaths(uid).materials(course_id)).order_by("createdAt").limit(200)
    while True:
        materials = [(snap.id, snap.to_dict() or {}) async for snap in query.stream()]
        pending = [m for _, m in materials if m.get("status") == "processing"]
        if not pending or time.monotonic() >= deadline:
            return materials
        await asyncio.sleep(MATERIAL_POLL_S)


async def _material_inputs(uid: str, course_id: str, materials: list[tuple[str, dict[str, Any]]]) -> tuple[
    list[MaterialInput], list[str]
]:
    """What the analyst reads, plus the links it should research."""
    settings = get_settings()
    # A model can only read an image straight from the bucket; locally there is no bucket to read.
    images_readable = settings.ai_provider is AiProvider.VERTEX and settings.app_env not in (Env.LOCAL, Env.TEST)
    store = user_content()
    inputs: list[MaterialInput] = []
    links: list[str] = []
    for material_id, data in materials:
        if data.get("status") == "failed":
            continue
        source = str(data.get("source", "file"))
        name = str(data.get("name", ""))
        if source == "link":
            url = str(data.get("url", ""))
            links.append(url)
            inputs.append(MaterialInput(id=material_id, source="link", name=name, text=f"A link: {url}"))
            continue
        kind = str(data.get("kind", ""))
        if kind in IMAGE_KINDS:
            image = (
                MediaRef(f"gs://{settings.user_content_bucket}/{data['storagePath']}", str(data.get("contentType")))
                if images_readable and data.get("storagePath")
                else None
            )
            inputs.append(MaterialInput(id=material_id, source="file", name=name, image=image))
            continue
        text_path = data.get("textPath")
        if not text_path:
            continue
        try:
            text = (await store.read(str(text_path))).decode("utf-8", "replace")
        except FileNotFoundError:
            log.warning("material text is missing", extra={"material": material_id})
            continue
        inputs.append(MaterialInput(id=material_id, source=source, name=name, text=text))
    return inputs, links


async def analyze_course(payload: dict[str, Any]) -> None:
    uid = str(payload["uid"])
    course_id = require_id(str(payload["courseId"]))
    analysis_id = require_id(str(payload["analysisId"]))
    db, paths = clients.firestore(), UserPaths(uid)
    ref = db.document(paths.exam_analysis(course_id, analysis_id))
    course_ref = db.document(paths.course(course_id))

    analysis = await _claim_analysis(ref)
    if analysis is None:
        return
    course = (await course_ref.get()).to_dict()
    if course is None:
        await ref.update({"status": "failed", "failureReason": "course_deleted"})
        return

    materials = await _wait_for_materials(uid, course_id)
    inputs, links = await _material_inputs(uid, course_id, materials)
    if not inputs:
        await ref.update({"status": "failed", "failureReason": "no_readable_material"})
        await course_ref.update({"status": "failed"})
        return

    async def keep_research(result: ResearchResult) -> None:
        # A retry of this analysis reuses the research instead of searching (and paying) again.
        await ref.update({"research": {
            "text": result.text[:12_000], "sources": result.sources, "queries": result.queries,
            "searchSuggestionsHtml": result.search_suggestions_html,
        }})

    progress = AnalysisProgress(ref)
    try:
        try:
            fields = await ExamAnalyst().analyze(
                uid=uid, subject=str(course.get("subject", "")), materials=inputs, links=links,
                progress=progress, on_research=keep_research, cached_research=analysis.get("research"),
                # The student who already told us how their exam runs needs no web research.
                search_enabled=not course.get("chosenStyle"),
            )
        finally:
            await progress.close()
    except Exception as exc:
        attempts = int(analysis.get("attempts", 0)) + 1
        permanent = isinstance(exc, AiUnavailable | KnowledgeMapRejected) or attempts >= MAX_ATTEMPTS
        log.warning("course analysis failed", extra={"attempts": attempts, "error": type(exc).__name__})
        if permanent:
            await ref.update({"status": "failed", "failureReason": type(exc).__name__, "attempts": attempts})
            await course_ref.update({"status": "failed"})
            return
        await ref.update({"status": "queued", "attempts": attempts})
        raise RetryableTaskError("course analysis") from exc

    # What the analyst made of each file replaces the guess made when it was read.
    batch = db.batch()
    for read in fields.get("materials", []):
        material_id = str(read.get("materialId", ""))
        if not material_id:
            continue
        batch.update(
            db.document(paths.material(course_id, material_id)),
            {"detectedType": read.get("type"), "detectedTitle": read.get("title")},
        )
    with contextlib.suppress(GoogleAPICallError):
        await batch.commit()

    await ref.update(
        {**fields, "status": "ready", "completedAt": datetime.now(UTC), "progress": progress.snapshot("done")}
    )
    await course_ref.update({"activeAnalysisId": analysis_id, "status": "ready"})


TASKS = {"extract_material": extract_material, "analyze_course": analyze_course}
