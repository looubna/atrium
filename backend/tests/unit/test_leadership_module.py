from __future__ import annotations

import re
from pathlib import Path

from app.modules.leadership.agents.evaluator import fake_draft
from app.modules.leadership.agents.team import LeadershipLiveAgentFactory, build_instruction
from app.modules.leadership.catalogs import LEADERSHIP_COMPETENCIES
from app.modules.leadership.retry import competency_name
from app.modules.leadership.scenarios import BRIEFS, FULL_SEQUENCE, MANAGER_BRIEFS, TEAM, Scenario, briefing, on_call
from app.platform.competencies.catalog import COMMUNICATION
from app.platform.transcripts.model import Segment, Transcript

PRACTICE = Path(__file__).resolve().parents[3] / "src" / "data" / "practice.ts"


def test_scenarios_match_the_page() -> None:
    source = PRACTICE.read_text()
    block = source[source.index("LEADERSHIP_SCENARIOS"):source.index("export interface LeadershipSetup")]
    page = dict(re.findall(r"id: '([a-z]+)', label: '([^']+)'", block))
    assert page == {s.value: BRIEFS[s].label for s in Scenario}


def test_every_brief_is_concrete_and_covers_everyone() -> None:
    for brief in BRIEFS.values():
        assert re.search(r"\d", brief.situation), brief.label  # dates, numbers: specific, not generic
        assert set(brief.stances) == {m.key for m in TEAM}
        assert brief.lead in brief.stances and brief.success and brief.opening
    assert len({m.voice for m in TEAM}) == len(TEAM)
    assert len({m.avatar_id for m in TEAM}) == len(TEAM)


def test_who_is_on_the_call() -> None:
    assert [m.key for m in on_call(Scenario.CONFLICT)] == ["laura", "marcus", "nadia"]
    assert [m.key for m in on_call(Scenario.FEEDBACK)] == ["marcus"]  # a one-to-one
    assert len(on_call(None)) == 3


def test_instruction_plays_the_team_not_a_coach() -> None:
    text = build_instruction(Scenario.CRISIS, resumed=False)
    assert "heard in Marcus's voice, as Marcus" in text and "give_floor" in text
    # The lead never talks to itself: a reply to the lead is somebody else's line.
    assert 'never say "Marcus" to address someone' in text and "including when they reply to Marcus" in text
    assert "140 open tickets" in text and "never coach" in text.lower()
    assert "the manager opens it" in text
    full = build_instruction(None, resumed=False)
    for scenario in FULL_SEQUENCE:
        assert BRIEFS[scenario].situation in full
    assert "Carry on exactly where you were" in build_instruction(Scenario.MOTIVATE, resumed=True)


async def test_factory_builds_the_call() -> None:
    factory = LeadershipLiveAgentFactory()
    spec = await factory.build(uid="u", session_id="s", session={"context": {"mode": "scenario",
                                                                            "scenario": "conflict"}}, resumed=False)
    assert spec.lead_name == "Laura Bennett" and spec.voice_name == "Gacrux"
    assert [m.name for m in spec.panel] == ["Marcus Hale", "Nadia Karim"]
    assert spec.tools == ("end_interview", "give_floor") and spec.may_end_early
    assert spec.fast_panel_voices and spec.silence_duration_ms == 1200
    solo = await factory.build(uid="u", session_id="s", session={"context": {"mode": "scenario",
                                                                           "scenario": "feedback"}}, resumed=False)
    assert solo.panel == () and solo.tools == ("end_interview",)
    full = await factory.build(uid="u", session_id="s", session={"context": {"mode": "full"}}, resumed=False)
    assert len(full.panel) == 2


def test_names_and_fake_evaluation() -> None:
    assert competency_name("leadership.decisions") == "Decision-making"
    transcript = Transcript(duration_ms=4000, segments=[
        Segment(id="s1", speaker="interviewer", start_ms=0, end_ms=1000, text="The payments are failing."),
        Segment(id="s2", speaker="candidate", start_ms=1200, end_ms=4000, text="Okay, let's roll back now."),
    ])
    draft = fake_draft(transcript, frozenset(COMMUNICATION))
    assert {s.competencyId for s in draft.roundScores} == set(LEADERSHIP_COMPETENCIES)
    assert draft.events[0].evidenceSegmentIds == ["s2"]


def test_the_manager_is_briefed_but_not_told_what_anyone_thinks() -> None:
    assert set(MANAGER_BRIEFS) == set(Scenario)
    crisis = briefing(Scenario.CRISIS)
    assert crisis["title"] == "Handle a crisis" and "140 open tickets" in str(crisis["situations"])
    assert [p["name"] for p in crisis["people"]] == ["Marcus Hale", "Laura Bennett", "Nadia Karim"]
    # Private stances stay private: finding them out is the manager's job on the call.
    assert BRIEFS[Scenario.CRISIS].stances["marcus"] not in str(crisis)
    full = briefing(None)
    assert full["title"] == "Weekly team call" and len(full["situations"]) == len(FULL_SEQUENCE)
    solo = briefing(Scenario.FEEDBACK)
    assert len(solo["people"]) == 1 and solo["format"].startswith("One-to-one")


def test_a_written_world_is_checked_and_round_trips() -> None:
    from app.modules.leadership.scenarios import DEFAULT_WORLD, World, world_of
    from app.modules.leadership.world import BriefDraft, WorldDraft, world_from_draft

    draft = WorldDraft(
        company="Meridian General, a 300-bed hospital. You manage its outpatient nursing team.",
        laura_role="Senior Staff Nurse", marcus_role="Clinical Operations Lead", nadia_role="Junior Nurse",
        briefs=[BriefDraft(
            scenario="feedback", situation="On 12 September Marcus skipped two handover checks on ward 4.",
            laura_stance="x", marcus_stance="Burnt out after four night shifts.", nadia_stance="y",
            opening="Marcus asks what this is about.", success="Specific, fair feedback.",
            goal="Agree what changes.", laura_noticed="x", marcus_noticed="Skipped two checks.", nadia_noticed="y",
        )],
    )
    world = world_from_draft(draft, [Scenario.FEEDBACK])
    assert world.on_call(Scenario.FEEDBACK)[0].role == "Clinical Operations Lead"
    assert "ward 4" in world.briefs[Scenario.FEEDBACK].situation
    # Laura and Nadia are not on a one-to-one, whatever the model wrote for them.
    assert world.briefs[Scenario.FEEDBACK].stances["laura"] == "Not on this call."
    # Scenarios it was not asked for keep their defaults.
    assert world.briefs[Scenario.CRISIS] == DEFAULT_WORLD.briefs[Scenario.CRISIS]
    again = World.from_doc(world.to_doc())
    assert again.company == world.company and again.roles == world.roles
    stored = world_of({"world": world.to_doc()})
    assert stored.briefs[Scenario.FEEDBACK].situation == world.briefs[Scenario.FEEDBACK].situation
    assert world_of({}) is DEFAULT_WORLD
    text = build_instruction(Scenario.FEEDBACK, resumed=False, world=world)
    assert "Meridian General" in text and "ward 4" in text


async def test_writing_a_world_falls_back_to_the_default(monkeypatch) -> None:
    from app.modules.leadership import world as world_module
    from app.modules.leadership.scenarios import DEFAULT_WORLD

    async def broken(**_: object) -> None:
        raise RuntimeError("model down")

    monkeypatch.setattr(world_module.gateway, "generate", broken)
    assert await world_module.write_world("u", "Healthcare", "Ward manager", [Scenario.CRISIS]) is DEFAULT_WORLD
