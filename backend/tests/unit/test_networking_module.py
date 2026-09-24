from __future__ import annotations

import re
from pathlib import Path

import pytest

from app.core.errors import NotFound
from app.modules.networking.agents.evaluator import fake_draft
from app.modules.networking.agents.guest import NetworkingLiveAgentFactory, build_instruction
from app.modules.networking.catalogs import NETWORKING_COMPETENCIES
from app.modules.networking.guests import GUESTS, GuestKind, guest_for
from app.modules.networking.retry import competency_name
from app.platform.competencies.catalog import COMMUNICATION
from app.platform.transcripts.model import Segment, Transcript

FRONTEND_GUESTS = Path(__file__).resolve().parents[3] / "src" / "data" / "networking.ts"


def test_guests_match_the_page() -> None:
    """The page and the server describe the same people, or a tag opens the wrong person."""
    source = FRONTEND_GUESTS.read_text()
    page = {
        m["id"]: (m["name"], m["role"], m["department"], m["kind"])
        for m in re.finditer(
            r"id: '(?P<id>[^']+)',\s*name: '(?P<name>[^']+)',\s*role: '(?P<role>[^']+)',\s*"
            r"department: '(?P<department>[^']+)',\s*kind: '(?P<kind>[^']+)'",
            source,
        )
    }
    assert page == {g.id: (g.name, g.role, g.department, g.kind.value) for g in GUESTS.values()}


def test_every_guest_has_their_own_voice_and_face() -> None:
    assert len({g.voice for g in GUESTS.values()}) == len(GUESTS)
    assert guest_for("marketing") is not None and guest_for("marketing").avatar_id == "nw_marketing"
    assert guest_for("nobody") is None


def test_instruction_plays_a_person_not_an_assistant() -> None:
    guest = GUESTS["director"]
    text = build_instruction(guest, role_visible=True, resumed=False)
    assert guest.name in text and guest.persona in text
    assert "not an assistant" in text
    assert "end_interview" in text
    assert "time tonight is limited" in text  # the executive's register
    assert "greet again" not in text


def test_hidden_role_and_resume() -> None:
    text = build_instruction(GUESTS["analyst"], role_visible=False, resumed=True)
    assert "name tag is not readable" in text
    assert "do not greet again" in text


async def test_factory_builds_the_guest() -> None:
    spec = await NetworkingLiveAgentFactory().build(
        uid="u", session_id="s", session={"context": {"guestId": "founder"}}, resumed=False
    )
    assert spec.voice_name == GUESTS["founder"].voice
    assert spec.lead_name == "Yusuf Rahman"
    # Saying goodbye ends a conversation at a reception, however soon.
    assert spec.may_end_early
    with pytest.raises(NotFound):
        await NetworkingLiveAgentFactory().build(uid="u", session_id="s", session={"context": {}}, resumed=False)


def test_competency_names() -> None:
    assert competency_name("networking.follow_up") == "Closing with a next step"
    assert competency_name(next(iter(COMMUNICATION))) == COMMUNICATION[next(iter(COMMUNICATION))].name


def test_fake_evaluation_scores_every_competency() -> None:
    transcript = Transcript(duration_ms=4000, segments=[
        Segment(id="s1", speaker="interviewer", start_ms=0, end_ms=1000, text="Hi, I'm Sara."),
        Segment(id="s2", speaker="candidate", start_ms=1200, end_ms=4000, text="Hello Sara, I work in design."),
    ])
    draft = fake_draft(transcript, frozenset(COMMUNICATION))
    assert {s.competencyId for s in draft.roundScores} == set(NETWORKING_COMPETENCIES)
    assert draft.events[0].evidenceSegmentIds == ["s2"]
    assert GuestKind("client") is GuestKind.CLIENT


def test_a_guest_filmed_alone_has_no_companions() -> None:
    text = build_instruction(GUESTS["marketing"], role_visible=True, resumed=False)
    assert "on your own" in text and "standing with" not in text
    assert all(not g.companions for g in GUESTS.values())
