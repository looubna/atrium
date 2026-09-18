"""Debate module background work, run on the worker through the platform's module task route.

Two jobs: read one attached document into text, and prepare a debate — research the motion
where current facts matter, read whatever the user handed over, and write the brief.

Document reading (type detection by content, capped extraction) is shared code that lives
in `app.modules.exam.materials`: it was written for the exam module first and nothing about
it is exam-specific. Cross-module imports are already how this codebase shares that kind of
helper (the exam module takes `sanitize` and `livetalking` from the interview module).
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
from app.modules.debate.agents.preparer import MaterialInput, read_materials, research_topic, write_brief
from app.modules.debate.brief import BriefRejected
from app.modules.debate.catalogs import PositionMode, assign_positions, parse_position, parse_position_mode
from app.modules.debate.topics import needs_research
from app.modules.exam.materials import IMAGE_KINDS, UnsupportedMaterial, extract_text
from app.platform.ai.gateway import AiUnavailable, MediaRef, ResearchResult
from app.platform.clients import clients
from app.platform.firestore.paths import UserPaths, require_id
from app.platform.jobs.module_tasks import RetryableTaskError
from app.platform.storage.objects import user_content
from app.platform.storage.paths import StoragePaths

log = logging.getLogger(__name__)

MAX_ATTEMPTS = 3
#: How long preparation waits for files still being read before going ahead without them.
MATERIAL_WAIT_S = 120.0
MATERIAL_POLL_S = 2.0
#: A preparation still "preparing" after this lost its worker.
CLAIM_STALE = timedelta(minutes=15)


async def extract_debate_material(payload: dict[str, Any]) -> None:
    """Reads one attached document into plain text."""
    uid = str(payload["uid"])
    debate_id = require_id(str(payload["debateId"]))
    material_id = require_id(str(payload["materialId"]))
    ref = clients.firestore().document(UserPaths(uid).debate_material(debate_id, material_id))
    snap = await ref.get()
    data = snap.to_dict() or {}
    if not snap.exists or data.get("status") != "processing":
        return
    kind = str(data.get("kind", ""))
    if kind in IMAGE_KINDS:
        # Nothing to extract: the reader looks at the picture itself.
        await ref.update({"status": "ready"})
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
    text_path = StoragePaths(uid).debate_material_text(debate_id, material_id)
    await store.write(text_path, text.encode(), "text/plain; charset=utf-8")
    await ref.update(
        {"status": "ready", "textPath": text_path, "textChars": len(text), "readyAt": datetime.now(UTC)}
    )


class PrepProgress:
    """Streams progress into `preparation.progress`; the app listens to the document live.

    Best-effort and throttled (Firestore sustains about one write per second per document):
    a failed progress write never fails the preparation, and the result always replaces it.
    """

    MIN_INTERVAL_S = 1.0

    def __init__(self, ref: firestore.AsyncDocumentReference) -> None:
        self.ref = ref
        self.state: dict[str, Any] = {
            "stage": "starting", "motion": "", "facts": [], "concepts": [], "notes": "", "sources": [],
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

    async def research(
        self, *, notes: str | None = None, sources: list[dict[str, str]] | None = None
    ) -> None:
        self.state["busy"] = False
        if notes is not None:
            self.state["notes"] = notes
        if sources is not None:
            self.state["sources"] = sources[:10]
        await self._write_soon()

    async def draft(self, *, motion: str, facts: list[str], concepts: list[str]) -> None:
        self.state["busy"] = False
        self.state["motion"] = motion
        self.state["facts"] = facts
        self.state["concepts"] = concepts
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
            log.warning("preparation progress not saved", extra={"error": type(exc).__name__})

    async def close(self) -> None:
        """Stop writing; call before storing the result so a late update cannot overwrite it."""
        self._closed = True
        if self._flush is not None and not self._flush.done():
            self._flush.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._flush


async def _claim_prep(ref: firestore.AsyncDocumentReference) -> dict[str, Any] | None:
    """Start a preparation: a queued one, or one whose worker died mid-way."""
    now = datetime.now(UTC)

    @firestore.async_transactional
    async def txn(transaction: firestore.AsyncTransaction) -> dict[str, Any] | None:
        snap = await ref.get(transaction=transaction)
        data = snap.to_dict() or {}
        started = data.get("startedAt")
        abandoned = data.get("status") == "preparing" and started is not None and now - started > CLAIM_STALE
        if not snap.exists or not (data.get("status") == "queued" or abandoned):
            return None
        transaction.update(ref, {"status": "preparing", "startedAt": now, "progress": None})
        return data

    return await txn(clients.firestore().transaction())


async def _wait_for_materials(uid: str, debate_id: str) -> list[tuple[str, dict[str, Any]]]:
    db = clients.firestore()
    deadline = time.monotonic() + MATERIAL_WAIT_S
    query = db.collection(UserPaths(uid).debate_materials(debate_id)).order_by("createdAt").limit(100)
    while True:
        materials = [(snap.id, snap.to_dict() or {}) async for snap in query.stream()]
        if not [m for _, m in materials if m.get("status") == "processing"] or time.monotonic() >= deadline:
            return materials
        await asyncio.sleep(MATERIAL_POLL_S)


async def _material_inputs(
    uid: str, debate_id: str, materials: list[tuple[str, dict[str, Any]]]
) -> tuple[list[MaterialInput], dict[str, str]]:
    """What the reader reads, and each material's display name for citing it later."""
    settings = get_settings()
    # A model can only read an image straight from the bucket; locally there is no bucket.
    images_readable = settings.ai_provider is AiProvider.VERTEX and settings.app_env not in (Env.LOCAL, Env.TEST)
    store = user_content()
    inputs: list[MaterialInput] = []
    names: dict[str, str] = {}
    for material_id, data in materials:
        if data.get("status") == "failed":
            continue
        name = str(data.get("name", ""))
        names[material_id] = name
        source = str(data.get("source", "file"))
        if source == "link":
            url = str(data.get("url", ""))
            inputs.append(MaterialInput(id=material_id, name=name, source="link", text=f"A link: {url}"))
            continue
        kind = str(data.get("kind", ""))
        if kind in IMAGE_KINDS:
            image = (
                MediaRef(f"gs://{settings.user_content_bucket}/{data['storagePath']}", str(data.get("contentType")))
                if images_readable and data.get("storagePath")
                else None
            )
            inputs.append(MaterialInput(id=material_id, name=name, source="file", image=image))
            continue
        text_path = data.get("textPath")
        if not text_path:
            continue
        try:
            text = (await store.read(str(text_path))).decode("utf-8", "replace")
        except FileNotFoundError:
            log.warning("debate material text is missing", extra={"material": material_id})
            continue
        inputs.append(MaterialInput(id=material_id, name=name, source=source, text=text))
    return inputs, names


