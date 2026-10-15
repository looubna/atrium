from __future__ import annotations

import re
from pathlib import Path

import pytest

from app.core.errors import NotFound
from app.modules.busstop.agents.evaluator import fake_draft
from app.modules.busstop.agents.person import BusStopLiveAgentFactory, build_instruction
from app.modules.busstop.api import _view
from app.modules.busstop.catalogs import AREA_COMPETENCIES
from app.modules.busstop.evidence import SOURCES, TECHNIQUES
from app.modules.busstop.people import AREAS, PARTNERS, SCENARIOS
from app.modules.busstop.retry import competency_name
from app.platform.competencies.catalog import COMMUNICATION
from app.platform.transcripts.model import Segment, Transcript

LOCATIONS = Path(__file__).resolve().parents[3] / "src" / "data" / "locations.ts"


def test_every_area_is_a_bus_stop_area_with_situations_and_skills() -> None:
    stop = LOCATIONS.read_text().split("id: 'bus-stop'")[1]
    assert set(re.findall(r"'([^']+)'", stop.split("practiceAreas:")[1].split("]")[0])) == set(AREAS.values())
    for area in AREAS:
        assert sum(s.area == area for s in SCENARIOS.values()) >= 3
        assert AREA_COMPETENCIES[area]
    assert set(PARTNERS) == set(SCENARIOS)


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
    s = SCENARIOS["queue"]
    text = build_instruction(PARTNERS["queue"], s, resumed=False)
    assert "Natalie" in text and "'Oh, I didn't see a queue.'" in text
    assert "not an assistant or a coach" in text and "end_interview" in text
    assert "Start at once" in text
    # The user opens this one: the stranger only notices them.
    late = build_instruction(PARTNERS["late-bus"], SCENARIOS["late-bus"], resumed=False)
    assert "The user opens the conversation" in late
    own = build_instruction(PARTNERS["pushy"], SCENARIOS["pushy"], resumed=True, own="A man asks my address")
    assert "<<<A man asks my address>>>" in own and "do not greet again" in own
    # Tom knows the user: he uses their account name, and never invents one when there is none.
    tom = build_instruction(PARTNERS["forgot-name"], SCENARIOS["forgot-name"], resumed=False, user_name="Loubna")
    assert "call them Loubna" in tom and "never call them by any other name" in tom
    nameless = build_instruction(PARTNERS["forgot-name"], SCENARIOS["forgot-name"], resumed=False)
    assert "Never make one up" in nameless


async def test_factory() -> None:
    spec = await BusStopLiveAgentFactory().build(
        uid="u", session_id="s", session={"context": {"scenario": "late-bus"}}, resumed=False
    )
    assert spec.lead_name == "Grace" and spec.voice_name == "Sulafat" and spec.tools == ("end_interview",)
    with pytest.raises(NotFound):
        await BusStopLiveAgentFactory().build(uid="u", session_id="s", session={"context": {}}, resumed=False)


def test_names_and_fake_evaluation() -> None:
    assert competency_name("busstop.smalltalk.follow_up") == "Follow-up questions"
    transcript = Transcript(duration_ms=4000, segments=[
        Segment(id="s1", speaker="candidate", start_ms=0, end_ms=1500, text="Is it always this late?"),
        Segment(id="s2", speaker="interviewer", start_ms=1600, end_ms=4000, text="Yeah."),
    ])
    draft = fake_draft(transcript, frozenset(COMMUNICATION), "smalltalk")
    assert {s.competencyId for s in draft.roundScores} == {c.id for c in AREA_COMPETENCIES["smalltalk"]}
    assert draft.events[0].evidenceSegmentIds == ["s1"]
