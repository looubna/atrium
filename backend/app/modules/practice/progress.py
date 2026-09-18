"""Practice Center progress: personal bests, challenge levels, one streak, XP and a few
achievements. Pure functions over the stored progress document, so the rules are easy
to test and the API applies them inside one transaction.

XP is a progress indicator, not the goal: small, capped amounts for real rounds, and
nothing for rounds too short to count.
"""

from __future__ import annotations

import copy
import hashlib
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Any

from app.modules.practice.catalog import (
    ACHIEVEMENTS,
    DRILLS,
    MAX_LEVEL,
    RULES_VERSION,
    SKILLS,
    DrillDef,
    challenge_for,
)

XP_ROUND = 10
XP_CHALLENGE = 20
XP_BEST = 10
XP_TODAY = 15
#: Rounds per day that earn round XP; practice beyond that still counts for everything else.
ROUND_XP_PER_DAY = 15
STRUCTURED_ROUNDS = 10
STRUCTURED_DRILLS = 3


def migrate(doc: dict[str, Any]) -> dict[str, Any]:
    """Progress earned under older, easier rules: keep XP, bests, rounds and streak; reset the rest."""
    if doc.get("rulesVersion") == RULES_VERSION:
        return doc
    doc = copy.deepcopy(doc)
    if doc:
        doc["achievements"] = {}
        doc["counters"] = {}
        for state in (doc.get("drills") or {}).values():
            state["level"] = 1
            state["completed"] = []
            state["passes"] = 0
    doc["rulesVersion"] = RULES_VERSION
    return doc


def _completed(doc: dict[str, Any], drill_id: str) -> list[int]:
    return list(((doc.get("drills") or {}).get(drill_id) or {}).get("completed") or [])


def level_for(xp: int) -> tuple[int, int, int]:
    """Level, XP into the level, and XP the level spans. Level L starts at 50*L*(L-1)."""
    level = 1
    while 50 * (level + 1) * level <= xp:
        level += 1
    start, end = 50 * level * (level - 1), 50 * (level + 1) * level
    return level, xp - start, end - start


def today_drill(uid: str, day: str) -> DrillDef:
    """The day's suggested challenge: stable for the day, different across users."""
    ids = sorted(DRILLS)
    digest = hashlib.sha256(f"{uid}:{day}".encode()).digest()
    return DRILLS[ids[int.from_bytes(digest[:4], "big") % len(ids)]]


def _is_better(value: float, previous: float, better: str) -> bool:
    return value > previous if better == "higher" else value < previous


@dataclass
class Awards:
    counted: bool
    xp: int = 0
    xp_parts: list[dict[str, Any]] = field(default_factory=list)
    new_bests: list[dict[str, Any]] = field(default_factory=list)
    first_results: list[str] = field(default_factory=list)
    challenge: dict[str, Any] | None = None
    today_done: bool = False
    streak_extended: bool = False
    achievements: list[str] = field(default_factory=list)

    def add(self, reason: str, amount: int) -> None:
        if amount > 0:
            self.xp += amount
            self.xp_parts.append({"reason": reason, "xp": amount})

    def view(self) -> dict[str, Any]:
        return {
            "counted": self.counted,
            "xp": self.xp,
            "xpParts": self.xp_parts,
            "newBests": self.new_bests,
            "firstResults": self.first_results,
            "challenge": self.challenge,
            "todayDone": self.today_done,
            "streakExtended": self.streak_extended,
            "achievements": [
                {"id": a.id, "title": a.title, "description": a.description}
                for a in ACHIEVEMENTS
                if a.id in self.achievements
            ],
        }


def _streak(doc: dict[str, Any], day: str) -> bool:
    streak = doc.setdefault("streak", {"current": 0, "best": 0, "lastDay": None})
    last = streak.get("lastDay")
    if last == day:
        return False
    yesterday = (date.fromisoformat(day) - timedelta(days=1)).isoformat()
    # A missed day simply starts again at 1; the best streak is kept.
    streak["current"] = streak.get("current", 0) + 1 if last == yesterday else 1
    streak["best"] = max(streak.get("best", 0), streak["current"])
    streak["lastDay"] = day
    return True


