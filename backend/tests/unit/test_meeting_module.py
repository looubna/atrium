from __future__ import annotations

import base64
import re
from pathlib import Path

import pytest

from app.core.errors import ValidationFailed
from app.modules.meeting.agents.attendees import MeetingLiveAgentFactory, build_instruction
from app.modules.meeting.agents.evaluator import fake_draft
from app.modules.meeting.api import CALL_TILES, FACES, Material, read_material
from app.modules.meeting.catalogs import MEETING_COMPETENCIES
from app.modules.meeting.plan import GROUP, LABELS, PEOPLE, Plan, Role, briefing, fallback, plan_of
from app.modules.meeting.retry import competency_name
from app.platform.competencies.catalog import COMMUNICATION
from app.platform.transcripts.model import Segment, Transcript

PRACTICE = Path(__file__).resolve().parents[3] / "src" / "data" / "practice.ts"


def _plan(role: Role) -> Plan:
    from app.modules.meeting.world import PersonDraft, PlanDraft, plan_from_draft

    draft = PlanDraft(
        title="Launch recovery", you="You are the product lead.", org="Northwind", about="Northwind, a SaaS firm.",
        situation="The launch slipped two weeks to 14 November; agenda: new date, scope, comms.",
        position="You want to keep the date and cut the reporting module.", opening="Robert opens.",
        success="A new plan with owners.", goal="Agree the plan.",
        people=[PersonDraft(key="robert", role="COO", stance="Wants the date kept at any cost.", known="Chairs."),
                PersonDraft(key="priya", role="Analyst", stance="Thinks 14 November is unrealistic.", known="Data."),
                PersonDraft(key="kevin", role="Engineer", stance="Two blockers in QA.", known="Builds it.")],
        points=["Propose cutting the reporting module to keep 14 November.",
                "Ask Kevin for a date on the QA blockers."],
    )
    return plan_from_draft(role, True, "Launch slipped", draft)


def test_roles_match_the_page() -> None:
    source = PRACTICE.read_text()
    block = source[source.index("MEETING_ROLES"):source.index("export interface MeetingSetup")]
    page = dict(re.findall(r"id: '([a-z]+)', label: '([^']+)'", block))
    assert page == {r.value: LABELS[r] for r in Role}


def test_people_and_faces() -> None:
    assert len({p.voice for p in PEOPLE.values()}) == len(PEOPLE)
    assert set(CALL_TILES) == {p.key for p in GROUP}
    assert len(set(FACES.values())) == 4


def test_a_written_plan_keeps_the_users_facts_and_round_trips() -> None:
    plan = _plan(Role.PARTICIPANT)
    assert plan.people(True)[0].role == "COO" and "14 November" in plan.situation
    assert Plan.from_doc(Role.PARTICIPANT, plan.to_doc()) == plan
    assert plan_of({"role": "participant", "plan": plan.to_doc()}).title == "Launch recovery"
    # When the user runs the meeting, the others wait for them to open it, whatever the draft said.
    assert _plan(Role.LEADER).opening == fallback(Role.LEADER, "").opening


def test_instruction_follows_the_users_role() -> None:
    leader = build_instruction(_plan(Role.LEADER), group=True, in_room=True, resumed=False)
    assert "The user runs this meeting" in leader and "Never take over the meeting" in leader
    assert "Priya and Kevin speak only through give_floor" in leader and "One question at a time" in leader
    client = build_instruction(_plan(Role.STAKEHOLDER), group=False, in_room=False, resumed=False)
    assert "client or stakeholder" in client and "give_floor" not in client
    assert "Carry on exactly where you were" in build_instruction(
        _plan(Role.PARTICIPANT), group=True, in_room=False, resumed=True)


async def test_factory_waits_for_a_leader_and_opens_for_a_participant() -> None:
    factory = MeetingLiveAgentFactory()
    led = await factory.build(uid="u", session_id="s", session={"context": {
        "role": "leader", "group": True, "plan": _plan(Role.LEADER).to_doc()}}, resumed=False)
    assert "the user runs this meeting and will open it" in led.opening_message and led.silence_duration_ms == 1100
    assert [m.name for m in led.panel] == ["Priya Raman", "Kevin Zhou"]
    assert "never say stage directions" in led.system_instruction
    joined = await factory.build(uid="u", session_id="s", session={"context": {
        "role": "participant", "mode": "in_person", "topic": "Budget"}}, resumed=False)
    assert "open the meeting" in joined.opening_message and joined.lead_name == "Claire Donovan"
    assert joined.silence_duration_ms == 900


def test_briefing_shows_the_users_side_only() -> None:
    plan = _plan(Role.LEADER)
    brief = briefing({"role": "leader", "group": True, "plan": plan.to_doc()})
    assert brief["title"] == "Launch recovery" and brief["format"].endswith("You open it.")
    assert "Wants the date kept at any cost." not in str(brief)
    # What to discuss: from the plan, or the role's defaults when none was written.
    assert brief["points"][0] == "Propose cutting the reporting module to keep 14 November."
    assert briefing({"role": "stakeholder", "topic": "x"})["points"][0].startswith("State your top priorities")
    assert [p["name"] for p in brief["people"]] == ["Robert Lindqvist", "Priya Raman", "Kevin Zhou"]


def test_material_is_read_or_ignored() -> None:
    text = "Q3 review. Revenue 1.2M, churn 4%. " * 10
    assert "churn 4%" in read_material(Material(name="notes.md", data=base64.b64encode(text.encode()).decode()))
    # An image or a binary file is not a document: the meeting goes ahead on the topic.
    assert read_material(Material(name="photo.png", data=base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"0" * 50)
                                  .decode())) == ""
    with pytest.raises(ValidationFailed):
        read_material(Material(name="x.txt", data="not base64!"))


async def test_writing_falls_back_to_the_users_topic(monkeypatch) -> None:
    from app.modules.meeting import world as world_module

    async def broken(**_: object) -> None:
        raise RuntimeError("model down")

    monkeypatch.setattr(world_module.gateway, "generate", broken)
    plan = await world_module.write_plan("u", Role.PARTICIPANT, True, "Hiring freeze for Q1")
    assert "Hiring freeze for Q1" in plan.situation


def test_names_and_fake_evaluation() -> None:
    assert competency_name("meeting.next_steps") == "Actions & next steps"
    transcript = Transcript(duration_ms=4000, segments=[
        Segment(id="s1", speaker="interviewer", start_ms=0, end_ms=1000, text="Where are we on the launch?"),
        Segment(id="s2", speaker="candidate", start_ms=1200, end_ms=4000, text="We slipped two weeks, here's why."),
    ])
    draft = fake_draft(transcript, frozenset(COMMUNICATION))
    assert {s.competencyId for s in draft.roundScores} == set(MEETING_COMPETENCIES)
    assert draft.events[0].evidenceSegmentIds == ["s2"]
