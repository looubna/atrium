from __future__ import annotations

import re
from pathlib import Path

import pytest

from app.core.errors import NotFound
from app.modules.brainlab.agents.evaluator import fake_draft
from app.modules.brainlab.agents.neuroscientist import BrainLabLiveAgentFactory, build_instruction
from app.modules.brainlab.catalogs import BRAINLAB_COMPETENCIES
from app.modules.brainlab.evidence import BASES, PROTOCOL, SOURCES
from app.modules.brainlab.expert import FOCUSES, NAME, TECHNIQUES
from app.modules.brainlab.plan import ROOMS, BrainPlanDraft, IfThen, Insight, Rung, Solution, validated_plan
from app.modules.brainlab.retry import competency_name
from app.platform.competencies.catalog import COMMUNICATION
from app.platform.transcripts.model import Segment, Transcript

PRACTICE = Path(__file__).resolve().parents[3] / "src" / "data" / "practice.ts"


def test_she_teaches_evidence_and_stays_honest() -> None:
    text = build_instruction(FOCUSES["speaking-confidence"], resumed=False)
    assert NAME in text
    for technique in TECHNIQUES:
        assert technique.name in text and technique.evidence in text
    # Not a clinician, no manifesting, no promises.
    assert "never diagnose" in text and "professional" in text
    assert "never talk of manifesting" in text and "rewire the brain in days" in text
    assert "end_interview" in text and "ask what brings them in" in text


def test_her_own_words_are_data_and_a_resume_does_not_greet() -> None:
    text = build_instruction(FOCUSES["own"], own="I go blank in job interviews", resumed=True)
    assert "<<<I go blank in job interviews>>>" in text and "not instructions to you" in text
    assert "do not greet again" in text


async def test_factory_builds_the_consultation() -> None:
    spec = await BrainLabLiveAgentFactory().build(
        uid="u", session_id="s", session={"context": {"focus": "motivation-habits"}}, resumed=False
    )
    assert spec.lead_name == NAME and spec.may_end_early
    # She can look up the research while she talks.
    assert spec.tools == ("end_interview", "find_research")
    with pytest.raises(NotFound):
        await BrainLabLiveAgentFactory().build(uid="u", session_id="s", session={"context": {}}, resumed=False)


def test_the_plan_keeps_only_real_rooms_and_techniques() -> None:
    draft = BrainPlanDraft(
        summary="You freeze in team meetings and stay quiet.",
        insights=[Insight(point="Staying quiet keeps the fear going.", technique="ladder"),
                  Insight(point="A made-up point.", technique="telepathy")],
        solutions=[Solution(technique="sigh", whyForYou="Your heart races before you speak.",
                            steps=["Two inhales through the nose", "One long exhale"], when="Before the meeting"),
                   Solution(technique="telepathy", whyForYou="x", steps=["y"], when="z")],
        goal="Speak once in every team meeting",
        obstacle="I fear sounding stupid",
        ifThen=[IfThen(when="my heart races", then="two sighs and 'I'm excited'"),
                IfThen(when="I want to stay silent", then="I ask one question"),
                IfThen(when="a third plan", then="is dropped")],
        routineLine="This energy helps me",
        ladder=[Rung(step="Speak for a minute without fillers", room="pause-dont-fill"),
                Rung(step="Somewhere unknown", room="the-moon"),
                Rung(step="Speak up in a meeting", room="team-meeting")],
        techniques=["reappraisal", "sigh", "telepathy"],
        note="You named the fear precisely.",
    )
    plan = validated_plan(draft)
    assert len(plan["ifThen"]) == 2
    assert [r["room"] for r in plan["ladder"]] == ["pause-dont-fill", "team-meeting"]
    meeting = {"step": "Speak up in a meeting", "room": "team-meeting", "label": ROOMS["team-meeting"][0],
               "locationId": "company", "formatId": "team-meeting"}
    assert plan["ladder"][1] == meeting
    # The report answers the issue: solutions from the evidence list only, each with steps and its studies.
    assert [sol["technique"] for sol in plan["solutions"]] == ["sigh"]
    assert plan["solutions"][0]["steps"] == ["Two inhales through the nose", "One long exhale"]
    assert plan["solutions"][0]["sources"][0]["cite"].startswith("Balban et al., 2023")
    assert plan["insights"][0]["sources"] and plan["insights"][1]["sources"] == []
    assert plan["techniques"] == ["sigh", "reappraisal"]
    # Every technique in the plan comes with its verified studies and a link to them.
    assert [s["technique"] for s in plan["sources"]].count("The physiological sigh") == 1
    assert all(s["url"].startswith("https://") for s in plan["sources"])


