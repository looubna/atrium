from __future__ import annotations

import re
from pathlib import Path

import pytest

from app.core.errors import NotFound
from app.modules.emotional.agents.evaluator import fake_draft
from app.modules.emotional.agents.partner import EmotionalLiveAgentFactory, build_instruction
from app.modules.emotional.api import _created
from app.modules.emotional.catalogs import EMOTIONAL_COMPETENCIES, SCENARIO_COMPETENCIES, competencies
from app.modules.emotional.partners import PARTNERS, SCENARIOS, partner_for, scenario_for
from app.modules.emotional.retry import competency_name
from app.platform.competencies.catalog import COMMUNICATION
from app.platform.transcripts.model import Segment, Transcript

FRONTEND_PRACTICE = Path(__file__).resolve().parents[3] / "src" / "data" / "practice.ts"
PARK_MEDIA = Path(__file__).resolve().parents[3] / "public" / "video" / "park"


def test_partners_and_scenarios_match_the_page() -> None:
    """The setup offers exactly the people and conversations the server can play."""
    source = FRONTEND_PRACTICE.read_text()
    partners = re.search(r"export type EmotionalPartner = (.+)", source)
    assert partners and set(re.findall(r"'([^']+)'", partners.group(1))) == set(PARTNERS)
    block = source[source.index("export const EMOTIONAL_SCENARIOS"):]
    block = block[: block.index("]\n")]
    page = dict(re.findall(r"id: '([^']+)', label: '([^']+)'", block))
    assert page == {s.id: s.label for s in SCENARIOS.values()}


def test_every_partner_has_a_voice_and_a_face_per_orientation() -> None:
    assert len({p.voice for p in PARTNERS.values()}) == len(PARTNERS)
    assert partner_for("woman").face(True) == "pk_woman2_land"
    assert partner_for("man").face(False) == "pk_man4_port"
    assert partner_for("nobody") is None
    # The page shows the face's own mouth-shut cut underneath the stream.
    for p in PARTNERS.values():
        for orientation in ("land", "port"):
            assert (PARK_MEDIA / f"{p.id}_{orientation}_face.mp4").exists()


def test_instruction_plays_a_friend_not_a_coach() -> None:
    text = build_instruction(PARTNERS["woman"], SCENARIOS["apologise"], resumed=False)
    assert "Nora" in text and SCENARIOS["apologise"].situation in text
    assert "not an assistant, a therapist or a coach" in text
    assert "end_interview" in text
    assert "Do not raise the subject yourself" in text


def test_the_upset_friend_opens_and_resume_does_not_greet() -> None:
    assert "something is wrong" in build_instruction(PARTNERS["man"], SCENARIOS["comfort"], resumed=False)
    assert "do not greet again" in build_instruction(PARTNERS["man"], SCENARIOS["comfort"], resumed=True)


async def test_factory_builds_the_friend() -> None:
    spec = await EmotionalLiveAgentFactory().build(
        uid="u", session_id="s", session={"context": {"partner": "man", "scenario": "boundary"}}, resumed=False
    )
    assert spec.voice_name == PARTNERS["man"].voice
    assert spec.lead_name == "Sam"
    assert spec.may_end_early
    with pytest.raises(NotFound):
        await EmotionalLiveAgentFactory().build(
            uid="u", session_id="s", session={"context": {"partner": "man"}}, resumed=False
        )


def test_competency_names_and_fake_evaluation() -> None:
    assert competency_name("emotional.ownership") == "Ownership"
    assert scenario_for("comfort") is SCENARIOS["comfort"]
    transcript = Transcript(duration_ms=4000, segments=[
        Segment(id="s1", speaker="interviewer", start_ms=0, end_ms=1000, text="Hey, good to see you."),
        Segment(id="s2", speaker="candidate", start_ms=1200, end_ms=4000, text="I wanted to say sorry about Saturday."),
    ])
    draft = fake_draft(transcript, frozenset(COMMUNICATION), "apologise")
    assert {s.competencyId for s in draft.roundScores} == {c.id for c in SCENARIO_COMPETENCIES["apologise"]}
    assert draft.events[0].competencyId.startswith("emotional.apologise.")
    assert draft.events[0].evidenceSegmentIds == ["s2"]


def test_every_situation_trains_its_own_skills() -> None:
    """Each situation has its skills, a goal, three tips and pushbacks that test the skill."""
    assert set(SCENARIO_COMPETENCIES) == set(SCENARIOS)
    for s in SCENARIOS.values():
        skills = competencies(s.id)
        assert 4 <= len(skills) <= 6 and all(c.id.startswith(f"emotional.{s.id}.") for c in skills)
        assert all(c.id in EMOTIONAL_COMPETENCIES for c in skills)
        assert s.goal and len(s.tips) == 3 and len(s.tests) >= 3 and s.softens_when
    # Old reports keep their names.
    assert competency_name("emotional.naming_feelings") == "Naming feelings"


def test_the_friend_tests_the_skill_and_only_gives_way_when_earned() -> None:
    text = build_instruction(PARTNERS["woman"], SCENARIOS["boundary"], resumed=False)
    assert all(t in text for t in SCENARIOS["boundary"].tests)
    assert SCENARIOS["boundary"].softens_when in text
    assert "Holding the line" in text  # judged on, never spoken
    assert "never hint at what they should say" in text


def test_the_page_gets_the_brief() -> None:
    created = _created("s1", {"status": "created", "maxDurationMs": 60_000, "context": {"scenario": "comfort"}})
    assert created.brief is not None
    assert created.brief.goal == SCENARIOS["comfort"].goal and len(created.brief.tips) == 3
    assert created.brief.example == SCENARIOS["comfort"].example and created.brief.ownGoal
    assert _created("s1", {"context": {}}).brief is None


def test_the_user_can_practise_their_own_situation() -> None:
    own = "My flatmate Leo keeps eating my food and says it's no big deal."
    text = build_instruction(PARTNERS["man"], SCENARIOS["boundary"], resumed=False, own=own)
    assert own in text and "You are the person the user is talking to in that story" in text
    # Confiding about someone else: the friend listens; the partner in the story is not on the bench.
    assert "you are their close friend Sam" in text
    # The example's facts are only a pattern: the 200 and the break-up are not his story.
    assert SCENARIOS["boundary"].situation not in text
    assert "do not copy its facts" in text
    assert "Holding the line" in text


async def test_factory_passes_the_own_situation() -> None:
    own = "I forgot my sister's wedding toast."
    session = {"context": {"partner": "woman", "scenario": "apologise", "ownSituation": own}}
    spec = await EmotionalLiveAgentFactory().build(uid="u", session_id="s", session=session, resumed=False)
    assert own in spec.system_instruction
