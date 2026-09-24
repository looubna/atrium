"""The Language Center (`/api/v1/language/...`).

    GET  /language/state                 profile, plan, progress and vocab counts, in one read
    PUT  /language/profile               a language to learn and why; writes (or rewrites) its plan
    POST /language/switch                back to another language already being learned
    DELETE /language/languages/{id}      stop learning a language: its plan, words and history go
    POST /language/sessions              a voice conversation: a plan objective or a ready-made scene
    POST /language/tip                   one tip on what the learner just said
    POST /language/translate             a line of the conversation, in the learner's own language
    POST /language/help                  "I'm stuck": what was said, and three things to say next
    POST /language/phrases               a word bank for a scene, or a word list for any topic
    POST /language/vocab                 save a word or phrase to the vocab coach
    POST /language/say                   a word or line in a native voice (slow on request)
    POST /language/pick                  which quoted phrases of a lesson line are model phrases to copy
    GET  /language/vocab                 the cards due now (or all, `?all=1`)
    POST /language/vocab/{id}/review     an answer on a card: again, good or easy

The conversation itself runs on `/sessions/{id}/live` (agents/tutor.py), and its report through the
platform's feedback pipeline (agents/evaluator.py, wrapup.py).
"""

from __future__ import annotations

import base64
from datetime import UTC, datetime
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, status
from google.api_core.exceptions import AlreadyExists
from pydantic import BaseModel, ConfigDict, Field

from app.core.errors import NotFound, ServiceUnavailable, ValidationFailed
from app.modules.interview.api import GRACE_MS, EmailNotVerified
from app.modules.interview.sanitize import clean_phrase, clean_text
from app.modules.language import MODULE_ID
from app.modules.language.catalog import BY_ID, SCENARIO_BY_ID, SCENARIOS, Level, language
from app.modules.language.coach import help_me, phrases, pick_phrases, tip, translate, write_plan
from app.modules.language.store import (
    XP_REVIEW,
    add_progress,
    level_of,
    plan_ref,
    profile_ref,
    progress_ref,
    read_plan,
    review,
    streak_now,
    vocab_col,
    vocab_id,
)
from app.modules.language.voice import native_audio
from app.platform.auth.dependencies import AuthUser
from app.platform.clients import clients
from app.platform.firestore.paths import UserPaths, client_uuid, require_id
from app.platform.ratelimit import rate_limit
from app.platform.runtime_config import ai_enabled
from app.platform.sessions import new_session_document
from app.platform.usage import Metric, Period, UsageService
from app.platform.users import ConsentKind, plan_limits, require_consents

router = APIRouter(prefix="/language", tags=["language"])


def _iso(value: Any) -> str | None:
    return value.isoformat() if isinstance(value, datetime) else (str(value) if value else None)


def _learning(profile: dict[str, Any] | None) -> dict[str, dict[str, Any]]:
    """Every language being learned, with its level, goals and the language it is taught in.

    Each language has its own: Korean may be learned from Arabic and French from English. Profiles
    from before list only one language, and entries from before had one shared own language.
    """
    profile = profile or {}
    shared_native = profile.get("native")
    learning = {k: dict(v) for k, v in (profile.get("learning") or {}).items()}
    target = profile.get("target")
    if target and target not in learning:
        learning[target] = {"level": profile.get("level"), "goals": profile.get("goals") or ""}
    for entry in learning.values():
        entry.setdefault("native", shared_native)
    return {k: v for k, v in learning.items() if k in BY_ID and v.get("native") != k}


async def _state(uid: str) -> dict[str, Any]:
    profile = (await profile_ref(uid).get()).to_dict()
    progress = (await progress_ref(uid).get()).to_dict() or {}
    target = str((profile or {}).get("target") or "")
    plan = await read_plan(uid, target) if target else {}
    now = datetime.now(UTC)
    total = due = 0
    if target:
        async for card in vocab_col(uid).where("target", "==", target).stream():
            total += 1
            when = (card.to_dict() or {}).get("due")
            if not isinstance(when, datetime) or when <= now:
                due += 1
    xp = int(progress.get("xp", 0))
    return {
        "profile": {k: (profile or {}).get(k) for k in ("target", "native", "level", "goals")} if profile else None,
        "plan": plan.get("chapters") or [],
        "progress": {
            "xp": xp, **level_of(xp), "streak": streak_now(progress.get("streak"), now.date()),
            # This language's conversations (entries from before carried no language: they are its).
            "history": [h for h in progress.get("history") or [] if h.get("target", target) == target][:20],
        },
        "languages": [{"id": k, "level": v.get("level"), "native": v.get("native")}
                      for k, v in _learning(profile).items()],
        "vocab": {"total": total, "due": due},
        "scenarios": [{"id": s.id, "title": s.title, "icon": s.icon} for s in SCENARIOS],
    }