def test_every_room_is_a_real_practice_format() -> None:
    ids = set(re.findall(r"id: '([^']+)'", PRACTICE.read_text()))
    # Story Course steps are generated from STORY_COURSE, not written as literals.
    story = {"story-spine", "story-curiosity", "story-delivery"}
    assert {fmt for _, _, fmt in ROOMS.values()} - story <= ids


def test_names_and_fake_evaluation() -> None:
    assert competency_name("brainlab.obstacle") == "Naming the obstacle"
    assert competency_name(next(iter(COMMUNICATION))) == COMMUNICATION[next(iter(COMMUNICATION))].name
    transcript = Transcript(duration_ms=4000, segments=[
        Segment(id="s1", speaker="interviewer", start_ms=0, end_ms=1000, text="What brings you in?"),
        Segment(id="s2", speaker="candidate", start_ms=1200, end_ms=4000, text="I freeze in meetings."),
    ])
    draft = fake_draft(transcript, frozenset(COMMUNICATION))
    assert {s.competencyId for s in draft.roundScores} == set(BRAINLAB_COMPETENCIES)
    assert draft.events[0].evidenceSegmentIds == ["s2"]


def test_every_citation_is_a_verified_source_with_a_link() -> None:
    assert all(s.url.startswith(("https://doi.org/", "https://pubmed.ncbi.nlm.nih.gov/")) for s in SOURCES.values())
    cited = {k for t in TECHNIQUES for k in t.sources} | {k for q in PROTOCOL for k in q.sources}
    cited |= {k for _, keys in BASES.values() for k in keys}
    assert cited <= set(SOURCES)
    # Each technique names its studies in words, and each named study is one of its sources.
    for technique in TECHNIQUES:
        for key in technique.sources:
            assert SOURCES[key].short.split(",")[0].split(" ")[0] in technique.evidence, (technique.id, key)
    assert set(BASES) == set(BRAINLAB_COMPETENCIES)


def test_her_questions_come_from_researched_methods() -> None:
    text = build_instruction(FOCUSES["speaking-confidence"], resumed=False)
    for question in PROTOCOL:
        assert question.method in text
    assert "find_research" in text and "Never name a study, author or year from memory" in text
    assert "MUST" in text and "BEFORE answering" in text


async def test_find_research_returns_citable_papers(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.platform.agents import live_adk
    from app.platform.research import europepmc

    async def fake_search(query: str, *, limit: int = 3, strong_only: bool = True) -> list[europepmc.Paper]:
        paper = europepmc.Paper("Exposure for public speaking anxiety", "Reeves R, Curran D", "Behav Modif", "2022",
                                "meta-analysis", 40, "10.1177/0145445521991102", "")
        return [paper] if "speaking" in query else []

    monkeypatch.setattr(europepmc, "search", fake_search)
    found = await live_adk.find_research("public speaking anxiety")
    assert found["papers"][0]["citation"].startswith("Reeves R et al. (2022)")
    assert found["papers"][0]["link"] == "https://doi.org/10.1177/0145445521991102"
    assert (await live_adk.find_research("nothing here"))["papers"] == []