async def prepare_debate(payload: dict[str, Any]) -> None:
    """Research, read the material, write the brief, and settle the positions."""
    uid = str(payload["uid"])
    debate_id = require_id(str(payload["debateId"]))
    prep_id = require_id(str(payload["prepId"]))
    db, paths = clients.firestore(), UserPaths(uid)
    ref = db.document(paths.debate_prep(debate_id, prep_id))
    debate_ref = db.document(paths.debate(debate_id))

    prep = await _claim_prep(ref)
    if prep is None:
        return
    debate = (await debate_ref.get()).to_dict()
    if debate is None:
        await ref.update({"status": "failed", "failureReason": "debate_deleted"})
        return

    motion = str(debate.get("topic", ""))
    mode = parse_position_mode(debate.get("positionMode"))
    # Settled here, once, and stored: a user who asked for a random side must not be able to
    # re-roll it by starting preparation again.
    user_position, ai_position = assign_positions(mode, parse_position(debate.get("askedPosition")))
    if debate.get("userPosition") and debate.get("aiPosition"):
        user_position = parse_position(debate.get("userPosition")) or user_position
        ai_position = user_position.opposite

    progress = PrepProgress(ref)
    try:
        try:
            materials = await _wait_for_materials(uid, debate_id)
            inputs, names = await _material_inputs(uid, debate_id, materials)

            material: dict[str, Any] | None = None
            if inputs:
                await progress.stage("reading")
                material, problems = await read_materials(uid, inputs)
                if problems:
                    log.info("debate material problems", extra={"problems": problems[:5]})
                # With no motion of their own, the material supplies one.
                if not motion and material.get("topics"):
                    motion = str(material["topics"][0].get("motion", ""))

            research: ResearchResult | None = None
            wanted = needs_research(motion, asked=debate.get("researchEnabled"))
            if wanted and motion:
                await progress.stage("researching")
                cached = prep.get("research")
                if cached:
                    # A retry of a failed preparation reuses the research instead of paying again.
                    research = ResearchResult(
                        text=str(cached.get("text", "")),
                        sources=[s for s in cached.get("sources", []) if isinstance(s, dict)],
                        queries=[str(q) for q in cached.get("queries", [])],
                        search_suggestions_html=str(cached.get("searchSuggestionsHtml", "")),
                    )
                else:
                    research = await research_topic(uid, motion, progress=progress)
                    await ref.update({"research": {
                        "text": research.text[:12_000], "sources": research.sources,
                        "queries": research.queries, "searchSuggestionsHtml": research.search_suggestions_html,
                    }})

            await progress.stage("briefing")
            fields = await write_brief(
                uid=uid, motion=motion, user_position=user_position,
                research=research, material=material, progress=progress,
            )
            if names:
                fields["materialNames"] = names
        finally:
            await progress.close()
    except Exception as exc:
        attempts = int(prep.get("attempts", 0)) + 1
        permanent = isinstance(exc, AiUnavailable | BriefRejected) or attempts >= MAX_ATTEMPTS
        log.warning("debate preparation failed", extra={"attempts": attempts, "error": type(exc).__name__})
        if permanent:
            await ref.update({"status": "failed", "failureReason": type(exc).__name__, "attempts": attempts})
            await debate_ref.update({"status": "failed"})
            return
        await ref.update({"status": "queued", "attempts": attempts})
        raise RetryableTaskError("debate preparation") from exc

    await ref.update(
        {
            **fields,
            "userPosition": user_position.value,
            "aiPosition": ai_position.value,
            "positionMode": mode.value,
            "researchEnabled": research is not None,
            "status": "ready",
            "completedAt": datetime.now(UTC),
            "progress": progress.snapshot("done"),
        }
    )
    await debate_ref.update(
        {
            "activePrepId": prep_id,
            "status": "ready",
            "motion": fields["motion"],
            "userPosition": user_position.value,
            "aiPosition": ai_position.value,
            # A randomised side is fixed from here on, so the stored mode reflects reality.
            "positionMode": (
                PositionMode.USER.value if mode is PositionMode.USER else mode.value
            ),
            "updatedAt": datetime.now(UTC),
        }
    )


TASKS = {"extract_debate_material": extract_debate_material, "prepare_debate": prepare_debate}
