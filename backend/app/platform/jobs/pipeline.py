"""Post-session processing pipeline.

    prepare_submit_stt ──▶ poll_stt (repeats until recognition finishes) ──▶ evaluate_persist

Each step runs as its own Cloud Tasks request to the worker. Before doing any
work a step claims the job in a transaction: the job's run ID and current step
must match the task, and it must not be leased by another attempt. Duplicate,
late or superseded tasks therefore do nothing. Failures are counted; transient
ones are retried by Cloud Tasks, permanent ones (or too many retries) mark the
job and the session as failed.
"""

from __future__ import annotations

import asyncio
import json
import logging
import tempfile
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from google.cloud import firestore

from app.core.errors import ServiceUnavailable
from app.core.logging import job_id_var, session_id_var, step_var, uid_var
from app.core.settings import AiProvider, Env, get_settings
from app.modules.registry import registry
from app.platform.ai.gateway import MediaRef
from app.platform.ai.pricing import audio_minutes_cost_micros
from app.platform.clients import clients
from app.platform.competencies.profile import apply_scores
from app.platform.firestore.paths import UserPaths, job_path
from app.platform.jobs.queue import TaskRequest, task_name, task_queue
from app.platform.media.assemble import Playback, assemble_candidate, assemble_interviewer, pcm_duration_ms
from app.platform.media.body import BodyReport, analyse_body, parse_body_seconds
from app.platform.media.ffmpeg import mix_to_m4a, pcm_to_flac_chunks
from app.platform.media.prosody import VoiceMetrics, measure_voice
from app.platform.media.tracks import SAMPLE_RATES
from app.platform.media.visual import (
    Setting,
    VisualMetrics,
    honest_visual_scores,
    measure_visual,
    parse_face_seconds,
)
from app.platform.sessions import ProcessingStatus
from app.platform.storage.objects import processing, user_content
from app.platform.storage.paths import StoragePaths, Track, processing_prefix
from app.platform.transcripts.metrics import compute_delivery_metrics
from app.platform.transcripts.model import Segment, Transcript, assemble_transcript
from app.platform.transcripts.stt import AudioChunk, CandidateTurn, SttFailed, speech_to_text
from app.platform.usage import Metric, Period, UsageService
from app.platform.users import ConsentKind, load_consents

log = logging.getLogger(__name__)

QUEUE = "processing"
PREPARE, POLL, EVALUATE = "prepare_submit_stt", "poll_stt", "evaluate_persist"
STEPS = (PREPARE, POLL, EVALUATE)
LEASE = timedelta(minutes=35)
POLL_DELAY_S = 20
MAX_POLLS = 200
MAX_STEP_FAILURES = 5
COMPLETED_JOB_TTL = timedelta(days=30)
MIN_SPEECH_MS = 1_000
#: How long evaluation waits for a camera video that is still uploading (20 s x 8).
VIDEO_WAIT_S = 20
MAX_VIDEO_WAITS = 8


class PermanentStepError(Exception):
    """The step can never succeed for this job (e.g. no audio was recorded)."""


# -- job state ------------------------------------------------------------------


async def claim(job_id: str, run_id: str, step: str) -> dict[str, Any] | None:
    ref = clients.firestore().document(job_path(job_id))
    now = datetime.now(UTC)

    @firestore.async_transactional
    async def txn(transaction: firestore.AsyncTransaction) -> dict[str, Any] | None:
        snap = await ref.get(transaction=transaction)
        job = snap.to_dict() or {}
        if not snap.exists or job.get("runId") != run_id or job.get("step") != step:
            return None
        status = job.get("status")
        lease = job.get("leaseUntil")
        if status in ("queued", "retrying") or (status == "running" and lease is not None and lease < now):
            transaction.update(ref, {"status": "running", "leaseUntil": now + LEASE, "updatedAt": now})
            return {**job, "id": job_id}
        return None

    return await txn(clients.firestore().transaction())


async def _session_ref(job: dict[str, Any]) -> firestore.AsyncDocumentReference:
    return clients.firestore().document(UserPaths(job["uid"]).session(job["sessionId"]))


async def set_processing(job: dict[str, Any], status: ProcessingStatus, **fields: Any) -> None:
    ref = await _session_ref(job)
    await ref.update({"processingStatus": status.value, "processingUpdatedAt": datetime.now(UTC), **fields})


