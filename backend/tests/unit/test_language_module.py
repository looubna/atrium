from __future__ import annotations

import re
from datetime import UTC, date, datetime
from pathlib import Path

from app.modules.language.agents.evaluator import by_layer, fake_draft
from app.modules.language.agents.tutor import TUTOR_VOICE, LanguageLiveAgentFactory, build_instruction
from app.modules.language.catalog import LANGUAGES, LEVEL_STYLE, SCENARIOS, Level, language
from app.modules.language.catalogs import LANGUAGE_COMPETENCIES
from app.modules.language.retry import competency_name
from app.modules.language.store import level_of, next_streak, review, streak_now, vocab_id
from app.platform.feedback.schemas import Category
from app.platform.transcripts.model import Segment, Transcript

LANGUAGE_TS = Path(__file__).resolve().parents[3] / "src" / "data" / "language.ts"
ICONS_TSX = Path(__file__).resolve().parents[3] / "src" / "components" / "language" / "icons.tsx"


def test_languages_and_scenarios_match_the_page() -> None:
    source = LANGUAGE_TS.read_text()
    page_langs = re.findall(r"\{ id: '([a-z]+)', name: '([^']+)', native: ", source)
    assert page_langs == [(lang.id, lang.name) for lang in LANGUAGES]
    icons = ICONS_TSX.read_text()
    for scenario in SCENARIOS:
        assert f"  {scenario.icon}: Icon" in icons  # every scene has a line icon on the page
        assert f"'{scenario.id}': '" in source  # and a who-label
    assert set(LEVEL_STYLE) == set(Level)
    assert language("xx").id == "en"  # an unknown id falls back rather than failing


def test_the_tutor_speaks_the_target_language_at_the_learners_level() -> None:
    scene = {"title": "Ordering at a café", "role": "a friendly barista", "situation": "A café.", "goal": "Order."}
    text = build_instruction(language("fr"), language("en"), Level.BEGINNER, scene, resumed=False)
    assert "Speak French throughout" in text and "Their own language is English" in text
    assert "a friendly barista" in text and "complete beginner" in text and "do not correct it out loud" in text


async def test_factory_builds_a_voice_only_conversation() -> None:
    spec = await LanguageLiveAgentFactory().build(uid="u", session_id="s", session={"context": {
        "target": "es", "native": "ar", "level": "intermediate",
        "scene": {"title": "Street food", "role": "a vendor", "situation": "A stall.", "goal": "Order."}}},
        resumed=False)
    assert spec.voice_name == TUTOR_VOICE and spec.tools == ("end_interview",) and spec.panel == ()
    assert "In Spanish" in spec.opening_message and spec.silence_duration_ms == 1800


def test_level_streak_and_cards() -> None:
    assert level_of(0) == {"level": 1, "into": 0, "of": 150} and level_of(320)["level"] == 3
    today = date(2026, 9, 24)
    assert next_streak(None, today) == {"count": 1, "lastDay": "2026-09-24"}
    assert next_streak({"count": 4, "lastDay": "2026-09-23"}, today)["count"] == 5
    assert next_streak({"count": 4, "lastDay": "2026-09-20"}, today)["count"] == 1
    assert streak_now({"count": 4, "lastDay": "2026-09-23"}, today) == 4
    assert streak_now({"count": 4, "lastDay": "2026-09-21"}, today) == 0
    now = datetime(2026, 9, 24, tzinfo=UTC)
    assert review({"box": 2}, "good", now)["box"] == 3
    assert review({"box": 2}, "again", now)["box"] == 0
    assert review({"box": 1}, "easy", now)["box"] == 3
    assert vocab_id("fr", " Je voudrais ") == vocab_id("fr", "je voudrais")


def test_names_and_fake_evaluation() -> None:
    assert competency_name("language.register") == "Politeness & tone"
    transcript = Transcript(duration_ms=4000, segments=[
        Segment(id="t1", speaker="interviewer", start_ms=0, end_ms=1000, text="Bonjour ! Qu'est-ce que vous voulez ?"),
        Segment(id="t2", speaker="candidate", start_ms=1200, end_ms=4000, text="Je veux un café au lait."),
    ])
    draft = fake_draft(transcript)
    scored = [*draft.roundScores, *draft.communicationScores]
    assert {s.competencyId for s in scored} == set(LANGUAGE_COMPETENCIES)
    assert draft.communicationScores and draft.events[0].evidenceSegmentIds == ["t2"]


