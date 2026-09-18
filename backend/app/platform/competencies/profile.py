"""The user's competency profile across sessions.

Each evaluated session writes one history entry per competency with a
deterministic ID (`{sessionId}_{competencyId}`), so re-processing a session
replaces its entries instead of adding more. The profile document for each
competency is then recomputed from the most recent history, which makes the
result independent of the order in which sessions were processed.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from google.cloud import firestore
from google.cloud.firestore_v1.base_query import FieldFilter

from app.platform.clients import clients
from app.platform.feedback.schemas import CompetencyScore, Confidence
from app.platform.firestore.paths import UserPaths

WINDOW = 5
HISTORY_FETCH = 50
CONFIDENCE_WEIGHT = {Confidence.HIGH.value: 1.0, Confidence.MEDIUM.value: 0.7, Confidence.LOW.value: 0.35}


@dataclass(frozen=True)
class Delta:
    competency_id: str
    score: int
    previous: int | None
    delta: int | None


def weighted_current(entries: list[dict[str, Any]]) -> int:
    recent = entries[:WINDOW]
    weights = [CONFIDENCE_WEIGHT.get(str(e.get("confidence")), 0.35) for e in recent]
    total = sum(weights)
    if not total:
        return 0
    return round(sum(int(e["score"]) * w for e, w in zip(recent, weights, strict=True)) / total)


def pick_previous(entries: list[dict[str, Any]], session_id: str, context: dict[str, Any]) -> dict[str, Any] | None:
    """Prefer the same application and round; otherwise the latest comparable attempt."""
    comparable = [
        e for e in entries if e.get("sessionId") != session_id and e.get("confidence") != Confidence.LOW.value
    ]
    same_round = [
        e
        for e in comparable
        if context.get("roundId")
        and (e.get("context") or {}).get("roundId") == context.get("roundId")
        and (e.get("context") or {}).get("applicationId") == context.get("applicationId")
    ]
    choices = same_round or comparable
    return choices[0] if choices else None


async def apply_scores(
    *,
    uid: str,
    session_id: str,
    module: str,
    context: dict[str, Any],
    scores: list[CompetencyScore],
    catalog_version: str,
    session_at: datetime,
) -> list[Delta]:
    db = clients.firestore()
    paths = UserPaths(uid)
    history = db.collection(paths.competency_history())
    round_context = {k: context.get(k) for k in ("applicationId", "roundId", "roundType", "practice")}

    batch = db.batch()
    for score in scores:
        batch.set(
            history.document(f"{session_id}_{score.competencyId}"),
            {
                "competencyId": score.competencyId,
                "layer": score.category.value,
                "module": module,
                "score": score.score,
                "confidence": score.confidence.value,
                "sessionId": session_id,
                "context": round_context,
                "catalogVersion": catalog_version,
                "at": session_at,
            },
        )
    await batch.commit()

    deltas: list[Delta] = []
    for score in scores:
        query = (
            history.where(filter=FieldFilter("competencyId", "==", score.competencyId))
            .order_by("at", direction=firestore.Query.DESCENDING)
            .limit(HISTORY_FETCH)
        )
        entries = [
            data
            async for snap in query.stream()
            if (data := snap.to_dict() or {}).get("catalogVersion") == catalog_version
        ]
        previous = pick_previous(entries, session_id, round_context)
        delta = None
        if previous is not None and score.confidence is not Confidence.LOW:
            delta = score.score - int(previous["score"])
        await db.document(paths.competency(score.competencyId)).set(
            {
                "layer": score.category.value,
                "module": module,
                "catalogVersion": catalog_version,
                "current": weighted_current(entries),
                "best": max(int(e["score"]) for e in entries) if entries else score.score,
                "attempts": len(entries),
                "lastScore": score.score,
                "lastDelta": delta,
                "lastSessionId": session_id,
                "updatedAt": datetime.now(UTC),
            }
        )
        deltas.append(Delta(score.competencyId, score.score, int(previous["score"]) if previous else None, delta))
    return deltas