async def advance(job: dict[str, Any], next_step: str, *, delay_s: int = 0, sequence: int = 1, **fields: Any) -> None:
    now = datetime.now(UTC)
    await clients.firestore().document(job_path(job["id"])).update(
        {"step": next_step, "status": "queued", "failures": 0, "leaseUntil": None, "updatedAt": now, **fields}
    )
    await enqueue_step(job["id"], job["runId"], next_step, sequence=sequence, delay_s=delay_s)


async def enqueue_step(job_id: str, run_id: str, step: str, *, sequence: int = 1, delay_s: int = 0) -> bool:
    return await task_queue().enqueue(
        TaskRequest(
            queue=QUEUE,
            path=f"/internal/tasks/{step}",
            payload={"jobId": job_id, "runId": run_id},
            name=task_name(job_id, run_id, step, str(sequence)),
            delay_seconds=delay_s,
        )
    )


async def record_failure(job: dict[str, Any], step: str, message: str, *, retryable: bool) -> bool:
    """Returns True when the task should be retried."""
    failures = int(job.get("failures", 0)) + 1
    ref = clients.firestore().document(job_path(job["id"]))
    now = datetime.now(UTC)
    if retryable and failures < MAX_STEP_FAILURES:
        await ref.update({"status": "retrying", "failures": failures, "lastError": message[:300], "updatedAt": now})
        return True
    await ref.update(
        {"status": "failed", "failures": failures, "lastError": message[:300], "updatedAt": now,
         "expireAt": now + COMPLETED_JOB_TTL}
    )
    await set_processing(job, ProcessingStatus.FAILED, failure={"step": step, "retryable": retryable})
    return False


# -- shared loading ---------------------------------------------------------------


async def load_session(job: dict[str, Any]) -> dict[str, Any]:
    db = clients.firestore()
    user = await db.document(UserPaths(job["uid"]).user()).get()
    if ((user.to_dict() or {}).get("deletion") or {}).get("status"):
        raise PermanentStepError("account is being deleted")
    snap = await (await _session_ref(job)).get()
    if not snap.exists:
        raise PermanentStepError("session no longer exists")
    return snap.to_dict() or {}


async def load_turns(job: dict[str, Any]) -> list[dict[str, Any]]:
    query = clients.firestore().collection(UserPaths(job["uid"]).turns(job["sessionId"])).order_by("seq")
    return [snap.to_dict() or {} async for snap in query.stream()]


def candidate_turns(turns: list[dict[str, Any]]) -> list[CandidateTurn]:
    return [
        CandidateTurn(str(t.get("text", "")), int(t["tStartMs"]), int(t.get("tEndMs") or t["tStartMs"]))
        for t in turns
        if t.get("speaker") == "candidate" and t.get("tStartMs") is not None
    ]


def interviewer_segments(turns: list[dict[str, Any]]) -> list[Segment]:
    return [
        Segment(id="", speaker="interviewer", start_ms=int(t["tStartMs"]),
                end_ms=int(t.get("tEndMs") or t["tStartMs"]), text=str(t.get("text", "")))
        for t in turns
        if t.get("speaker") == "interviewer" and t.get("tStartMs") is not None and t.get("text")
    ]


def _write_file(path: Path, data: bytes) -> None:
    path.write_bytes(data)


def _read_file(path: Path) -> bytes:
    return path.read_bytes()


# -- steps ------------------------------------------------------------------------