@router.get("/state")
async def get_state(user: Annotated[AuthUser, Depends(rate_limit("language_state", limit=240, window_seconds=3600))]
                    ) -> dict[str, Any]:
    return await _state(user.uid)


class Profile(BaseModel):
    model_config = ConfigDict(extra="forbid")

    target: str
    native: str
    level: Level
    goals: Annotated[str, Field(max_length=400)] = ""


@router.put("/profile")
async def put_profile(
    body: Profile,
    user: Annotated[AuthUser, Depends(rate_limit("language_profile", limit=20, window_seconds=3600))],
) -> dict[str, Any]:
    if body.target not in BY_ID or body.native not in BY_ID:
        raise ValidationFailed("choose a language")
    if body.target == body.native:
        raise ValidationFailed("choose a language other than your own")
    if not user.verified_for_ai:
        raise EmailNotVerified()
    await require_consents(user, ConsentKind.AI_PROCESSING)
    goals = clean_text(body.goals, 400)
    chapters = await write_plan(user.uid, language(body.target), language(body.native), body.level, goals)
    await plan_ref(user.uid, body.target).set({"chapters": chapters, "target": body.target,
                                               "updatedAt": datetime.now(UTC)})
    learning = _learning((await profile_ref(user.uid).get()).to_dict())
    learning[body.target] = {"level": body.level.value, "goals": goals, "native": body.native}
    await profile_ref(user.uid).set({"target": body.target, "native": body.native, "level": body.level.value,
                                     "goals": goals, "learning": learning, "updatedAt": datetime.now(UTC)})
    return await _state(user.uid)


class Switch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    target: str


@router.post("/switch")
async def switch_language(
    body: Switch,
    user: Annotated[AuthUser, Depends(rate_limit("language_switch", limit=120, window_seconds=3600))],
) -> dict[str, Any]:
    profile = (await profile_ref(user.uid).get()).to_dict()
    learning = _learning(profile)
    if body.target not in learning:
        raise ValidationFailed("set this language up first")
    chosen = learning[body.target]
    # The language it is taught in comes with it: tips, translations and explanations follow.
    await profile_ref(user.uid).set({**(profile or {}), "target": body.target, "level": chosen.get("level"),
                                     "goals": chosen.get("goals") or "",
                                     "native": chosen.get("native") or (profile or {}).get("native"),
                                     "learning": learning, "updatedAt": datetime.now(UTC)})
    return await _state(user.uid)


@router.delete("/languages/{lang_id}")
async def remove_language(
    lang_id: str,
    user: Annotated[AuthUser, Depends(rate_limit("language_remove", limit=30, window_seconds=3600))],
) -> dict[str, Any]:
    """Stop learning a language. Its plan, saved words and conversation history go; XP and the
    streak stay (they were earned). The language on screen moves to another one, or, with none
    left, the learner sets up again."""
    profile = (await profile_ref(user.uid).get()).to_dict() or {}
    learning = _learning(profile)
    if lang_id not in learning:
        raise NotFound()
    del learning[lang_id]

    await plan_ref(user.uid, lang_id).delete()
    legacy = clients.firestore().document(f"{UserPaths(user.uid).user()}/language/plan")
    if ((await legacy.get()).to_dict() or {}).get("target") == lang_id:
        await legacy.delete()
    batch, pending = clients.firestore().batch(), 0
    async for card in vocab_col(user.uid).where("target", "==", lang_id).stream():
        batch.delete(card.reference)
        pending += 1
        if pending == 400:
            await batch.commit()
            batch, pending = clients.firestore().batch(), 0
    if pending:
        await batch.commit()
    progress = progress_ref(user.uid)
    kept = [h for h in ((await progress.get()).to_dict() or {}).get("history") or []
            if h.get("target", profile.get("target")) != lang_id]
    if (await progress.get()).exists:
        await progress.update({"history": kept})

    if not learning:
        await profile_ref(user.uid).delete()
    elif profile.get("target") == lang_id or profile.get("target") not in learning:
        target, chosen = next(iter(learning.items()))
        await profile_ref(user.uid).set({**profile, "target": target, "level": chosen.get("level"),
                                         "goals": chosen.get("goals") or "",
                                         "native": chosen.get("native") or profile.get("native"),
                                         "learning": learning, "updatedAt": datetime.now(UTC)})
    else:
        await profile_ref(user.uid).set({**profile, "learning": learning, "updatedAt": datetime.now(UTC)})
    return await _state(user.uid)


