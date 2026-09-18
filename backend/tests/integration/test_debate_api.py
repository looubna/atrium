"""A debate end to end: set it up, prepare it, argue it, and get the argument map.

Two things this covers that the unit tests cannot. First, the API contract: what the app
actually receives at each step, including that the preparation screen is never handed the
opponent's plan of attack. Second the live loop — the turn observer running against real
documents, keeping state across turns, and steering the opponent through the note the
gateway sends into the session.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from pathlib import Path

import httpx
import pytest
import pytest_asyncio
from google.cloud import firestore

from app.modules.debate.agents.evaluator import debate_state_of
from app.modules.debate.argument import Side
from app.modules.debate.observer import DebateTurnObserver
from app.platform.clients import clients
from app.platform.jobs.module_tasks import run_module_task
from app.platform.jobs.queue import RecordingQueue
from app.platform.users import CURRENT_CONSENT_VERSION
from tests.integration.conftest import as_user

DEBATES = "/api/v1/debate/debates"
SESSIONS = "/api/v1/debate/sessions"
TOPIC = "Governments should regulate generative AI"


@pytest_asyncio.fixture
async def tasks(
    db: firestore.AsyncClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> AsyncIterator[RecordingQueue]:
    monkeypatch.setenv("LOCAL_OBJECTS_DIR", str(tmp_path))
    recording = RecordingQueue()
    clients.overrides["task_queue"] = recording
    yield recording
    clients.overrides.pop("task_queue", None)


async def consent(api: httpx.AsyncClient, uid: str) -> None:
    for kind in ("ai_processing", "recording"):
        response = await api.put(
            f"/api/v1/me/consents/{kind}",
            headers=as_user(uid),
            json={"accepted": True, "version": CURRENT_CONSENT_VERSION},
        )
        assert response.status_code == 200, response.text


async def run_tasks(queue: RecordingQueue) -> None:
    """Run every queued module task in process, as local development does."""
    while queue.requests:
        request = queue.requests.pop(0)
        parts = request.path.strip("/").split("/")
        assert parts[:2] == ["internal", "modules"], request.path
        await run_module_task(parts[2], parts[4], request.payload)


def new_id() -> str:
    import uuid

    return str(uuid.uuid4())


async def create_debate(api: httpx.AsyncClient, uid: str, **body: object) -> dict:
    response = await api.post(DEBATES, headers=as_user(uid), json={"id": new_id(), **body})
    assert response.status_code == 201, response.text
    return response.json()


# ---------------------------------------------------------------------------
# Setting a debate up


async def test_a_debate_needs_nothing_but_a_topic(db: firestore.AsyncClient, api: httpx.AsyncClient) -> None:
    """§5: intelligent defaults. The simple screen sends a topic and nothing else."""
    debate = await create_debate(api, "alice", topic=TOPIC)
    assert debate["topic"] == TOPIC
    assert debate["format"] == "free"
    assert debate["difficulty"] == "intermediate"
    assert debate["durationMinutes"] == 15
    assert debate["askedPosition"] == "for"
    # The app can say "we'll look this up first" before anything has run.
    assert debate["willResearch"] is True


async def test_a_conceptual_topic_is_not_researched(db: firestore.AsyncClient, api: httpx.AsyncClient) -> None:
    debate = await create_debate(api, "alice", topic="Do we have free will?")
    assert debate["willResearch"] is False


async def test_creating_the_same_debate_twice_is_safe(db: firestore.AsyncClient, api: httpx.AsyncClient) -> None:
    body = {"id": new_id(), "topic": TOPIC}
    first = await api.post(DEBATES, headers=as_user("alice"), json=body)
    second = await api.post(DEBATES, headers=as_user("alice"), json=body)
    assert first.status_code == 201 and second.status_code == 201
    assert first.json()["id"] == second.json()["id"]


async def test_one_users_debate_is_invisible_to_another(db: firestore.AsyncClient, api: httpx.AsyncClient) -> None:
    debate = await create_debate(api, "alice", topic=TOPIC)
    assert (await api.get(f"{DEBATES}/{debate['id']}", headers=as_user("bob"))).status_code == 404
    assert (await api.get(DEBATES, headers=as_user("bob"))).json() == []


async def test_settings_can_be_changed_until_the_debate_is_prepared(
    db: firestore.AsyncClient, api: httpx.AsyncClient, tasks: RecordingQueue
) -> None:
    await consent(api, "alice")
    debate = await create_debate(api, "alice", topic=TOPIC)
    updated = await api.patch(
        f"{DEBATES}/{debate['id']}",
        headers=as_user("alice"),
        json={"difficulty": "advanced", "format": "socratic", "researchEnabled": False},
    )
    assert updated.status_code == 200
    assert updated.json()["difficulty"] == "advanced"
    # Turning research off changes what would happen, and the app is told.
    assert updated.json()["willResearch"] is False

    assert (
        await api.post(f"{DEBATES}/{debate['id']}/preparations:generate", headers=as_user("alice"))
    ).status_code == 202
    await run_tasks(tasks)
    # A prepared debate is fixed: its positions have been settled and must not be re-rolled.
    refused = await api.patch(f"{DEBATES}/{debate['id']}", headers=as_user("alice"), json={"difficulty": "beginner"})
    assert refused.status_code == 409


# ---------------------------------------------------------------------------
# Preparing it


async def test_preparation_produces_a_brief_and_shows_the_user_only_their_own_side(
    db: firestore.AsyncClient, api: httpx.AsyncClient, tasks: RecordingQueue
) -> None:
    await consent(api, "alice")
    debate = await create_debate(api, "alice", topic=TOPIC, position="against", difficulty="advanced")

    started = await api.post(f"{DEBATES}/{debate['id']}/preparations:generate", headers=as_user("alice"))
    assert started.status_code == 202
    prep_id = started.json()["prepId"]
    await run_tasks(tasks)

    prep = (await api.get(f"{DEBATES}/{debate['id']}/preparations/{prep_id}", headers=as_user("alice"))).json()
    assert prep["status"] == "ready"
    assert prep["userPosition"] == "against"
    assert prep["aiPosition"] == "for"
    assert prep["topicContext"]
    assert prep["concepts"]
    # §10: what they should be ready to defend, the concepts, the evidence, where they will
    # be pressed — and nothing that amounts to the opponent's script.
    assert prep["yourArguments"]
    assert prep["challengeAreas"]
    assert "argumentsFor" not in prep
    assert "argumentsAgainst" not in prep
    assert "materialClaims" not in prep
    # Facts carry what kind of claim each one is, so nothing reads as settled that is not.
    assert {f["claimType"] for f in prep["keyFacts"]} <= {
        "fact", "source_based", "argument", "interpretation", "opinion"
    }
    # A motion that needed research has its sources, ranked with primary and academic first.
    assert prep["researchEnabled"] is True
    assert prep["sources"]
    assert [s["tier"] for s in prep["sources"]] == sorted(s["tier"] for s in prep["sources"])

    # The debate now knows which side everyone is on, so the app can start it.
    after = (await api.get(f"{DEBATES}/{debate['id']}", headers=as_user("alice"))).json()
    assert after["status"] == "ready"
    assert after["userPosition"] == "against" and after["aiPosition"] == "for"
    assert after["activePrepId"] == prep_id


async def test_a_randomised_position_is_settled_once_and_never_re_rolled(
    db: firestore.AsyncClient, api: httpx.AsyncClient, tasks: RecordingQueue
) -> None:
    await consent(api, "alice")
    debate = await create_debate(api, "alice", topic=TOPIC, positionMode="random")
    started = await api.post(f"{DEBATES}/{debate['id']}/preparations:generate", headers=as_user("alice"))
    await run_tasks(tasks)
    settled = (await api.get(f"{DEBATES}/{debate['id']}", headers=as_user("alice"))).json()
    assert settled["userPosition"] in ("for", "against")
    assert settled["aiPosition"] != settled["userPosition"]

    # Preparing again keeps the side they were given.
    again = await api.post(f"{DEBATES}/{debate['id']}/preparations:generate", headers=as_user("alice"))
    assert again.status_code == 202
    await run_tasks(tasks)
    assert (await api.get(f"{DEBATES}/{debate['id']}", headers=as_user("alice"))).json()["userPosition"] == (
        settled["userPosition"]
    )
    assert started.json()["prepId"] != again.json()["prepId"]


async def test_debating_from_material_finds_the_motion_in_the_documents(
    db: firestore.AsyncClient, api: httpx.AsyncClient, tasks: RecordingQueue
) -> None:
    """§4, third way in: no topic at all, just documents."""
    await consent(api, "alice")
    debate = await create_debate(api, "alice")
    assert debate["topic"] == ""

    added = await api.post(
        f"{DEBATES}/{debate['id']}/materials/text",
        headers=as_user("alice"),
        json={"id": new_id(), "title": "Policy paper", "text": "The paper argues " + ("for the policy. " * 60)},
    )
    assert added.status_code == 201
    assert added.json()["status"] == "ready"
    assert (await api.get(f"{DEBATES}/{debate['id']}", headers=as_user("alice"))).json()["materialCount"] == 1

    started = await api.post(f"{DEBATES}/{debate['id']}/preparations:generate", headers=as_user("alice"))
    assert started.status_code == 202
    await run_tasks(tasks)
    prep = (
        await api.get(f"{DEBATES}/{debate['id']}/preparations/{started.json()['prepId']}", headers=as_user("alice"))
    ).json()
    assert prep["status"] == "ready"
    assert prep["motion"]
    assert prep["materialSummary"]

    # The retrievable records are stored for the debate but never sent to the app.
    stored = (
        await db.document(f"users/alice/debates/{debate['id']}/preparations/{started.json()['prepId']}").get()
    ).to_dict() or {}
    assert stored["materialClaims"]
    assert stored["materialNames"]


async def test_preparing_with_neither_a_topic_nor_material_is_refused(
    db: firestore.AsyncClient, api: httpx.AsyncClient
) -> None:
    await consent(api, "alice")
    debate = await create_debate(api, "alice")
    response = await api.post(f"{DEBATES}/{debate['id']}/preparations:generate", headers=as_user("alice"))
    assert response.status_code == 400


async def test_two_preparations_at_once_are_refused(
    db: firestore.AsyncClient, api: httpx.AsyncClient, tasks: RecordingQueue
) -> None:
    await consent(api, "alice")
    debate = await create_debate(api, "alice", topic=TOPIC)
    assert (
        await api.post(f"{DEBATES}/{debate['id']}/preparations:generate", headers=as_user("alice"))
    ).status_code == 202
    assert (
        await api.post(f"{DEBATES}/{debate['id']}/preparations:generate", headers=as_user("alice"))
    ).status_code == 409


async def test_deleting_a_debate_takes_its_materials_and_briefs_with_it(
    db: firestore.AsyncClient, api: httpx.AsyncClient, tasks: RecordingQueue
) -> None:
    await consent(api, "alice")
    debate = await create_debate(api, "alice", topic=TOPIC)
    await api.post(
        f"{DEBATES}/{debate['id']}/materials/text",
        headers=as_user("alice"),
        json={"id": new_id(), "text": "Something to debate. " * 20},
    )
    await api.post(f"{DEBATES}/{debate['id']}/preparations:generate", headers=as_user("alice"))
    await run_tasks(tasks)

    assert (await api.delete(f"{DEBATES}/{debate['id']}", headers=as_user("alice"))).status_code == 204
    assert (
        [s async for s in db.collection(f"users/alice/debates/{debate['id']}/materials").stream()] == []
    )
    assert (
        [s async for s in db.collection(f"users/alice/debates/{debate['id']}/preparations").stream()] == []
    )


# ---------------------------------------------------------------------------
# Starting the debate


async def test_a_debate_can_be_entered_immediately_from_a_topic(
    db: firestore.AsyncClient, api: httpx.AsyncClient
) -> None:
    """§32: no practice-centre sequence, no preparation step required."""
    await consent(api, "alice")
    created = await api.post(
        SESSIONS, headers=as_user("alice"), json={"id": new_id(), "topic": TOPIC, "position": "for"}
    )
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["motion"] == TOPIC
    assert body["userPosition"] == "for" and body["aiPosition"] == "against"
    assert body["liveUrl"].endswith("/live")
    assert body["opponentName"]

    session = (await db.document(f"users/alice/sessions/{body['id']}").get()).to_dict() or {}
    assert session["module"] == "debate"
    # Nothing was looked up, and the session records that so the opponent argues from
    # principle rather than citing facts it cannot have.
    assert session["context"]["researchEnabled"] is False
    assert session["context"]["researchSkipped"] is True


async def test_a_session_from_a_prepared_debate_takes_the_motion_and_sides_from_the_brief(
    db: firestore.AsyncClient, api: httpx.AsyncClient, tasks: RecordingQueue
) -> None:
    await consent(api, "alice")
    debate = await create_debate(api, "alice", topic=TOPIC, position="against")
    await api.post(f"{DEBATES}/{debate['id']}/preparations:generate", headers=as_user("alice"))
    await run_tasks(tasks)

    created = await api.post(SESSIONS, headers=as_user("alice"), json={"id": new_id(), "debateId": debate["id"]})
    assert created.status_code == 201, created.text
    assert created.json()["userPosition"] == "against"
    assert created.json()["aiPosition"] == "for"
    session = (await db.document(f"users/alice/sessions/{created.json()['id']}").get()).to_dict() or {}
    assert session["context"]["prepId"] == debate["id"] or session["context"]["prepId"]
    assert session["context"]["researchEnabled"] is True


async def test_a_debate_that_was_never_prepared_cannot_be_started_from_its_brief(
    db: firestore.AsyncClient, api: httpx.AsyncClient
) -> None:
    await consent(api, "alice")
    debate = await create_debate(api, "alice", topic=TOPIC)
    response = await api.post(SESSIONS, headers=as_user("alice"), json={"id": new_id(), "debateId": debate["id"]})
    assert response.status_code == 409


async def test_starting_with_no_topic_at_all_is_refused(
    db: firestore.AsyncClient, api: httpx.AsyncClient
) -> None:
    await consent(api, "alice")
    assert (await api.post(SESSIONS, headers=as_user("alice"), json={"id": new_id()})).status_code == 400


async def test_recording_consent_is_required_before_a_debate(
    db: firestore.AsyncClient, api: httpx.AsyncClient
) -> None:
    response = await api.post(SESSIONS, headers=as_user("alice"), json={"id": new_id(), "topic": TOPIC})
    assert response.status_code == 403


# ---------------------------------------------------------------------------
# Debating again (§31)


async def _finished_debate(api: httpx.AsyncClient, db: firestore.AsyncClient, uid: str) -> str:
    await consent(api, uid)
    created = await api.post(
        SESSIONS,
        headers=as_user(uid),
        json={"id": new_id(), "topic": TOPIC, "position": "for", "difficulty": "beginner"},
    )
    session_id = created.json()["id"]
    await db.document(f"users/{uid}/sessions/{session_id}").set(
        {"nextPractice": {"harderDifficulty": "intermediate", "suggestedFocus": "evidence"}}, merge=True
    )
    return session_id


async def test_the_same_motion_from_the_other_side_needs_no_new_preparation(
    db: firestore.AsyncClient, api: httpx.AsyncClient
) -> None:
    session_id = await _finished_debate(api, db, "alice")
    again = await api.post(
        f"{SESSIONS}/{session_id}/again", headers=as_user("alice"), json={"id": new_id(), "mode": "switch"}
    )
    assert again.status_code == 201, again.text
    assert again.json()["userPosition"] == "against"
    assert again.json()["aiPosition"] == "for"
    assert again.json()["motion"] == TOPIC
    new_session = (await db.document(f"users/alice/sessions/{again.json()['id']}").get()).to_dict() or {}
    assert new_session["retryOfSessionId"] == session_id
    assert new_session["attemptNo"] == 2
    # A different side makes the previous attempt's targets the wrong ones to aim at.
    assert not new_session["retryTargets"]


async def test_a_harder_opponent_steps_the_difficulty_up(
    db: firestore.AsyncClient, api: httpx.AsyncClient
) -> None:
    session_id = await _finished_debate(api, db, "alice")
    again = await api.post(
        f"{SESSIONS}/{session_id}/again", headers=as_user("alice"), json={"id": new_id(), "mode": "harder"}
    )
    assert again.json()["difficulty"] == "intermediate"


async def test_focus_practice_uses_what_the_debate_showed_when_no_focus_is_named(
    db: firestore.AsyncClient, api: httpx.AsyncClient
) -> None:
    session_id = await _finished_debate(api, db, "alice")
    again = await api.post(
        f"{SESSIONS}/{session_id}/again", headers=as_user("alice"), json={"id": new_id(), "mode": "focus"}
    )
    assert again.status_code == 201, again.text
    session = (await db.document(f"users/alice/sessions/{again.json()['id']}").get()).to_dict() or {}
    assert session["context"]["focus"] == "evidence"


async def test_debating_the_same_thing_again_keeps_the_retry_targets(
    db: firestore.AsyncClient, api: httpx.AsyncClient
) -> None:
    session_id = await _finished_debate(api, db, "alice")
    await db.document(f"users/alice/sessions/{session_id}").set(
        {"retryPlan": {"competencyNames": ["Use of evidence"]}}, merge=True
    )
    again = await api.post(
        f"{SESSIONS}/{session_id}/again", headers=as_user("alice"), json={"id": new_id(), "mode": "again"}
    )
    session = (await db.document(f"users/alice/sessions/{again.json()['id']}").get()).to_dict() or {}
    assert session["retryTargets"] == {"competencyNames": ["Use of evidence"]}


async def test_another_users_debate_cannot_be_restarted(
    db: firestore.AsyncClient, api: httpx.AsyncClient
) -> None:
    session_id = await _finished_debate(api, db, "alice")
    await consent(api, "bob")
    response = await api.post(
        f"{SESSIONS}/{session_id}/again", headers=as_user("bob"), json={"id": new_id(), "mode": "again"}
    )
    assert response.status_code == 404


# ---------------------------------------------------------------------------
# The live loop


async def test_the_observer_keeps_state_across_turns_and_steers_the_opponent(
    db: firestore.AsyncClient, api: httpx.AsyncClient, tasks: RecordingQueue
) -> None:
    """The loop of §34, driven the way the live gateway drives it.

    The gateway hands the observer each turn as it is written and sends back whatever note
    it returns. Here the turns are scripted, so what is being tested is that the state
    accumulates, the note is silent (it is for the turn after the user speaks), and the
    opponent is told what it must not lose.
    """
    await consent(api, "alice")
    debate = await create_debate(api, "alice", topic=TOPIC, position="for", difficulty="advanced")
    await api.post(f"{DEBATES}/{debate['id']}/preparations:generate", headers=as_user("alice"))
    await run_tasks(tasks)
    created = await api.post(SESSIONS, headers=as_user("alice"), json={"id": new_id(), "debateId": debate["id"]})
    session_id = created.json()["id"]
    session = (await db.document(f"users/alice/sessions/{session_id}").get()).to_dict() or {}

    observer = DebateTurnObserver()
    state: dict | None = None
    remaining = 15 * 60_000

    async def turn(speaker: str, text: str, at_ms: int):  # type: ignore[no-untyped-def]
        nonlocal state, remaining
        direction = await observer.on_turn(
            uid="alice", session_id=session_id, session=session, speaker=speaker,  # type: ignore[arg-type]
            text=text, at_ms=at_ms, time_remaining_ms=remaining, state=state, dropped_last=False,
        )
        if direction.state is not None:
            state = direction.state
        remaining -= 30_000
        return direction

    # The opponent opens; no user turn has happened, so there is nothing to analyse yet.
    opening = await turn("interviewer", "I'm arguing against the motion. My position is that the cost falls on "
                                        "the smallest operators. Over to you.", 0)
    assert opening.note is not None
    assert opening.silent is True

    # The user argues. The gateway writes it, and the observer holds it.
    held = await turn("candidate", "Regulation protects consumers because they cannot assess these risks "
                                   "themselves. That is why it is necessary.", 20_000)
    assert held.note is None

    # The opponent speaks again: now the held turn is analysed, the state grows, and the
    # note for the turn after that is produced.
    steered = await turn("interviewer", "What makes you confident that consumers cannot assess the risks?", 40_000)
    assert steered.note is not None and steered.silent is True
    assert "not spoken by your opponent" in steered.note

    from app.modules.debate.state import DebateState

    tracked = DebateState.from_doc((state or {}).get("debate"))
    assert tracked.side_arguments(Side.USER), "the user's argument was not recorded"
    assert tracked.side_arguments(Side.AI), "the opponent's own argument was not recorded"
    assert tracked.turn >= 3

    # A second exchange: the opponent's objection is on the record, so it is not asked again.
    await turn("candidate", "Studies show consumers systematically misjudge algorithmic risk.", 60_000)
    await turn("interviewer", "Does that hold outside the cases those studies looked at?", 80_000)
    tracked = DebateState.from_doc((state or {}).get("debate"))
    assert len([c for c in tracked.challenges if c.by is Side.AI]) >= 1
    assert tracked.topics_covered

    # What the evaluator and the argument map will read.
    final = await observer.on_end(uid="alice", session_id=session_id, state=state)
    assert final is not None
    assert final["summary"]["userArguments"] >= 1
    stored = {"context": session["context"], "moduleState": final}
    assert debate_state_of(stored).side_arguments(Side.USER)


async def test_a_dropped_connection_resumes_into_the_same_argument(
    db: firestore.AsyncClient, api: httpx.AsyncClient
) -> None:
    """The state travels in the live-session document, so a reconnect is mid-argument."""
    await consent(api, "alice")
    created = await api.post(
        SESSIONS, headers=as_user("alice"), json={"id": new_id(), "topic": TOPIC, "position": "for"}
    )
    session_id = created.json()["id"]
    session = (await db.document(f"users/alice/sessions/{session_id}").get()).to_dict() or {}

    before = DebateTurnObserver()
    state: dict | None = None
    for speaker, text, at_ms in (
        ("interviewer", "I argue against. My reason is the compliance cost.", 0),
        ("candidate", "Regulation protects consumers who cannot judge the risk themselves.", 20_000),
        ("interviewer", "What supports the claim that they cannot judge it?", 40_000),
    ):
        direction = await before.on_turn(
            uid="alice", session_id=session_id, session=session, speaker=speaker,  # type: ignore[arg-type]
            text=text, at_ms=at_ms, time_remaining_ms=600_000, state=state, dropped_last=False,
        )
        state = direction.state or state

    # A new observer — a different Cloud Run instance — picks the same debate up.
    after = DebateTurnObserver()
    resumed = await after.on_turn(
        uid="alice", session_id=session_id, session=session, speaker="candidate",
        text="Because the harms are statistical and only show up at scale.", at_ms=60_000,
        time_remaining_ms=570_000, state=state, dropped_last=True,
    )
    followed = await after.on_turn(
        uid="alice", session_id=session_id, session=session, speaker="interviewer",
        text="Granted, but that does not show regulation is the remedy.", at_ms=80_000,
        time_remaining_ms=540_000, state=resumed.state, dropped_last=True,
    )
    from app.modules.debate.state import DebateState

    tracked = DebateState.from_doc((followed.state or {}).get("debate"))
    # Everything from before the drop is still there.
    assert len(tracked.side_arguments(Side.USER)) >= 1
    assert len(tracked.side_arguments(Side.AI)) >= 1
    assert followed.note is not None
    # And the opponent is told the reply nobody heard does not count as a point made.
    assert "did not reach your opponent" in followed.note or "reached your opponent" in followed.note
