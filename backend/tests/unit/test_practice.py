"""Practice Center rules: measurements, personal bests, challenges, streak, XP, achievements."""

from __future__ import annotations

from typing import Any

from app.modules.practice.analysis import (
    clean_pause_seconds,
    diction_accuracy,
    reading_pace,
    side_balance,
    skill_evidence,
    story_words_used,
    time_to_first_word,
)
from app.modules.practice.catalog import AI_RATINGS, DRILLS, MAX_LEVEL, SKILLS
from app.modules.practice.progress import (
    ROUND_XP_PER_DAY,
    apply_round,
    level_for,
    overview,
    today_drill,
)
from app.platform.transcripts.model import Word

TOYF = DRILLS["think-on-your-feet"]
PAUSE = DRILLS["pause-dont-fill"]


def words(*spec: tuple[str, int, int]) -> list[Word]:
    return [Word(text=t, start_ms=s, end_ms=e) for t, s, e in spec]


def spaced(text: str, start: int = 0, step: int = 400) -> list[Word]:
    return [Word(text=t, start_ms=start + i * step, end_ms=start + i * step + 300) for i, t in enumerate(text.split())]


# -- catalog --------------------------------------------------------------------


def test_every_drill_is_complete_and_consistent() -> None:
    assert len(DRILLS) == 13
    for drill in DRILLS.values():
        keys = {m.key for m in drill.metrics}
        assert drill.skills and all(s in SKILLS for s in drill.skills), drill.id
        assert [c.level for c in drill.challenges] == list(range(1, MAX_LEVEL + 1)), drill.id
        assert drill.bests and set(drill.bests) <= keys, drill.id
        assert set(drill.ai_ratings) <= set(AI_RATINGS), drill.id
        # An AI metric shown for a drill must be one the coach is asked to rate.
        assert all(m.key in drill.ai_ratings for m in drill.metrics if m.source == "ai"), drill.id
        assert len({c.label for c in drill.challenges}) == MAX_LEVEL
        assert [c.repeat for c in drill.challenges] == [1, 2, 3], drill.id


# -- measurements -----------------------------------------------------------------


def test_response_time_and_clean_pause() -> None:
    w = words(("So", 2400, 2600), ("um", 2700, 2900), ("first", 5000, 5300), ("we", 5400, 5500),
              ("plan", 7500, 7800), ("then", 20_000, 20_200))
    assert time_to_first_word(w) == 2.4
    # 2.1 s after "um" doesn't count; 2.0 s between "we" and "plan" does; 12 s is dead air.
    assert clean_pause_seconds(w) == 2.0
    assert time_to_first_word([]) is None


def test_reading_pace_band_and_spread() -> None:
    steady = spaced(" ".join(["word"] * 60), step=400)  # 150 wpm
    reading, wpm, gap, spread = reading_pace(steady)
    assert wpm is not None and 145 <= wpm <= 155 and gap == 0
    assert spread is not None and spread <= 5
    rushed = spaced(" ".join(["word"] * 60), step=250)  # 240 wpm
    assert reading_pace(rushed)[2] and reading_pace(rushed)[2] > 60
    assert reading_pace(spaced("too short"))[0] is None
    assert reading is not None and reading > 20


def test_diction_accuracy_follows_the_passage() -> None:
    passage = "I tested the product, collected the results, and presented the key findings."
    perfect = spaced("Red lorry yellow lorry I tested the product collected the results and presented the key findings")
    mumbled = spaced("I tested the collected results and the findings")
    assert diction_accuracy(passage, perfect) == 100
    assert diction_accuracy(passage, mumbled) is not None and diction_accuracy(passage, mumbled) < 70
    assert diction_accuracy(passage, []) is None


def test_story_words_and_side_balance() -> None:
    heard = spaced("the umbrellas were near the volcano and nobody cared")
    assert story_words_used(["umbrella", "volcano", "passport"], heard) == 2
    for_side = [Word(text="x", start_ms=i * 1000, end_ms=i * 1000 + 300) for i in range(50)]
    against = [Word(text="y", start_ms=60_000 + i * 1000, end_ms=60_000 + i * 1000 + 300) for i in range(40)]
    assert side_balance(for_side + against, 120) == 80
    assert side_balance([], 120) is None


def test_skill_evidence_is_labelled_by_source() -> None:
    evidence = skill_evidence(TOYF, {"responseSeconds": 3.0, "structure": 5.0, "fillers": 0.0}, 1.0)
    assert evidence["spontaneity"] == {"value": 1.0, "source": "measured"}
    assert evidence["structure"]["source"] == "ai"
    assert set(evidence) <= set(TOYF.skills)


# -- progress -------------------------------------------------------------------


