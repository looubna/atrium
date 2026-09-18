"""Practice Center API (`/api/v1/practice`): analyse a round, and read progress.

The recording is analysed in memory and dropped. Progress is only ever written here,
inside a transaction, so XP and personal bests can't be set by the client.
"""

from __future__ import annotations

import json
import logging
from datetime import UTC, date, datetime, timedelta
from typing import Annotated, Any

from fastapi import APIRouter, Depends, File, Form, UploadFile
from google.cloud import firestore

from app.core.errors import PayloadTooLarge, ServiceUnavailable, UnsupportedMedia, ValidationFailed
from app.core.settings import AiProvider, get_settings
from app.modules.practice.analysis import MAX_SECONDS, RoundInput, analyse_round, decode_to_pcm
from app.modules.practice.catalog import DRILLS
from app.modules.practice.progress import apply_round, overview
from app.platform.auth.dependencies import AuthUser, current_user
from app.platform.clients import clients
from app.platform.firestore.paths import UserPaths, new_id
from app.platform.media.ffmpeg import FfmpegError
from app.platform.ratelimit import rate_limit
from app.platform.transcripts.stt import SttFailed
from app.platform.usage import Metric, Period, UsageService
from app.platform.users import ConsentKind, plan_limits, require_consents

log = logging.getLogger(__name__)

router = APIRouter(prefix="/practice", tags=["practice"])

MAX_UPLOAD_BYTES = 8 * 1024 * 1024
MAX_PROMPT_CHARS = 8_000


def local_day(value: str | None) -> str:
    """The user's calendar day, trusted only within a day of the server's."""
    today = datetime.now(UTC).date()
    try:
        claimed = date.fromisoformat(value or "")
    except ValueError:
        return today.isoformat()
    return claimed.isoformat() if abs(claimed - today) <= timedelta(days=1) else today.isoformat()


@router.get("/progress")
async def get_progress(user: current_user, day: str | None = None) -> dict[str, Any]:
    snap = await clients.firestore().document(UserPaths(user.uid).practice_progress()).get()
    return overview(snap.to_dict() if snap.exists else None, user.uid, local_day(day))


@router.post("/rounds")
async def submit_round(
    user: Annotated[AuthUser, Depends(rate_limit("practice_round", limit=120, window_seconds=3600))],
    audio: Annotated[UploadFile, File()],
    drill_id: Annotated[str, Form(alias="drillId")],
    prompt: Annotated[str, Form()] = "{}",
    day: Annotated[str | None, Form(alias="localDate")] = None,
    prep_used_ms: Annotated[int, Form(alias="prepUsedMs", ge=0, le=600_000)] = 0,
    speak_seconds: Annotated[int, Form(alias="speakSeconds", ge=5, le=MAX_SECONDS)] = 60,
    eye_contact_pct: Annotated[float | None, Form(alias="eyeContactPct", ge=0, le=100)] = None,
    fake_text: Annotated[str, Form(alias="fakeText")] = "",
) -> dict[str, Any]:
    drill = DRILLS.get(drill_id)
    if drill is None:
        raise ValidationFailed("Unknown drill", extra={"field": "drillId"})
    try:
        prompt_data = json.loads(prompt[:MAX_PROMPT_CHARS])
    except json.JSONDecodeError:
        prompt_data = None
    if not isinstance(prompt_data, dict):
        raise ValidationFailed("The prompt must be a JSON object", extra={"field": "prompt"})
    await require_consents(user, ConsentKind.AI_PROCESSING)

    data = await audio.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise PayloadTooLarge("A round can be up to 8 MB of audio")
    if not data:
        raise UnsupportedMedia("The recording is empty")

    db = clients.firestore()
    paths = UserPaths(user.uid)
    _, limits = await plan_limits(user)
    await UsageService(db).reserve(
        user.uid, Metric.PRACTICE_ROUNDS, 1, limit=limits.practice_rounds_day, period=Period.DAY
    )

    try:
        pcm = await decode_to_pcm(data)
    except FfmpegError as exc:
        raise UnsupportedMedia("The recording couldn't be read") from exc
    fake = fake_text if get_settings().ai_provider is AiProvider.FAKE else ""
    try:
        result = await analyse_round(
            user.uid,
            RoundInput(
                drill=drill,
                prompt=prompt_data,
                pcm16=pcm,
                prep_used_ms=prep_used_ms,
                speak_seconds=speak_seconds,
                eye_contact_pct=eye_contact_pct,
                fake_text=fake,
            ),
        )
    except SttFailed as exc:
        log.warning("practice round speech-to-text failed", extra={"drill": drill.id, "error": str(exc)[:300]})
        raise ServiceUnavailable("We couldn't analyse this round. Try again in a moment.") from exc

    today = local_day(day)
    attempt_id = new_id()
    progress_ref = db.document(paths.practice_progress())
    attempt_ref = db.document(paths.practice_attempt(attempt_id))

    @firestore.async_transactional
    async def save(transaction: firestore.AsyncTransaction) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
        snap = await progress_ref.get(transaction=transaction)
        before = (snap.to_dict() or {}) if snap.exists else {}
        after, awards = apply_round(before, drill, result.values, result.speech_ms, today, user.uid)
        after["updatedAt"] = firestore.SERVER_TIMESTAMP
        transaction.set(progress_ref, after)
        transaction.set(
            attempt_ref,
            {
                "drillId": drill.id,
                "day": today,
                "createdAt": firestore.SERVER_TIMESTAMP,
                "prompt": prompt_data,
                "values": result.values,
                "speechMs": result.speech_ms,
                "transcript": result.transcript[:20_000],
                "feedback": result.feedback,
                "skillEvidence": result.skills,
                "awards": awards.view(),
            },
        )
        return before, after, awards.view()

    before, after, awards = await save(db.transaction())

    previous_bests = ((before.get("drills") or {}).get(drill.id) or {}).get("bests") or {}
    new_keys = {b["key"] for b in awards["newBests"]}
    metrics = [
        {
            "key": m.key,
            "label": m.label,
            "unit": m.unit,
            "better": m.better,
            "source": m.source,
            "scale": list(m.scale),
            "goal": m.goal,
            "band": list(m.band) if m.band else None,
            "value": result.values.get(m.key),
            "best": (previous_bests.get(m.key) or {}).get("value") if m.key in drill.bests else None,
            "isBestMetric": m.key in drill.bests,
            "newBest": m.key in new_keys,
        }
        for m in drill.metrics
    ]
    return {
        "attemptId": attempt_id,
        "drillId": drill.id,
        "minSpeechSeconds": drill.min_speech_ms // 1000,
        "transcript": result.transcript,
        "timeline": result.timeline,
        "speechMs": result.speech_ms,
        "metrics": metrics,
        "feedback": result.feedback,
        "awards": awards,
        "progress": overview(after, user.uid, today),
    }