async def step_prepare(job: dict[str, Any]) -> None:
    session = await load_session(job)
    uid, sid = job["uid"], job["sessionId"]
    paths, store = StoragePaths(uid), user_content()
    max_ms = int(session.get("maxDurationMs", 60 * 60_000)) + 60_000

    candidate = [await store.read(n) for n in await store.list(paths.live_prefix(sid, Track.CANDIDATE))]
    interviewer = [await store.read(n) for n in await store.list(paths.live_prefix(sid, Track.INTERVIEWER))]
    turns = await load_turns(job)
    playback = {
        int(t["interviewerTurnSeq"]): Playback(int(t["tStartMs"]), t.get("tEndMs"))
        for t in turns
        if t.get("speaker") == "interviewer" and t.get("tStartMs") is not None and t.get("interviewerTurnSeq")
    }
    candidate_pcm = assemble_candidate(candidate, max_ms=max_ms)
    interviewer_pcm = assemble_interviewer(interviewer, playback, max_ms=max_ms)
    duration_ms = max(
        pcm_duration_ms(candidate_pcm, SAMPLE_RATES[Track.CANDIDATE]),
        pcm_duration_ms(interviewer_pcm, SAMPLE_RATES[Track.INTERVIEWER]),
    )
    candidate_ms = pcm_duration_ms(candidate_pcm, SAMPLE_RATES[Track.CANDIDATE])
    if candidate_ms < MIN_SPEECH_MS:
        raise PermanentStepError("no candidate audio was recorded")

    with tempfile.TemporaryDirectory(prefix="atrium-") as tmp:
        work = Path(tmp)
        cand_path, ivr_path, audio_path = work / "cand.pcm", work / "ivr.pcm", work / "audio.m4a"
        await asyncio.to_thread(_write_file, cand_path, candidate_pcm)
        await asyncio.to_thread(_write_file, ivr_path, interviewer_pcm)
        await mix_to_m4a(
            cand_path, SAMPLE_RATES[Track.CANDIDATE], ivr_path, SAMPLE_RATES[Track.INTERVIEWER], audio_path
        )
        await store.write(paths.session_audio(sid), await asyncio.to_thread(_read_file, audio_path), "audio/mp4")

        prefix = f"{processing_prefix(job['id'])}{job['runId']}/"
        # Kept for voice measurements after transcription (processing files are deleted after 3 days).
        candidate_pcm_name = f"{prefix}candidate.pcm"
        await processing().write(candidate_pcm_name, candidate_pcm, "application/octet-stream")
        chunks: list[AudioChunk] = []
        for chunk in await pcm_to_flac_chunks(candidate_pcm, SAMPLE_RATES[Track.CANDIDATE], work / "chunks"):
            name = f"{prefix}{chunk.path.name}"
            await processing().write(name, await asyncio.to_thread(_read_file, chunk.path), "audio/flac")
            chunks.append(AudioChunk(name, chunk.offset_ms))

    stt = speech_to_text(candidate_turns(turns))
    operations = await stt.start(chunks, f"{prefix}stt/", "en-US")
    settings = get_settings()
    if settings.ai_provider is AiProvider.VERTEX:
        cost = audio_minutes_cost_micros(candidate_ms, settings.speech_micros_per_minute)
        log.info("ai_usage", extra={"purpose": "transcription", "audioMs": candidate_ms, "estCostMicros": cost})
        await UsageService(clients.firestore()).record(
            job["uid"], {Metric.EST_COST_MICROS: cost or 0}, period=Period.MONTH
        )
    media_fields = {"media.audioPath": paths.session_audio(sid), "media.durationMs": duration_ms}
    await set_processing(job, ProcessingStatus.TRANSCRIBING, **media_fields)
    await advance(
        job, POLL, delay_s=POLL_DELAY_S,
        chunks=[{"name": c.name, "offsetMs": c.offset_ms} for c in chunks],
        sttOperations=operations, durationMs=duration_ms, polls=0, candidatePcm=candidate_pcm_name,
    )


async def step_poll(job: dict[str, Any]) -> None:
    await load_session(job)
    turns = await load_turns(job)
    stt = speech_to_text(candidate_turns(turns))
    chunks = [AudioChunk(c["name"], int(c["offsetMs"])) for c in job.get("chunks", [])]
    try:
        results = await stt.results(list(job.get("sttOperations", [])))
    except SttFailed as exc:
        if exc.retryable:
            raise
        raise PermanentStepError(str(exc)) from exc

    if results is None:
        polls = int(job.get("polls", 0)) + 1
        if polls > MAX_POLLS:
            raise PermanentStepError("transcription did not finish in time")
        await advance(job, POLL, delay_s=POLL_DELAY_S, sequence=polls + 1, polls=polls)
        return

    words = await stt.words(chunks, results)
    transcript = assemble_transcript(words, interviewer_segments(turns), int(job.get("durationMs", 0)))
    paths = StoragePaths(job["uid"])
    await user_content().write(
        paths.transcript(job["sessionId"]), transcript.model_dump_json().encode(), "application/json"
    )
    await set_processing(job, ProcessingStatus.ANALYZING, transcriptPath=paths.transcript(job["sessionId"]))
    await advance(job, EVALUATE)


def _body_report(face_data: Any, transcript: Transcript, setting: Setting, module: str) -> BodyReport | None:
    """Body-language findings; never the reason a report is lost (they are extra, and still being validated)."""
    try:
        seconds, pose_hz = parse_body_seconds(face_data)
        return analyse_body(
            seconds, transcript.candidate_segments(), pose_hz=pose_hz, setting=setting, scenario=module
        )
    except Exception:
        log.warning("body-language analysis failed", exc_info=True)
        return None


