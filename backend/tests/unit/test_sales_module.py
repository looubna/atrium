from __future__ import annotations

import re
from pathlib import Path

from app.modules.sales.agents.buyer import SalesLiveAgentFactory, build_instruction
from app.modules.sales.agents.evaluator import fake_draft
from app.modules.sales.api import CALL_TILES, FACES
from app.modules.sales.catalogs import SALES_COMPETENCIES
from app.modules.sales.deals import DEALS, INVESTORS, LABELS, PEOPLE, Deal, SalesType, briefing, deal_of
from app.modules.sales.retry import competency_name
from app.platform.competencies.catalog import COMMUNICATION
from app.platform.transcripts.model import Segment, Transcript

PRACTICE = Path(__file__).resolve().parents[3] / "src" / "data" / "practice.ts"


def test_types_match_the_page() -> None:
    source = PRACTICE.read_text()
    block = source[source.index("SALES_TYPES"):source.index("export interface SalesSetup")]
    page = dict(re.findall(r"id: '([a-z-]+)', label: '([^']+)'", block))
    assert page == {t.value: LABELS[t] for t in SalesType}


def test_every_deal_is_concrete_and_covers_everyone() -> None:
    for kind, deal in DEALS.items():
        assert re.search(r"\d", deal.situation), kind  # numbers and dates: specific, not generic
        keys = {p.key for p in deal.people()}
        assert set(deal.stances) == set(deal.known) == set(deal.roles) == keys
        assert deal.opening and deal.success and deal.goal and deal.seller
    assert len({p.voice for p in PEOPLE.values()}) == len(PEOPLE)
    assert [p.key for p in DEALS[SalesType.INVESTOR].people()] == ["robert", "priya", "kevin"]
    assert set(CALL_TILES) == {p.key for p in INVESTORS}
    assert len(set(FACES.values())) == 4


def test_instruction_plays_the_buyer_not_a_coach() -> None:
    text = build_instruction(SalesType.OUTREACH, DEALS[SalesType.OUTREACH], in_room=False, resumed=False)
    assert "18% of jobs" in text and "never a coach" in text and "on a video call" in text
    assert "give_floor" not in text
    panel = build_instruction(SalesType.INVESTOR, DEALS[SalesType.INVESTOR], in_room=True, resumed=False)
    assert "heard in Robert's voice, as Robert" in panel and "Priya and Kevin speak only through give_floor" in panel
    assert "in person" in panel
    assert "Carry on exactly where you were" in build_instruction(
        SalesType.PITCH, DEALS[SalesType.PITCH], in_room=False, resumed=True)


async def test_factory_builds_the_session() -> None:
    factory = SalesLiveAgentFactory()
    solo = await factory.build(uid="u", session_id="s", session={"context": {"type": "pitch-demo",
                                                                           "mode": "in-person"}}, resumed=False)
    assert solo.lead_name == "Claire Donovan" and solo.panel == () and solo.tools == ("end_interview",)
    assert "sat down at the table" in solo.opening_message and solo.may_end_early
    panel = await factory.build(uid="u", session_id="s", session={"context": {"type": "investor-pitch"}},
                                resumed=False)
    assert panel.lead_name == "Robert Lindqvist" and [m.name for m in panel.panel] == ["Priya Raman", "Kevin Zhou"]
    assert panel.tools == ("end_interview", "give_floor") and panel.fast_panel_voices
    # One question at a time, and not many: two each for the partner and the associate.
    assert [m.questions for m in panel.panel] == [2, 2]
    assert "ONE question per turn" in panel.system_instruction and "about six" in panel.system_instruction
    assert "One question at a time" in solo.system_instruction and solo.silence_duration_ms == 900
    assert "Naming a colleague never makes them speak" in panel.system_instruction
    assert "Never call give_floor for Robert" in panel.system_instruction


def test_the_seller_is_briefed_but_not_told_what_the_buyer_thinks() -> None:
    brief = briefing({"type": "account-management", "mode": "in_person"})
    assert brief["title"] == "Account management" and "12 August" in brief["situation"]
    assert brief["format"].startswith("At the offices of Harlow Home Services")
    assert DEALS[SalesType.ACCOUNT].stances["claire"] not in str(brief)
    investors = briefing({"type": "investor-pitch"})
    assert [p["name"] for p in investors["people"]] == ["Robert Lindqvist", "Priya Raman", "Kevin Zhou"]


def test_a_written_deal_is_checked_and_round_trips() -> None:
    from app.modules.sales.world import DealDraft, PersonDraft, deal_from_draft

    draft = DealDraft(
        seller="You sell MedTrack, bed-management software for hospitals.", org="St Aidan's Hospital",
        about="St Aidan's, a 420-bed hospital.", situation="Beds sit empty 5 hours after discharge on average.",
        opening="Claire answers.", success="Books a demo.", goal="Book a demo.",
        people=[PersonDraft(key="claire", role="Director of Patient Flow", stance="Hates pagers.", known="Posted.")],
    )
    deal = deal_from_draft(SalesType.OUTREACH, draft)
    assert deal.people()[0].role == "Director of Patient Flow" and deal.org == "St Aidan's Hospital"
    again = Deal.from_doc(SalesType.OUTREACH, deal.to_doc())
    assert again == deal
    assert deal_of({"type": "call-outreach", "deal": deal.to_doc()}).situation == deal.situation
    assert deal_of({"type": "call-outreach"}) is DEALS[SalesType.OUTREACH]
    text = build_instruction(SalesType.OUTREACH, deal, in_room=False, resumed=False)
    assert "MedTrack" in text and "Hates pagers." in text


async def test_writing_a_deal_falls_back_to_the_default(monkeypatch) -> None:
    from app.modules.sales import world as world_module

    async def broken(**_: object) -> None:
        raise RuntimeError("model down")

    monkeypatch.setattr(world_module.gateway, "generate", broken)
    assert await world_module.write_deal("u", SalesType.PITCH, "CRM", "", "") is DEALS[SalesType.PITCH]


def test_names_and_fake_evaluation() -> None:
    assert competency_name("sales.objections") == "Objection handling"
    transcript = Transcript(duration_ms=4000, segments=[
        Segment(id="s1", speaker="interviewer", start_ms=0, end_ms=1000, text="What is this about?"),
        Segment(id="s2", speaker="candidate", start_ms=1200, end_ms=4000, text="We help teams schedule faster."),
    ])
    draft = fake_draft(transcript, frozenset(COMMUNICATION))
    assert {s.competencyId for s in draft.roundScores} == set(SALES_COMPETENCIES)
    assert draft.events[0].evidenceSegmentIds == ["s2"]
