"""The Story Course (Park → Storytelling): story measurements, its steps, and its progress rules."""

from __future__ import annotations

from app.modules.practice import story
from app.modules.practice.analysis import (
    CoachDraft,
    DeliveryNote,
    coach_instruction,
    fake_coach,
    model_retelling,
    validated_feedback,
)
from app.modules.practice.catalog import DRILLS, STORY_COURSE, is_story
from app.modules.practice.progress import apply_round, overview, today_drill
from app.platform.transcripts.model import Word


def spaced(text: str, start: int = 0, step: int = 400, gaps: dict[int, int] | None = None) -> list[Word]:
    """Words every `step` ms; `gaps` adds extra silence (ms) before the word at that index."""
    out, t = [], start
    for i, token in enumerate(text.split()):
        t += (gaps or {}).get(i, 0)
        out.append(Word(text=token, start_ms=t, end_ms=t + 300))
        t += step
    return out


# A story that sets the scene first, then thinks and doubts more and more towards its climax.
GOOD = (
    "In the old house on the hill at the edge of the town under the pines by the river of our village "
    "there lived a man with a dog. "
    "He was kind and we were friends and he did help us and I went there often and we had tea. "
    "Then one night I heard a noise and I went out and it was dark and I did not see him. "
    "But I think I knew why because maybe he was afraid and I wondered if I was wrong but I was not sure. "
    "I decided I should ask him why but I thought maybe he would not tell me because he was afraid and unsure."
)
FLAT = " ".join(["and then we walked and then we ate and then we slept"] * 8)


def test_narrative_index_counts_buts_per_and() -> None:
    two_turns = "we went to the park and we saw a dog but it ran so we followed it and found the owner by the lake"
    assert story.narrative_index(spaced(two_turns)) == 100
    assert story.narrative_index(spaced(FLAT)) == 0
    assert story.narrative_index(spaced("too short but")) is None


def test_arc_profile_shows_the_shape_of_a_good_story() -> None:
    good, flat = story.arc_profile(spaced(GOOD)), story.arc_profile(spaced(FLAT))
    assert good is not None and flat is not None
    assert set(good) == {"staging", "progression", "tension"} and all(len(v) == 5 for v in good.values())
    # Scene set up front, and tension peaking late, as in Boyd et al.'s narrative arc.
    assert story.staging_early(good) is not None and story.staging_early(good) > 1.3
    assert story.tension_peak_at(good) is not None and story.tension_peak_at(good) >= 70
    assert story.tension_peak_at(flat) is None  # no tension words at all
    assert story.arc_profile(spaced("a short story")) is None


def test_hook_and_reveal_are_timed_from_the_quoted_lines() -> None:
    text = "what was in the box nobody knew for years we waited and waited until one day we opened it and it was empty"
    reveal_index = text.split().index("it", 20)  # the second "it": "it was empty"
    words = spaced(text, start=1000, gaps={reveal_index: 1200})
    assert story.hook_seconds(words, "What was in the box?") == 0.0
    assert story.reveal_at(words, "it was empty") is not None and story.reveal_at(words, "it was empty") >= 80
    assert story.pause_before_reveal(words, "it was empty") == 1.3
    assert story.hook_seconds(words, "never said") is None and story.reveal_at(words, "") is None


def test_every_story_step_is_complete() -> None:
    assert STORY_COURSE[0].id == "story-spine" and STORY_COURSE[-1].id == "story-signature"
    for drill in STORY_COURSE:
        assert is_story(drill.id) and DRILLS[drill.id] is drill
        assert drill.skills == ("storytelling",) and drill.rubric
        # Every story round is rated overall: Tell It Again improves on it.
        assert "story" in drill.ai_ratings
        timed = {"hookSeconds", "revealAt", "pauseBeforeReveal"} & {m.key for m in drill.metrics}
        assert not timed or drill.quotes, drill.id
    assert "hookQuote" in coach_instruction(DRILLS["story-curiosity"])
    assert "hookQuote" not in coach_instruction(DRILLS["think-on-your-feet"])
    assert "better line" in coach_instruction(DRILLS["story-tension"])