async def step_evaluate(job: dict[str, Any]) -> None:
    session = await load_session(job)
    uid, sid, run_id = job["uid"], job["sessionId"], job["runId"]
    db, paths, store = clients.firestore(), UserPaths(uid), user_content()
    module = str(session.get("module"))

    transcript = Transcript.model_validate_json(await store.read(StoragePaths(uid).transcript(sid)))
    metrics = compute_delivery_metrics(transcript.candidate_segments())
    code = [snap.to_dict() or {} async for snap in db.collection(paths.code_snapshots(sid)).stream()]
    prior = {
        snap.id: int((snap.to_dict() or {}).get("current", 0))
        async for snap in db.collection(paths.competencies()).stream()
    }

    media_info = session.get("media") or {}
    video_info = media_info.get("video") or {}
    waits = int(job.get("videoWaits", 0))
    if video_info.get("state") in ("uploading", "processing") and waits < MAX_VIDEO_WAITS:
        # The camera video is still uploading: give it a few minutes so feedback can include body language.
        await advance(job, EVALUATE, delay_s=VIDEO_WAIT_S, sequence=waits + 2, videoWaits=waits + 1)
        return

    visual: VisualMetrics | None = None
    body: BodyReport | None = None
    if media_info.get("faceMetrics"):
        in_person = (session.get("context") or {}).get("mode") == "in_person"
        setting: Setting = "in_person" if in_person else "online"
        try:
            face_data = json.loads(await store.read(StoragePaths(uid).face_metrics(sid)))
            visual = measure_visual(parse_face_seconds(face_data), transcript.candidate_segments(), setting)
        except (FileNotFoundError, ValueError):
            log.warning("face measurements could not be read")
            face_data = None
        if face_data is not None:
            body = _body_report(face_data, transcript, setting, module)

    voice: VoiceMetrics | None = None
    if job.get("candidatePcm"):
        try:
            pcm = await processing().read(str(job["candidatePcm"]))
            voice = await asyncio.to_thread(measure_voice, pcm, transcript.candidate_segments())
        except FileNotFoundError:
            log.warning("candidate audio for voice measurements is missing")
    settings = get_settings()
    # The model listens to the answers themselves; the files are read straight from the processing bucket.
    audio = [
        (MediaRef(f"gs://{settings.processing_bucket}/{chunk['name']}", "audio/flac"), int(chunk["offsetMs"]))
        for chunk in job.get("chunks", [])
    ] if settings.ai_provider is AiProvider.VERTEX and settings.app_env not in (Env.LOCAL, Env.TEST) else []

    video: tuple[MediaRef, int] | None = None
    video_path = str(video_info.get("path") or "")
    if (
        audio
        and video_info.get("state") == "ready"
        and video_path.startswith(StoragePaths(uid).session_prefix(sid))
        and any(c.kind is ConsentKind.VIDEO_ANALYSIS and c.current for c in await load_consents(uid))
    ):
        video = (
            MediaRef(f"gs://{settings.user_content_bucket}/{video_path}", str(video_info.get("contentType"))),
            int(video_info.get("startedAtMediaMs", 0)),
        )

    evaluator = registry.service(module, "evaluator")
    evaluation, meta = await evaluator.evaluate(
        uid=uid, run_id=run_id, session=session, transcript=transcript, metrics=metrics,
        code_snapshots=code, prior_scores=prior, voice=voice, audio=audio, visual=visual, video=video,
    )
    # Held to what the camera actually showed, whichever module wrote the report.
    evaluation.scores = honest_visual_scores(evaluation.scores, visual)
    await store.write(
        StoragePaths(uid).evaluation(sid, run_id), evaluation.model_dump_json().encode(), "application/json"
    )
    if body is not None:
        await store.write(
            StoragePaths(uid).body_language(sid), json.dumps(body.to_dict()).encode(), "application/json"
        )

    run_ref = db.document(paths.evaluation(sid, run_id))
    batch = db.batch()
    batch.set(run_ref, {
        "status": "completed",
        "model": get_settings().text_model,
        "promptVersion": meta.model_prompt_version,
        "catalogVersion": meta.catalog_version, "overallScore": evaluation.overallScore,
        "strengths": evaluation.strengths, "improvements": evaluation.improvements,
        "createdAt": datetime.now(UTC),
    })
    for event in evaluation.events:
        batch.set(db.document(f"{paths.events(sid, run_id)}/{event.id}"), event.model_dump(mode="json"))
    if body is not None:
        # Numbers only, one per session, for comparing sessions (like competencyHistory).
        batch.set(db.document(paths.body_history_entry(sid)), {
            **body.summary(), "module": module, "sessionId": sid, "at": session.get("createdAt") or datetime.now(UTC),
        })
    await batch.commit()

    session_at = session.get("createdAt") or datetime.now(UTC)
    deltas = await apply_scores(
        uid=uid, session_id=sid, module=module, context=session.get("context") or {},
        scores=evaluation.scores, catalog_version=meta.catalog_version, session_at=session_at,
    )
    retry_plan = registry.service(module, "retry_planner")(
        evaluation.scores, evaluation.questions, transcript, session.get("retryTargets")
    )

    # Anything else the module wants stored with the feedback (the debate module's argument
    # map, built from the state its opponent actually argued against). Optional: a module
    # without this service contributes nothing, and a failure here must not lose feedback
    # that has already been written.
    extras: dict[str, Any] = {}
    try:
        post_steps = registry.service(module, "post_evaluation_steps")
    except LookupError:
        post_steps = None
    if post_steps is not None:
        try:
            extras = await post_steps(
                uid=uid, session_id=sid, run_id=run_id, session=session,
                evaluation=evaluation, transcript=transcript,
            ) or {}
        except Exception:
            log.warning("post-evaluation steps failed", extra={"stepModule": module}, exc_info=True)

    user_ref, session_ref = db.document(paths.user()), db.document(paths.session(sid))

    @firestore.async_transactional
    async def finish(transaction: firestore.AsyncTransaction) -> None:
        user = await user_ref.get(transaction=transaction)
        if ((user.to_dict() or {}).get("deletion") or {}).get("status"):
            raise PermanentStepError("account is being deleted")
        transaction.update(session_ref, {
            **extras,
            **({"bodyLanguage": body.summary()} if body is not None else {}),
            "processingStatus": ProcessingStatus.COMPLETED.value,
            "processingUpdatedAt": datetime.now(UTC),
            "currentEvaluationRunId": run_id,
            "failure": None,
            "retryPlan": retry_plan,
            "summary": {
                "overallScore": evaluation.overallScore,
                "scores": [
                    {"competencyId": s.competencyId, "category": s.category.value, "score": s.score,
                     "confidence": s.confidence.value, "rationale": s.rationale, "measured": s.measured,
                     "meaning": s.meaning, "toReach100": s.toReach100, "metric": s.metric}
                    for s in evaluation.scores
                ],
                "deltas": [
                    {"competencyId": d.competency_id, "score": d.score, "previous": d.previous, "delta": d.delta}
                    for d in deltas if d.delta is not None
                ],
                "eventCount": len(evaluation.events),
                "strengths": evaluation.strengths,
                "improvements": evaluation.improvements,
            },
        })

    await finish(db.transaction())
    now = datetime.now(UTC)
    await db.document(job_path(job["id"])).update(
        {"status": "completed", "completedAt": now, "updatedAt": now, "expireAt": now + COMPLETED_JOB_TTL}
    )