def apply_round(
    doc: dict[str, Any],
    drill: DrillDef,
    values: dict[str, float | None],
    speech_ms: int,
    day: str,
    uid: str,
) -> tuple[dict[str, Any], Awards]:
    doc = migrate(copy.deepcopy(doc) if doc else {})
    doc.setdefault("xp", 0)
    drills = doc.setdefault("drills", {})
    state = drills.setdefault(drill.id, {"level": 1, "rounds": 0, "bests": {}})
    daily = doc.get("daily") or {}
    if daily.get("day") != day:
        daily = {"day": day, "rounds": 0, "todayDone": False, "bestXpDrills": []}
    doc["daily"] = daily

    awards = Awards(counted=speech_ms >= drill.min_speech_ms)
    if not awards.counted:
        return doc, awards

    state["rounds"] = state.get("rounds", 0) + 1
    daily["rounds"] = daily.get("rounds", 0) + 1
    if daily["rounds"] <= ROUND_XP_PER_DAY:
        awards.add("Round completed", XP_ROUND)
    awards.streak_extended = _streak(doc, day)

    skills = doc.setdefault("skills", {})
    for skill in drill.skills:
        skills.setdefault(skill, {"rounds": 0})
        skills[skill]["rounds"] += 1

    # Personal bests.
    bests = state.setdefault("bests", {})
    improved = False
    for key in drill.bests:
        value = values.get(key)
        if value is None:
            continue
        better = next(m.better for m in drill.metrics if m.key == key)
        current = bests.get(key)
        if current is None:
            bests[key] = {"value": value, "previous": None, "day": day}
            awards.first_results.append(key)
        elif _is_better(value, float(current["value"]), better):
            bests[key] = {"value": value, "previous": current["value"], "day": day}
            label = next(m.label for m in drill.metrics if m.key == key)
            awards.new_bests.append({"key": key, "label": label, "value": value, "previous": current["value"]})
            improved = True
    if improved and drill.id not in daily["bestXpDrills"]:
        daily["bestXpDrills"].append(drill.id)
        awards.add("New personal best", XP_BEST)

    # The drill's challenge at its current level: higher levels need consecutive passing rounds.
    level = int(state.get("level", 1))
    challenge = challenge_for(drill, level)
    passed = challenge.check(values)
    passes = int(state.get("passes", 0)) + 1 if passed else 0
    awards.challenge = {
        "level": challenge.level,
        "label": challenge.label,
        "passed": passed,
        "repeat": challenge.repeat,
        "passes": min(passes, challenge.repeat),
    }
    counters = doc.setdefault("counters", {})
    if passed and passes >= challenge.repeat:
        awards.challenge["completed"] = True
        awards.add(f"Level {challenge.level} complete", XP_CHALLENGE * challenge.level)
        completed = state.setdefault("completed", [])
        if challenge.level not in completed:
            completed.append(challenge.level)
        passes = 0
        if level < MAX_LEVEL:
            state["level"] = level + 1
            awards.challenge["unlocked"] = level + 1
        else:
            awards.challenge["mastered"] = True
    state["passes"] = passes
    if passed and drill.id == today_drill(uid, day).id and not daily["todayDone"]:
        daily["todayDone"] = True
        awards.today_done = True
        awards.add("Today's challenge", XP_TODAY)

    # Achievements: real mastery in the drills that train the skill.
    if (values.get("structure") or 0) >= 4:
        counters["structured"] = counters.get("structured", 0) + 1
        seen = counters.setdefault("structuredDrills", [])
        if drill.id not in seen:
            seen.append(drill.id)
    earned = doc.setdefault("achievements", {})
    unlocked = {
        "quick-thinker": 2 in _completed(doc, "think-on-your-feet"),
        "think-under-pressure": 3 in _completed(doc, "think-on-your-feet"),
        "master-of-the-pause": 3 in _completed(doc, "pause-dont-fill"),
        "clear-speaker": 3 in _completed(doc, "clear-diction") and 2 in _completed(doc, "explain-it-simply"),
        "structured-mind": 2 in _completed(doc, "framework-challenge")
        and counters.get("structured", 0) >= STRUCTURED_ROUNDS
        and len(counters.get("structuredDrills", [])) >= STRUCTURED_DRILLS,
    }
    for achievement_id, reached in unlocked.items():
        if reached and achievement_id not in earned:
            earned[achievement_id] = day
            awards.achievements.append(achievement_id)

    doc["xp"] = int(doc["xp"]) + awards.xp
    return doc, awards