def test_scores_are_filed_under_their_layer() -> None:
    transcript = Transcript(duration_ms=2000, segments=[
        Segment(id="t1", speaker="candidate", start_ms=0, end_ms=2000, text="Je veux un café."),
    ])
    good = fake_draft(transcript)
    everything = [*good.roundScores, *good.communicationScores]
    misfiled = good.model_copy(update={
        "roundScores": [], "communicationScores": everything,
        "events": [e.model_copy(update={"category": Category.ROUND}) for e in good.events],
    })
    fixed = by_layer(misfiled)
    assert {s.competencyId for s in fixed.roundScores} == {"language.grammar", "language.vocabulary",
                                                           "language.comprehension", "language.task"}
    assert {s.competencyId for s in fixed.communicationScores} == {"language.fluency", "language.pronunciation",
                                                                   "language.register"}
    assert fixed.events[0].category is Category.COMMUNICATION  # register: how it sounds


def test_a_fake_evaluation_passes_validation() -> None:
    from app.modules.language.agents.evaluator import competencies
    from app.platform.competencies.catalog import Layer
    from app.platform.feedback.validators import ValidationContext, validate_evaluation

    transcript = Transcript(duration_ms=2000, segments=[
        Segment(id="t1", speaker="candidate", start_ms=0, end_ms=2000, text="Je veux un café."),
    ])
    ctx = ValidationContext(
        run_id="r", duration_ms=2000, segments=transcript.segment_map(),
        round_competencies=frozenset(c.id for c in competencies(Layer.ROUND)),
        communication_competencies=frozenset(c.id for c in competencies(Layer.COMMUNICATION)),
    )
    evaluation, _ = validate_evaluation(by_layer(fake_draft(transcript)), ctx)
    assert evaluation.overallScore == 65


def test_every_language_being_learned_is_listed() -> None:
    from app.modules.language.api import _learning

    old = {"target": "fr", "native": "en", "level": "beginner", "goals": "Travel"}
    assert _learning(old) == {"fr": {"level": "beginner", "goals": "Travel", "native": "en"}}
    both = {**old, "target": "es", "level": "advanced", "learning": {"fr": {"level": "beginner", "goals": ""}}}
    assert set(_learning(both)) == {"fr", "es"} and _learning(None) == {}


def test_each_language_is_taught_in_its_own_language() -> None:
    from app.modules.language.api import _learning

    profile = {"target": "ko", "native": "ar", "level": "elementary",
               "learning": {"ko": {"level": "elementary", "native": "ar"}, "fr": {"level": "beginner", "native": "en"}}}
    learning = _learning(profile)
    assert learning["ko"]["native"] == "ar" and learning["fr"]["native"] == "en"


def test_tutor_mode_checks_answers_strictly_and_slow_speech_is_asked_for() -> None:
    from app.modules.language.agents.tutor import SLOW, build_lesson

    scene = {"title": "Introductions", "role": "a tutor", "situation": "Meeting people.", "goal": "Introduce yourself."}
    text = build_lesson(language("es"), language("en"), Level.BEGINNER, scene, resumed=False, slow=True)
    assert "it is NOT right" in text and 'start with "Todavía no."' not in text
    assert 'start with "Not yet."' in text and 'start with "Correct!"' in text and '"great start"' in text
    assert SLOW in text
    assert SLOW not in build_instruction(language("es"), language("en"), Level.BEGINNER, scene,
                                                   resumed=False)


async def test_factory_runs_a_lesson_when_asked() -> None:
    spec = await LanguageLiveAgentFactory().build(uid="u", session_id="s", session={"context": {
        "target": "es", "native": "en", "level": "beginner", "mode": "lesson",
        "scene": {"title": "Café", "role": "a tutor", "situation": "A café.", "goal": "Order."}}}, resumed=False)
    assert "teach the first phrase in Spanish" in spec.opening_message


def test_lesson_verdicts_are_in_the_learners_own_language() -> None:
    from app.modules.language.agents.tutor import VERDICTS, build_lesson
    from app.modules.language.catalog import LANGUAGES

    assert set(VERDICTS) == {lang.id for lang in LANGUAGES}
    scene = {"title": "Café", "role": "a tutor", "situation": "A café.", "goal": "Order."}
    text = build_lesson(language("fr"), language("ar"), Level.BEGINNER, scene, resumed=False)
    assert 'start with "ليس بعد."' in text


async def test_the_taught_language_is_pronounced_natively() -> None:
    spec = await LanguageLiveAgentFactory().build(uid="u", session_id="s", session={"context": {
        "target": "es", "native": "en", "level": "beginner", "mode": "lesson",
        "scene": {"title": "Café", "role": "a tutor", "situation": "A café.", "goal": "Order."}}}, resumed=False)
    assert spec.language_code == "es-ES"
    assert "native speaker of both English and Spanish" in spec.system_instruction
    assert "Never put a Spanish word or phrase inside a English sentence" in spec.system_instruction
