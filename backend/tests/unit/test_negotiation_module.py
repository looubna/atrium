from __future__ import annotations

import re
from pathlib import Path

from app.modules.negotiation.agents.counterpart import NegotiationLiveAgentFactory, build_instruction
from app.modules.negotiation.agents.evaluator import fake_draft
from app.modules.negotiation.api import CALL_TILES, FACES
from app.modules.negotiation.catalogs import NEGOTIATION_COMPETENCIES
from app.modules.negotiation.deals import DEALS, GROUP, LABELS, PEOPLE, Deal, Scenario, briefing, deal_of
from app.modules.negotiation.retry import competency_name
from app.platform.competencies.catalog import COMMUNICATION
from app.platform.transcripts.model import Segment, Transcript

PRACTICE = Path(__file__).resolve().parents[3] / "src" / "data" / "practice.ts"


def test_scenarios_match_the_page() -> None:
    source = PRACTICE.read_text()
    block = source[source.index("NEGOTIATION_SCENARIOS"):source.index("export interface NegotiationSetup")]
    page = dict(re.findall(r"id: '([a-z]+)', label: '([^']+)'", block))
    assert page == {s.value: LABELS[s] for s in Scenario}


def test_every_deal_gives_the_other_side_a_position_for_everyone() -> None:
    for scenario, deal in DEALS.items():
        if scenario is not Scenario.OTHER:
            assert re.search(r"\d", deal.situation + deal.position), scenario  # figures and dates
        assert set(deal.stances) == set(deal.known) == set(deal.roles) == set(PEOPLE)
        assert deal.opening and deal.success and deal.goal and deal.you and deal.position
    assert len({p.voice for p in PEOPLE.values()}) == len(PEOPLE)
    assert set(CALL_TILES) == {p.key for p in GROUP}
    assert len(set(FACES.values())) == 4


def test_instruction_plays_the_other_side_and_keeps_its_limit() -> None:
    solo = build_instruction(DEALS[Scenario.SALARY], group=False, in_room=True, resumed=False)
    assert "€80,000" in solo and "Never say your limit" in solo and "never a coach" in solo
    assert "in person" in solo and "give_floor" not in solo and "One question at a time" in solo
    group = build_instruction(DEALS[Scenario.PRICE], group=True, in_room=False, resumed=False)
    assert "heard in Robert's voice, as Robert" in group and "Priya and Kevin speak only through give_floor" in group
    assert "Naming a colleague never makes them speak" in group and "Never call give_floor for Robert" in group
    assert "Carry on exactly where you were" in build_instruction(
        DEALS[Scenario.SCOPE], group=False, in_room=False, resumed=True)


async def test_factory_builds_the_session() -> None:
    factory = NegotiationLiveAgentFactory()
    solo = await factory.build(uid="u", session_id="s", session={"context": {"scenario": "deadline",
                                                                           "mode": "in_person"}}, resumed=False)
    assert solo.lead_name == "Claire Donovan" and solo.panel == () and solo.tools == ("end_interview",)
    assert "sat down at the table" in solo.opening_message and solo.silence_duration_ms == 900
    group = await factory.build(uid="u", session_id="s", session={"context": {"scenario": "partnership",
                                                                            "group": True}}, resumed=False)
    assert group.lead_name == "Robert Lindqvist" and [m.name for m in group.panel] == ["Priya Raman", "Kevin Zhou"]
    assert [m.questions for m in group.panel] == [2, 2] and group.tools == ("end_interview", "give_floor")


def test_the_user_is_briefed_on_their_side_only() -> None:
    brief = briefing({"scenario": "price", "mode": "in_person"})
    assert brief["title"] == "Price negotiation" and "€250,000" in brief["position"]
    assert brief["format"].startswith("In person") and len(brief["people"]) == 1
    # The other side's limit stays private: finding the room is the user's job.
    assert DEALS[Scenario.PRICE].stances["claire"] not in str(brief) and "€252,000" not in str(brief)
    group = briefing({"scenario": "salary", "group": True})
    assert [p["name"] for p in group["people"]] == ["Robert Lindqvist", "Priya Raman", "Kevin Zhou"]
    assert group["people"][1]["role"] == "HR Business Partner"
    # The notes never repeat the job title shown beside the name.
    solo = briefing({"scenario": "salary"})
    assert solo["people"][0]["known"].startswith("Your future manager")


def test_a_written_deal_is_checked_and_round_trips() -> None:
    from app.modules.negotiation.world import DealDraft, PersonDraft, deal_from_draft

    draft = DealDraft(
        you="You rent a flat from Mr Hale.", org="Hale Lettings", about="Hale Lettings, a family landlord.",
        situation="Rent €1,400 a month; the landlord wants €1,610 (+15%) from 1 January.",
        position="You want under €1,470 (+5%).", opening="Claire says costs went up.", success="Under 5%.",
        goal="Keep the rise under 5%.",
        people=[PersonDraft(key="claire", role="Landlord", stance="Would accept 8% for a 2-year lease.",
                            known="Owns the building.")],
    )
    deal = deal_from_draft(Scenario.OTHER, False, draft)
    assert deal.people(False)[0].role == "Landlord" and "€1,610" in deal.situation
    assert Deal.from_doc(Scenario.OTHER, deal.to_doc()) == deal
    assert deal_of({"scenario": "other", "deal": deal.to_doc()}).position == deal.position
    assert deal_of({"scenario": "price"}) is DEALS[Scenario.PRICE]


async def test_writing_falls_back_to_the_preset_or_the_users_words(monkeypatch) -> None:
    from app.modules.negotiation import world as world_module

    async def broken(**_: object) -> None:
        raise RuntimeError("model down")

    monkeypatch.setattr(world_module.gateway, "generate", broken)
    assert await world_module.write_deal("u", Scenario.PRICE, False, "", "Retail") is DEALS[Scenario.PRICE]
    own = await world_module.write_deal("u", Scenario.OTHER, False, "My landlord wants +15%.", "")
    assert own.situation == "My landlord wants +15%."


def test_names_and_fake_evaluation() -> None:
    assert competency_name("negotiation.concessions") == "Managing concessions"
    transcript = Transcript(duration_ms=4000, segments=[
        Segment(id="s1", speaker="interviewer", start_ms=0, end_ms=1000, text="Nine percent is a lot."),
        Segment(id="s2", speaker="candidate", start_ms=1200, end_ms=4000, text="Okay, we can do five percent."),
    ])
    draft = fake_draft(transcript, frozenset(COMMUNICATION))
    assert {s.competencyId for s in draft.roundScores} == set(NEGOTIATION_COMPETENCIES)
    assert draft.events[0].evidenceSegmentIds == ["s2"]