def overview(doc: dict[str, Any] | None, uid: str, day: str) -> dict[str, Any]:
    """Everything the Practice Center shows, with the catalog merged in."""
    doc = migrate(doc or {})
    xp = int(doc.get("xp", 0))
    level, into, span = level_for(xp)
    streak = doc.get("streak") or {}
    yesterday = (date.fromisoformat(day) - timedelta(days=1)).isoformat()
    alive = streak.get("lastDay") in (day, yesterday)
    daily = doc.get("daily") or {}
    drills_state = doc.get("drills") or {}
    today = today_drill(uid, day)
    today_level = int((drills_state.get(today.id) or {}).get("level", 1))

    drills: dict[str, Any] = {}
    for drill in DRILLS.values():
        state = drills_state.get(drill.id) or {}
        level_now = int(state.get("level", 1))
        completed = state.get("completed") or []
        challenge = challenge_for(drill, level_now)
        drills[drill.id] = {
            "title": drill.title,
            "skills": [{"id": s, "label": SKILLS[s]} for s in drill.skills],
            "rounds": int(state.get("rounds", 0)),
            "level": level_now,
            "mastered": MAX_LEVEL in completed,
            "challenge": {
                "level": challenge.level,
                "label": challenge.label,
                "repeat": challenge.repeat,
                "passes": int(state.get("passes", 0)),
            },
            "challenges": [
                {"level": c.level, "label": c.label, "repeat": c.repeat, "done": c.level in completed}
                for c in drill.challenges
            ],
            "bests": [
                {
                    "key": m.key,
                    "label": m.label,
                    "unit": m.unit,
                    "better": m.better,
                    "source": m.source,
                    "value": (state.get("bests") or {}).get(m.key, {}).get("value"),
                    "previous": (state.get("bests") or {}).get(m.key, {}).get("previous"),
                }
                for m in drill.metrics
                if m.key in drill.bests
            ],
        }

    earned = doc.get("achievements") or {}
    skills = doc.get("skills") or {}
    return {
        "xp": xp,
        "level": level,
        "levelXp": into,
        "levelSpan": span,
        "streak": {
            "current": int(streak.get("current", 0)) if alive else 0,
            "best": int(streak.get("best", 0)),
            "practicedToday": streak.get("lastDay") == day,
        },
        "today": {
            "drillId": today.id,
            "title": today.title,
            "level": challenge_for(today, today_level).level,
            "label": challenge_for(today, today_level).label,
            "done": bool(daily.get("day") == day and daily.get("todayDone")),
        },
        "achievements": [
            {"id": a.id, "title": a.title, "description": a.description, "earnedOn": earned.get(a.id)}
            for a in ACHIEVEMENTS
        ],
        # Rounds trained per skill. Skill scores come later, once there is enough evidence.
        "skills": [
            {"id": s, "label": label, "rounds": int((skills.get(s) or {}).get("rounds", 0))}
            for s, label in SKILLS.items()
        ],
        "drills": drills,
    }