def toyf(response: float, structure: float, fillers: float = 1.0, speaking: float = 40.0) -> dict[str, float | None]:
    return {"responseSeconds": response, "structure": structure, "fillers": fillers, "speakingSeconds": speaking}


def test_short_rounds_earn_nothing() -> None:
    doc, awards = apply_round({}, PAUSE, {"fillers": 0.0, "speakingSeconds": 5.0}, 5_000, "2026-09-17", "alice")
    assert not awards.counted and awards.xp == 0
    assert "streak" not in doc and doc.get("xp") == 0


def test_first_result_then_personal_best_with_direction() -> None:
    doc, first = apply_round({}, TOYF, toyf(9, 3), 30_000, "2026-09-17", "alice")
    assert set(first.first_results) == {"responseSeconds", "fillers", "structure"}
    assert not first.new_bests
    doc, better = apply_round(doc, TOYF, toyf(6, 3, fillers=3), 30_000, "2026-09-17", "alice")
    # Faster is better; more fillers is not.
    assert [b["key"] for b in better.new_bests] == ["responseSeconds"]
    assert better.new_bests[0]["previous"] == 9
    assert doc["drills"][TOYF.id]["bests"]["fillers"]["value"] == 1.0
    # Best XP at most once per drill per day.
    doc, again = apply_round(doc, TOYF, toyf(5, 3), 30_000, "2026-09-17", "alice")
    assert again.new_bests and not any(p["reason"] == "New personal best" for p in again.xp_parts)


def test_finishing_a_round_is_not_enough_to_pass() -> None:
    # Fast, but a weak structure, too many fillers or too little speech: level 1 stays open.
    for values in (toyf(3, 3), toyf(3, 5, fillers=3), toyf(3, 5, speaking=20)):
        _, awards = apply_round({}, TOYF, values, 30_000, "2026-09-17", "alice")
        assert awards.challenge and not awards.challenge["passed"], values
    # Easy drills don't pass by default either: reading with no fillers is not a pace challenge.
    _, diction = apply_round({}, DRILLS["clear-diction"], {"dictionAccuracy": 90.0, "wpm": 150.0}, 40_000,
                             "2026-09-17", "alice")
    assert diction.challenge and not diction.challenge["passed"]


def test_higher_levels_need_consecutive_passing_rounds() -> None:
    doc: dict[str, Any] = {}
    doc, a1 = apply_round(doc, TOYF, toyf(10, 4, fillers=2), 30_000, "2026-09-17", "alice")
    assert a1.challenge and a1.challenge["completed"] and a1.challenge["unlocked"] == 2
    # Level 2 needs two passing rounds in a row; a miss in between starts the count again.
    doc, a2 = apply_round(doc, TOYF, toyf(7, 4, fillers=1), 30_000, "2026-09-17", "alice")
    assert a2.challenge and a2.challenge["passed"] and a2.challenge["passes"] == 1 and "completed" not in a2.challenge
    doc, miss = apply_round(doc, TOYF, toyf(9, 4, fillers=1), 30_000, "2026-09-17", "alice")
    assert miss.challenge and not miss.challenge["passed"] and doc["drills"][TOYF.id]["passes"] == 0
    doc, _ = apply_round(doc, TOYF, toyf(7, 4, fillers=1), 30_000, "2026-09-17", "alice")
    doc, done = apply_round(doc, TOYF, toyf(7, 5, fillers=0), 30_000, "2026-09-17", "alice")
    assert done.challenge and done.challenge["completed"] and doc["drills"][TOYF.id]["level"] == 3
    assert "quick-thinker" in done.achievements
    assert any(p["reason"] == "Level 2 complete" and p["xp"] == 40 for p in done.xp_parts)
    # Level 3: three flawless, fast rounds in a row.
    for _ in range(2):
        doc, awards = apply_round(doc, TOYF, toyf(4, 5, fillers=0, speaking=50), 50_000, "2026-09-17", "alice")
        assert "think-under-pressure" not in awards.achievements
    doc, final = apply_round(doc, TOYF, toyf(4, 5, fillers=0, speaking=50), 50_000, "2026-09-17", "alice")
    assert final.challenge and final.challenge["mastered"]
    assert "think-under-pressure" in final.achievements


def test_streak_counts_days_and_resets_quietly() -> None:
    doc: dict[str, Any] = {}
    for day in ("2026-09-15", "2026-09-16", "2026-09-16", "2026-09-17"):
        doc, _ = apply_round(doc, PAUSE, {"fillers": 2.0, "speakingSeconds": 45.0}, 45_000, day, "alice")
    assert doc["streak"] == {"current": 3, "best": 3, "lastDay": "2026-09-17"}
    doc, awards = apply_round(doc, PAUSE, {"fillers": 2.0, "speakingSeconds": 45.0}, 45_000, "2026-09-20", "alice")
    assert doc["streak"] == {"current": 1, "best": 3, "lastDay": "2026-09-20"} and awards.streak_extended
    # The overview shows a lapsed streak as 0, and keeps the best.
    view = overview(doc, "alice", "2026-09-25")
    assert view["streak"] == {"current": 0, "best": 3, "practicedToday": False}


