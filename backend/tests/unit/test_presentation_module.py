from __future__ import annotations

import base64

from app.modules.presentation.agents.evaluator import fake_draft
from app.modules.presentation.agents.room import PresentationLiveAgentFactory, build_instruction, release_note
from app.modules.presentation.api import CALL_TILES, FACES, Material, read_material
from app.modules.presentation.audience import AUDIENCE, Format, Plan, Questions, briefing, fallback, plan_of
from app.modules.presentation.catalogs import PRESENTATION_COMPETENCIES
from app.modules.presentation.retry import competency_name
from app.platform.agents.live_gateway import LiveState, invites_questions
from app.platform.agents.live_protocol import Release, parse_control
from app.platform.competencies.catalog import COMMUNICATION
from app.platform.transcripts.model import Segment, Transcript


def _plan() -> Plan:
    from app.modules.presentation.world import AudienceDraft, PersonDraft, plan_from_draft

    draft = AudienceDraft(
        title="Orbit launch plan", audience="The leadership team of Northwind.", expects="A decision on the date.",
        opening="Robert welcomes the speaker.", success="A clear recommendation, defended calmly.",
        people=[PersonDraft(key="robert", role="CEO", stance="Wants to know the cost of a slip."),
                PersonDraft(key="priya", role="CFO", stance="Doubts the €22,000 estimate on slide 3."),
                PersonDraft(key="kevin", role="CTO", stance="Asks about the 3 critical findings.")],
        tips=["Say the €22,000 figure out loud on slide 3."],
    )
    return plan_from_draft("Orbit", draft)


def test_people_and_faces() -> None:
    assert len({p.voice for p in AUDIENCE}) == len(AUDIENCE)
    assert set(CALL_TILES) == {p.key for p in AUDIENCE}
    # Every format has faces; the auditorium's are three people in its front row.
    assert set(FACES) == set(Format) and FACES[Format.LARGE_AUDIENCE] == "theater_strip2x"


def test_a_written_audience_round_trips_and_briefs_without_stances() -> None:
    plan = _plan()
    assert plan.people()[1].role == "CFO" and plan.tips == ("Say the €22,000 figure out loud on slide 3.",)
    assert Plan.from_doc(plan.to_doc()) == plan
    brief = briefing({"format": "virtual", "questions": "slides", "plan": plan.to_doc()})
    assert brief["title"] == "Orbit launch plan" and brief["tips"] and "Doubts the €22,000" not in str(brief)
    assert "about your slides" in brief["format"] and "any questions" not in brief["format"]
    assert plan_of({}).title == fallback("").title


def test_instruction_keeps_the_audience_silent_until_questions() -> None:
    text = build_instruction(_plan(), fmt=Format.LARGE_AUDIENCE, questions=Questions.TALK, deck="Slide 3: €22,000",
                             resumed=False)
    assert "say only \"Mm.\"" in text and "Never ask a question, comment or interrupt during the talk" in text
    assert "auditorium" in text and "Slide 3: €22,000" in text and "ONE question per turn" in text
    assert "never say \"Mm.\" again" in text and "ONE short sentence asking ONE thing" in text
    assert "did not hear the talk" in release_note(Questions.SLIDES)


async def test_factory_holds_the_floor() -> None:
    factory = PresentationLiveAgentFactory()
    talk = await factory.build(uid="u", session_id="s", session={"context": {
        "format": "small-room", "questions": "talk", "plan": _plan().to_doc()}}, resumed=False)
    assert talk.hold_floor and talk.hears_while_held and "happy to take your questions" in talk.release_note
    assert talk.one_question_per_turn and talk.silence_duration_ms == 1600
    assert "Never interrupt an answer" in talk.system_instruction
    assert [m.name for m in talk.panel] == ["Priya Raman", "Kevin Zhou"]
    slides = await factory.build(uid="u", session_id="s", session={"context": {"questions": "slides"}},
                                 resumed=False)
    assert slides.hold_floor and not slides.hears_while_held


def test_slides_are_read() -> None:
    text = "Orbit launch. Option B saves 22,000 euros and keeps 31 October. " * 5
    assert "Option B" in read_material(Material(name="deck.txt", data=base64.b64encode(text.encode()).decode()))


def test_the_floor_is_handed_over_by_the_page_or_by_asking() -> None:
    # The page's button.
    assert isinstance(parse_control('{"type": "release"}'), Release)
    # The words.
    for said in ("Any questions?", "I'm happy to take your questions.", "Questions?", "Let's open it up to questions"):
        assert invites_questions(said), said
    for said in ("The question is whether we launch.", "We had questions from finance last week"):
        assert not invites_questions(said), said
    # A reconnect keeps the Q&A going rather than silencing the audience again.
    state = LiveState(uid="u", released=True)
    assert LiveState.from_doc("u", state.to_doc()).released
    assert not LiveState.from_doc("u", {}).released


def test_names_and_fake_evaluation() -> None:
    assert competency_name("presentation.qa") == "Handling questions"
    transcript = Transcript(duration_ms=4000, segments=[
        Segment(id="s1", speaker="interviewer", start_ms=0, end_ms=1000, text="Welcome, the floor is yours."),
        Segment(id="s2", speaker="candidate", start_ms=1200, end_ms=4000, text="Thanks. Today I want to show..."),
    ])
    draft = fake_draft(transcript, frozenset(COMMUNICATION))
    assert {s.competencyId for s in draft.roundScores} == set(PRESENTATION_COMPETENCIES)