def test_the_fake_coach_quotes_hook_and_reveal() -> None:
    draft = fake_coach(DRILLS["story-curiosity"], "what was in the box nobody knew until we opened it")
    assert draft.hookQuote and draft.revealQuote and draft.hook == 4 and draft.story == 4


def test_story_steps_are_not_the_practice_centers_daily_drill() -> None:
    assert not any(is_story(today_drill(f"user{i}", "2026-09-25").id) for i in range(200))


def test_tell_it_again_measures_improvement_on_the_last_story() -> None:
    day = "2026-09-25"
    long = 40_000
    doc, _ = apply_round({}, DRILLS["story-curiosity"], {"hook": 4.0, "story": 3.0}, long, day, "u",
                         {"kind": "story", "seed": "the day everything changed"})
    assert overview(doc, "u", day)["story"] == {"lastSeed": "the day everything changed", "lastScore": 3.0}
    values = {"story": 4.0, "hook": 4.0, "tension": 4.0}
    doc, awards = apply_round(doc, DRILLS["story-retell"], values, long, day, "u",
                              {"kind": "story", "seed": "the day everything changed", "retell": True})
    assert values["improvement"] == 1.0
    assert awards.challenge is not None and awards.challenge["passed"]
    # A retelling is not itself the story to retell next.
    assert doc["story"]["score"] == 3.0
    # Nothing to compare with yet: no improvement, no pass.
    fresh = {"story": 5.0}
    _, awards = apply_round({}, DRILLS["story-retell"], fresh, long, day, "u", {"kind": "story", "retell": True})
    assert fresh["improvement"] is None and awards.challenge is not None and not awards.challenge["passed"]


def test_master_storyteller_needs_the_signature_story_mastered() -> None:
    state = {"level": 3, "completed": [1, 2], "passes": 2, "rounds": 9}
    doc = {"drills": {"story-signature": state}, "rulesVersion": 2}
    top = {"story": 5.0, "hook": 5.0, "tension": 5.0, "meaning": 5.0, "detail": 5.0, "pauseBeforeReveal": 1.0}
    _, awards = apply_round(doc, DRILLS["story-signature"], top, 90_000, "2026-09-25", "u", {"seed": "x"})
    assert [a["id"] for a in awards.view()["achievements"]] == ["master-storyteller"]


def test_the_coach_retells_the_users_story_with_delivery_cues() -> None:
    assert "modelVersion" in coach_instruction(DRILLS["story-spine"])
    assert "modelVersion" not in coach_instruction(DRILLS["think-on-your-feet"])
    draft = CoachDraft(
        headline="h", strengths=[], improvements=[], nextTry="n",
        modelVersion="I lifted the lid… It was empty.",
        modelWhy="Holding the answer until the last line keeps them listening.",
        deliveryNotes=[
            DeliveryNote(phrase="It was empty", cue="Pause a full second before it, then say it quietly."),
            DeliveryNote(phrase="words that are not there", cue="Stress this."),
        ],
    )
    model = model_retelling(draft)
    # Cleaned like all coach text: the ellipsis becomes three dots, which the voice pauses on just the same.
    assert model is not None and model["text"] == "I lifted the lid... It was empty."
    # A cue on words the retelling doesn't contain can't be followed, so it is dropped.
    assert [n["phrase"] for n in model["notes"]] == ["It was empty"]
    assert validated_feedback(draft, "anything")["model"] == model


def test_only_story_rounds_get_a_retelling() -> None:
    assert fake_coach(DRILLS["story-spine"], "we moved to Seoul and then").modelVersion
    plain = fake_coach(DRILLS["think-on-your-feet"], "my answer is yes")
    assert not plain.modelVersion and validated_feedback(plain, "my answer is yes")["model"] is None