def test_round_xp_is_capped_per_day() -> None:
    doc: dict[str, Any] = {}
    for _ in range(ROUND_XP_PER_DAY + 3):
        doc, awards = apply_round(doc, PAUSE, {"fillers": 9.0, "speakingSeconds": 45.0}, 45_000, "2026-09-17", "a")
    assert not any(p["reason"] == "Round completed" for p in awards.xp_parts)
    assert doc["drills"][PAUSE.id]["rounds"] == ROUND_XP_PER_DAY + 3


def test_todays_challenge_bonus_once() -> None:
    day = "2026-09-17"
    drill = today_drill("alice", day)
    assert today_drill("alice", day) is drill
    values: dict[str, float | None] = {
        "speakingSeconds": 120.0, "wordsUsed": 3.0, "bothSides": 1.0, "structure": 5.0, "clarity": 5.0,
        "conciseness": 5.0, "detail": 5.0, "paceSpread": 0.0, "paceGap": 0.0, "wpm": 145.0, "fillers": 0.0,
        "responseSeconds": 1.0, "cleanPauseSeconds": 2.0, "dictionAccuracy": 100.0, "pitchSemitones": 5.0,
        "endDropDb": 0.0, "eyeContactPct": 100.0, "factsRecalled": 100.0, "stepsCovered": 100.0, "sideBalance": 100.0,
    }
    doc, first = apply_round({}, drill, values, 120_000, day, "alice")
    doc, second = apply_round(doc, drill, values, 120_000, day, "alice")
    assert first.challenge and first.challenge["passed"]
    assert first.today_done and not second.today_done
    assert overview(doc, "alice", day)["today"]["done"]


def test_master_of_the_pause_only_from_its_own_drill() -> None:
    clean = {"fillers": 0.0, "speakingSeconds": 60.0, "cleanPauseSeconds": 1.5, "clarity": 5.0,
             "dictionAccuracy": 99.0, "wpm": 140.0}
    # A flawless reading in another drill earns nothing of the kind.
    doc, diction = apply_round({}, DRILLS["clear-diction"], clean, 60_000, "2026-09-17", "alice")
    assert "master-of-the-pause" not in diction.achievements
    earned: list[str] = []
    for _ in range(1 + 2 + 3):  # level 1 once, level 2 twice, level 3 three times
        doc, awards = apply_round(doc, PAUSE, clean, 60_000, "2026-09-17", "alice")
        earned += awards.achievements
    assert earned == ["master-of-the-pause"]


def test_progress_from_older_rules_is_reset_but_xp_and_bests_stay() -> None:
    old = {
        "xp": 120,
        "streak": {"current": 2, "best": 2, "lastDay": "2026-09-16"},
        "achievements": {"master-of-the-pause": "2026-09-16"},
        "counters": {"quickThinker": 3},
        "drills": {TOYF.id: {"level": 3, "completed": [1, 2], "rounds": 4, "bests": {"fillers": {"value": 0}}}},
    }
    view = overview(old, "alice", "2026-09-17")
    assert view["xp"] == 120 and view["streak"]["current"] == 2
    assert all(a["earnedOn"] is None for a in view["achievements"])
    assert view["drills"][TOYF.id]["level"] == 1 and view["drills"][TOYF.id]["rounds"] == 4
    doc, _ = apply_round(old, PAUSE, {"fillers": 9.0, "speakingSeconds": 45.0}, 45_000, "2026-09-17", "alice")
    assert doc["achievements"] == {} and doc["drills"][TOYF.id]["bests"]["fillers"]["value"] == 0


def test_levels() -> None:
    assert level_for(0) == (1, 0, 100)
    assert level_for(100) == (2, 0, 200)
    assert level_for(350) == (3, 50, 300)


def test_overview_merges_the_catalog() -> None:
    view = overview(None, "alice", "2026-09-17")
    assert view["level"] == 1 and view["streak"]["current"] == 0
    assert set(view["drills"]) == set(DRILLS)
    toyf_view = view["drills"][TOYF.id]
    assert toyf_view["challenge"]["level"] == 1 and len(toyf_view["challenges"]) == 3
    assert [c["repeat"] for c in toyf_view["challenges"]] == [1, 2, 3]
    assert [s["label"] for s in toyf_view["skills"]] == ["Spontaneity", "Composure", "Structure"]
    assert {b["source"] for b in toyf_view["bests"]} == {"measured", "ai"}
    assert len(view["achievements"]) == 5 and len(view["skills"]) == 8
