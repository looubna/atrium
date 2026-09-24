"""The learner's Language Center state: profile, plan, progress and vocabulary.

    users/{uid}/language/profile    what they learn, their own language, level and goals
    users/{uid}/languagePlans/{id}  one plan per language they learn: chapters of objectives
    users/{uid}/language/progress   XP (for the level), the day streak and the history
    users/{uid}/languageVocab/{id}  words and phrases met in conversations, for the vocab coach

The vocab coach is a small spaced-repetition box system: a card answered well moves up a box and
comes back later; one missed goes back to the first box and comes back tomorrow.
"""

from __future__ import annotations

import hashlib
from datetime import UTC, date, datetime, timedelta
from typing import Any

from app.platform.clients import clients
from app.platform.firestore.paths import UserPaths

#: Days until a card in each box is due again.
BOX_DAYS = (0, 1, 3, 7, 16, 35)
#: XP per finished conversation, per objective completed, per card reviewed. A level every LEVEL_XP.
XP_SESSION, XP_OBJECTIVE, XP_REVIEW = 20, 30, 2
LEVEL_XP = 150
MAX_HISTORY = 60


def _base(uid: str) -> str:
    return f"{UserPaths(uid).user()}/language"


def profile_ref(uid: str):
    return clients.firestore().document(f"{_base(uid)}/profile")


def plan_ref(uid: str, target: str):
    return clients.firestore().document(f"{UserPaths(uid).user()}/languagePlans/{target}")


async def read_plan(uid: str, target: str) -> dict[str, Any]:
    """The plan for this language; the single plan written before there was one per language."""
    plan = (await plan_ref(uid, target).get()).to_dict()
    if plan:
        return plan
    legacy = (await clients.firestore().document(f"{_base(uid)}/plan").get()).to_dict() or {}
    return legacy if legacy.get("target") == target else {}


def progress_ref(uid: str):
    return clients.firestore().document(f"{_base(uid)}/progress")


def vocab_col(uid: str):
    return clients.firestore().collection(f"{UserPaths(uid).user()}/languageVocab")


def level_of(xp: int) -> dict[str, int]:
    """The level, and how far into it: 0..LEVEL_XP."""
    return {"level": 1 + xp // LEVEL_XP, "into": xp % LEVEL_XP, "of": LEVEL_XP}


def next_streak(streak: dict[str, Any] | None, today: date) -> dict[str, Any]:
    """The day streak after activity today: kept going from yesterday, restarted after a gap."""
    streak = streak or {}
    last = streak.get("lastDay")
    count = int(streak.get("count", 0))
    if last == today.isoformat():
        return {"count": max(count, 1), "lastDay": last}
    if last == (today - timedelta(days=1)).isoformat():
        return {"count": count + 1, "lastDay": today.isoformat()}
    return {"count": 1, "lastDay": today.isoformat()}


def streak_now(streak: dict[str, Any] | None, today: date) -> int:
    """The streak as shown today: still alive if the last activity was today or yesterday."""
    streak = streak or {}
    last = streak.get("lastDay")
    if last in (today.isoformat(), (today - timedelta(days=1)).isoformat()):
        return int(streak.get("count", 0))
    return 0


def review(card: dict[str, Any], grade: str, now: datetime) -> dict[str, Any]:
    """A card after an answer: `again` back to the first box, `good` up one, `easy` up two."""
    box = int(card.get("box", 0))
    box = 0 if grade == "again" else min(len(BOX_DAYS) - 1, box + (2 if grade == "easy" else 1))
    due = now + timedelta(days=BOX_DAYS[box] if grade != "again" else 1)
    return {"box": box, "due": due, "reviews": int(card.get("reviews", 0)) + 1, "lastGrade": grade}


def vocab_id(target: str, term: str) -> str:
    """One card per word or phrase per language, whichever conversation it came from."""
    return hashlib.sha256(f"{target}:{term.strip().lower()}".encode()).hexdigest()[:20]


async def add_progress(uid: str, *, xp: int, entry: dict[str, Any] | None = None) -> None:
    """XP, today's streak and (for a conversation) a history entry, in one write."""
    ref = progress_ref(uid)
    snap = await ref.get()
    data = snap.to_dict() or {}
    history = list(data.get("history") or [])
    if entry:
        history = [entry, *[h for h in history if h.get("sessionId") != entry.get("sessionId")]][:MAX_HISTORY]
    await ref.set({
        "xp": int(data.get("xp", 0)) + xp,
        "streak": next_streak(data.get("streak"), datetime.now(UTC).date()),
        "history": history,
        "updatedAt": datetime.now(UTC),
    })
