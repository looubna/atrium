from __future__ import annotations

import re
from pathlib import Path

import pytest

from app.core.errors import NotFound
from app.modules.cafe.agents.evaluator import fake_draft
from app.modules.cafe.agents.person import CafeLiveAgentFactory, build_instruction
from app.modules.cafe.api import _view
from app.modules.cafe.catalogs import AREA_COMPETENCIES
from app.modules.cafe.evidence import SOURCES, TECHNIQUES
from app.modules.cafe.people import AREAS, PARTNERS, SCENARIOS
from app.modules.cafe.retry import competency_name
from app.platform.competencies.catalog import COMMUNICATION
from app.platform.transcripts.model import Segment, Transcript

LOCATIONS = Path(__file__).resolve().parents[3] / "src" / "data" / "locations.ts"


def test_every_area_is_a_cafe_area_with_situations_and_skills() -> None:
    cafe = LOCATIONS.read_text().split("id: 'cafe'")[1].split("id: 'mall'")[0]
    assert set(re.findall(r"'([^']+)'", cafe.split("practiceAreas:")[1])) == set(AREAS.values())
    for area in AREAS:
        assert sum(s.area == area for s in SCENARIOS.values()) >= 3
        assert AREA_COMPETENCIES[area]


def test_every_tip_names_its_verified_studies() -> None:
    assert all(s.url.startswith("https://doi.org/") for s in SOURCES.values())
    for t in TECHNIQUES.values():
        for key in t.sources:
            assert SOURCES[key].short.split(",")[0].split(" ")[0] in t.evidence, (t.id, key)
    for s in SCENARIOS.values():
        view = _view(s)
        assert len(view.tips) >= 2 and all(tip.studies for tip in view.tips)
        assert view.name == PARTNERS[s.id].name


def test_the_person_is_real_and_stays_in_role() -> None:
    s = SCENARIOS["say-no"]
    text = build_instruction(PARTNERS["say-no"], s, resumed=False)
    assert "Omar" in text and "'Okay, what about half, then?'" in text
    assert "not an assistant or a coach" in text and "end_interview" in text
    assert "Start at once" in text
    # The user opens this one: the stranger only notices them.
    stranger = build_instruction(PARTNERS["stranger"], SCENARIOS["stranger"], resumed=False)
    assert "The user opens the conversation" in stranger
    own = build_instruction(PARTNERS["say-no"], s, resumed=True, own="My brother wants me to co-sign a loan")
    assert "<<<My brother wants me to co-sign a loan>>>" in own and "do not greet again" in own


async def test_factory() -> None:
    spec = await CafeLiveAgentFactory().build(
        uid="u", session_id="s", session={"context": {"partner": "woman", "scenario": "stranger"}}, resumed=False
    )
    assert spec.lead_name == "Emma" and spec.voice_name == "Aoede" and spec.tools == ("end_interview",)
    with pytest.raises(NotFound):
        await CafeLiveAgentFactory().build(uid="u", session_id="s", session={"context": {}}, resumed=False)


def test_names_and_fake_evaluation() -> None:
    assert competency_name("cafe.starting.follow_up") == "Follow-up questions"
    transcript = Transcript(duration_ms=4000, segments=[
        Segment(id="s1", speaker="candidate", start_ms=0, end_ms=1500, text="Hi, is that book any good?"),
        Segment(id="s2", speaker="interviewer", start_ms=1600, end_ms=4000, text="Yeah, it's good."),
    ])
    draft = fake_draft(transcript, frozenset(COMMUNICATION), "starting")
    assert {s.competencyId for s in draft.roundScores} == {c.id for c in AREA_COMPETENCIES["starting"]}
    assert draft.events[0].evidenceSegmentIds == ["s1"]