HANDLERS: dict[str, Callable[[dict[str, Any]], Awaitable[None]]] = {
    PREPARE: step_prepare,
    POLL: step_poll,
    EVALUATE: step_evaluate,
}


async def execute_step(step: str, job_id: str, run_id: str) -> str:
    """Runs one step if this task still owns it. Raises ServiceUnavailable to ask for a retry."""
    job_id_var.set(job_id)
    step_var.set(step)
    job = await claim(job_id, run_id, step)
    if job is None:
        log.info("task skipped: job moved on or is leased elsewhere")
        return "skipped"
    uid_var.set(job["uid"])
    session_id_var.set(job["sessionId"])
    try:
        await HANDLERS[step](job)
    except PermanentStepError as exc:
        log.warning("processing step failed permanently", extra={"reason": str(exc)})
        await record_failure(job, step, str(exc), retryable=False)
        return "failed"
    except Exception as exc:
        log.exception("processing step failed")
        if await record_failure(job, step, type(exc).__name__, retryable=True):
            raise ServiceUnavailable("retrying") from exc
        return "failed"
    return "done"


async def dispatch_local(request: TaskRequest) -> None:
    """In-process execution for local development (no Cloud Tasks)."""
    step = request.path.rsplit("/", 1)[-1]
    if step not in HANDLERS:
        return
    try:
        await execute_step(step, str(request.payload["jobId"]), str(request.payload["runId"]))
    except ServiceUnavailable:
        await asyncio.sleep(2)
        await dispatch_local(request)
