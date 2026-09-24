"""After the feedback: the learner's Language Center moves on.

Runs as the module's post-evaluation step (the platform calls it once the report exists): the new
words and phrases from the conversation go into the vocab coach, the plan's objective is ticked off
when it was met, and the progress gets its XP, today's streak and a history entry.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any

from app.modules.interview.sanitize import clean_phrase, clean_text
from app.modules.language.agents.evaluator import turns_transcript
from app.modules.language.catalog import language
from app.modules.language.coach import wrap_up
from app.modules.language.store import XP_OBJECTIVE, XP_SESSION, add_progress, plan_ref, read_plan, vocab_col, vocab_id
from app.platform.clients import clients
from app.platform.feedback.schemas import ValidatedEvaluation
from app.platform.transcripts.model import Transcript

log = logging.getLogger(__name__)


async def post_evaluation_steps(
    *,
    uid: str,
    session_id: str,
    run_id: str,
    session: dict[str, Any],
    evaluation: ValidatedEvaluation,
    transcript: Transcript,
) -> dict[str, Any]:
    context = session.get("context") or {}
    target, native = language(str(context.get("target"))), language(str(context.get("native")))
    scene = context.get("scene") or {}
    heard = await turns_transcript(uid, session_id)
    lines = [{"speaker": "learner" if s.speaker == "candidate" else "tutor", "text": s.text} for s in heard.segments]
    try:
        result = await wrap_up(uid, target, native, str(scene.get("goal") or ""), lines)
    except Exception:
        log.warning("language wrap-up failed", exc_info=True)
        result = None

    now = datetime.now(UTC)
    new_words = 0
    if result is not None:
        batch = clients.firestore().batch()
        col = vocab_col(uid)
        for item in result.vocab[:8]:
            term = clean_phrase(item.term, 80)
            if not term:
                continue
            new_words += 1
            ref = col.document(vocab_id(target.id, term))
            batch.set(ref, {
                "target": target.id, "term": term, "translation": clean_phrase(item.translation, 120),
                "example": clean_text(item.example, 200), "sessionId": session_id, "addedAt": now,
                "box": 0, "due": now, "reviews": 0,
            }, merge=True)
        await batch.commit()

    met = bool(result and result.objectiveMet)
    objective_id = str(context.get("objectiveId") or "")
    if met and objective_id:
        plan = await read_plan(uid, target.id)
        chapters = plan.get("chapters") or []
        for chapter in chapters:
            for objective in chapter.get("objectives") or []:
                if objective.get("id") == objective_id:
                    objective["done"] = True
        await plan_ref(uid, target.id).set({**plan, "chapters": chapters, "target": target.id})

    await add_progress(uid, xp=XP_SESSION + (XP_OBJECTIVE if met else 0), entry={
        "sessionId": session_id, "title": str(scene.get("title") or "Conversation"), "target": target.id,
        "at": now.isoformat(), "objectiveMet": met, "newWords": new_words, "score": evaluation.overallScore,
        "summary": clean_text(result.summary, 240) if result else "",
    })
    return {"languageWrapup": {"objectiveMet": met, "newWords": new_words,
                               "summary": clean_text(result.summary, 240) if result else ""}}