class CreateSession(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: Annotated[str, Field(description="Client-generated UUIDv4; retrying with the same id is safe.")]
    #: A plan objective, or a ready-made scenario.
    objectiveId: Annotated[str, Field(max_length=20)] = ""
    scenarioId: Annotated[str, Field(max_length=40)] = ""
    durationMinutes: Annotated[int, Field(ge=3, le=30)] = 10
    #: A role-play in the scene, or a tutor lesson on it that checks every answer.
    mode: Literal["roleplay", "lesson"] = "roleplay"
    #: The partner speaks slowly.
    slow: bool = False


async def _scene(uid: str, body: CreateSession) -> tuple[dict[str, str], str]:
    if body.objectiveId:
        profile = (await profile_ref(uid).get()).to_dict() or {}
        plan = await read_plan(uid, str(profile.get("target") or ""))
        for chapter in plan.get("chapters") or []:
            for objective in chapter.get("objectives") or []:
                if objective.get("id") == body.objectiveId:
                    return ({"title": str(objective.get("title")), "role": str(objective.get("role")),
                             "situation": str(objective.get("situation")), "goal": str(objective.get("goal"))},
                            body.objectiveId)
        raise NotFound()
    scenario = SCENARIO_BY_ID.get(body.scenarioId)
    if scenario is None:
        raise ValidationFailed("choose a scene")
    return ({"title": scenario.title, "role": scenario.role, "situation": scenario.situation,
             "goal": scenario.goal}, "")


@router.post("/sessions", status_code=status.HTTP_201_CREATED)
async def create_session(
    body: CreateSession,
    user: Annotated[AuthUser, Depends(rate_limit("language_sessions", limit=40, window_seconds=3600))],
) -> dict[str, Any]:
    session_id = client_uuid(body.id)
    if not user.verified_for_ai:
        raise EmailNotVerified()
    await require_consents(user, ConsentKind.AI_PROCESSING, ConsentKind.RECORDING)
    if not await ai_enabled():
        raise ServiceUnavailable()
    profile = (await profile_ref(user.uid).get()).to_dict()
    if not profile:
        raise ValidationFailed("set up your language first")
    scene, objective_id = await _scene(user.uid, body)

    db = clients.firestore()
    ref = db.document(UserPaths(user.uid).session(session_id))
    existing = await ref.get()
    if not existing.exists:
        _, limits = await plan_limits(user)
        minutes = min(body.durationMinutes, limits.max_round_minutes)
        context = {
            "sessionId": session_id, "target": profile.get("target"), "native": profile.get("native"),
            "level": profile.get("level"), "scene": scene, "objectiveId": objective_id, "durationMinutes": minutes,
            "mode": body.mode, "slow": body.slow,
        }
        await UsageService(db).reserve(user.uid, Metric.SESSIONS, 1, limit=limits.sessions_day, period=Period.DAY)
        try:
            await ref.create(new_session_document(module=MODULE_ID, context=context,
                                                  max_duration_ms=minutes * 60_000 + GRACE_MS))
        except AlreadyExists:
            await UsageService(db).record(user.uid, {Metric.SESSIONS: -1}, period=Period.DAY)
    return {"id": session_id, "liveUrl": f"/api/v1/sessions/{session_id}/live", "scene": scene}


async def _languages(uid: str):
    profile = (await profile_ref(uid).get()).to_dict()
    if not profile:
        raise ValidationFailed("set up your language first")
    try:
        level = Level(str(profile.get("level")))
    except ValueError:
        level = Level.BEGINNER
    return language(str(profile.get("target"))), language(str(profile.get("native"))), level


class TipRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    heard: Annotated[str, Field(max_length=1000)] = ""
    said: Annotated[str, Field(min_length=1, max_length=1000)]


@router.post("/tip")
async def get_tip(
    body: TipRequest,
    user: Annotated[AuthUser, Depends(rate_limit("language_tip", limit=300, window_seconds=3600))],
) -> dict[str, Any]:
    target, native, level = await _languages(user.uid)
    return await tip(user.uid, target, native, level, body.heard, body.said)


class TranslateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: Annotated[str, Field(min_length=1, max_length=1000)]


@router.post("/translate")
async def get_translation(
    body: TranslateRequest,
    user: Annotated[AuthUser, Depends(rate_limit("language_translate", limit=300, window_seconds=3600))],
) -> dict[str, Any]:
    _, native, _ = await _languages(user.uid)
    return {"text": await translate(user.uid, body.text, native)}


class HelpRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    heard: Annotated[str, Field(max_length=1000)] = ""
    scene: dict[str, Annotated[str, Field(max_length=300)]] = Field(default_factory=dict)


@router.post("/help")
async def get_help(
    body: HelpRequest,
    user: Annotated[AuthUser, Depends(rate_limit("language_help", limit=200, window_seconds=3600))],
) -> dict[str, Any]:
    target, native, level = await _languages(user.uid)
    return await help_me(user.uid, target, native, level, body.scene, body.heard)


class PhrasesRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    topic: Annotated[str, Field(min_length=2, max_length=300)]
    count: Annotated[int, Field(ge=4, le=14)] = 12


@router.post("/phrases")
async def get_phrases(
    body: PhrasesRequest,
    user: Annotated[AuthUser, Depends(rate_limit("language_phrases", limit=60, window_seconds=3600))],
) -> dict[str, Any]:
    target, native, level = await _languages(user.uid)
    items = await phrases(user.uid, target, native, level, clean_text(body.topic, 300), body.count)
    return {"items": items}


class NewCard(BaseModel):
    model_config = ConfigDict(extra="forbid")

    term: Annotated[str, Field(min_length=1, max_length=80)]
    translation: Annotated[str, Field(max_length=120)] = ""
    example: Annotated[str, Field(max_length=200)] = ""


@router.post("/vocab", status_code=status.HTTP_201_CREATED)
async def save_card(
    body: NewCard,
    user: Annotated[AuthUser, Depends(rate_limit("language_save", limit=300, window_seconds=3600))],
) -> dict[str, Any]:
    target, _, _ = await _languages(user.uid)
    term = clean_phrase(body.term, 80)
    if not term:
        raise ValidationFailed("nothing to save")
    card_id = vocab_id(target.id, term)
    ref = vocab_col(user.uid).document(card_id)
    now = datetime.now(UTC)
    fields = {"target": target.id, "term": term, "translation": clean_phrase(body.translation, 120),
              "example": clean_text(body.example, 200), "savedByLearner": True}
    if (await ref.get()).exists:
        await ref.update(fields)
    else:
        await ref.set({**fields, "addedAt": now, "box": 0, "due": now, "reviews": 0})
    return {"id": card_id, "term": term}


class SayRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: Annotated[str, Field(min_length=1, max_length=300)]
    #: Whose voice: the language being learned, or the learner's own (for their side of a lesson).
    voice: Literal["target", "native"] = "target"
    slow: bool = False


@router.post("/say")
async def say(
    body: SayRequest,
    user: Annotated[AuthUser, Depends(rate_limit("language_say", limit=600, window_seconds=3600))],
) -> dict[str, Any]:
    target, native, _ = await _languages(user.uid)
    audio = await native_audio(body.text, target if body.voice == "target" else native, slow=body.slow)
    # No audio (local development without AI): the page falls back to the device's own voice.
    return {"audio": base64.b64encode(audio).decode() if audio else None, "mime": "audio/mpeg"}


class PickRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    line: Annotated[str, Field(min_length=1, max_length=1000)]
    quoted: Annotated[list[Annotated[str, Field(max_length=120)]], Field(max_length=6)]


@router.post("/pick")
async def pick(
    body: PickRequest,
    user: Annotated[AuthUser, Depends(rate_limit("language_pick", limit=400, window_seconds=3600))],
) -> dict[str, Any]:
    target, native, _ = await _languages(user.uid)
    return {"phrases": await pick_phrases(user.uid, target, native, body.line, body.quoted)}


@router.get("/vocab")
async def get_vocab(
    user: Annotated[AuthUser, Depends(rate_limit("language_vocab", limit=240, window_seconds=3600))],
    all: bool = False,
) -> dict[str, Any]:
    target, _, _ = await _languages(user.uid)
    now = datetime.now(UTC)
    cards = []
    async for doc in vocab_col(user.uid).where("target", "==", target.id).stream():
        card = doc.to_dict() or {}
        due = card.get("due")
        if all or not isinstance(due, datetime) or due <= now:
            cards.append({"id": doc.id, "term": card.get("term"), "translation": card.get("translation"),
                          "example": card.get("example"), "box": card.get("box", 0), "due": _iso(due)})
    cards.sort(key=lambda c: (c["box"], c["due"] or ""))
    return {"cards": cards[:100 if all else 20]}


class Review(BaseModel):
    model_config = ConfigDict(extra="forbid")

    grade: Literal["again", "good", "easy"]


@router.post("/vocab/{card_id}/review")
async def review_card(
    card_id: str,
    body: Review,
    user: Annotated[AuthUser, Depends(rate_limit("language_review", limit=600, window_seconds=3600))],
) -> dict[str, Any]:
    ref = vocab_col(user.uid).document(require_id(card_id))
    snap = await ref.get()
    if not snap.exists:
        raise NotFound()
    update = review(snap.to_dict() or {}, body.grade, datetime.now(UTC))
    await ref.update(update)
    await add_progress(user.uid, xp=XP_REVIEW)
    return {"id": card_id, "box": update["box"], "due": _iso(update["due"])}
