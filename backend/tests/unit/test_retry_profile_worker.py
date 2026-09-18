from __future__ import annotations

import base64
import json
import time
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.core.settings import get_settings
from app.modules.interview.retry import build_retry_plan
from app.platform.competencies.profile import pick_previous, weighted_current
from app.platform.feedback.schemas import Category, CompetencyScore, Confidence, QuestionClassification
from app.platform.storage.signing import _local_signature, verify_local_signature
from app.platform.transcripts.model import Segment, Transcript


def score(cid: str, value: int, confidence: Confidence = Confidence.MEDIUM) -> CompetencyScore:
    category = Category.COMMUNICATION if cid.startswith("comm.") else Category.ROUND
    return CompetencyScore(competencyId=cid, category=category, score=value, confidence=confidence, rationale="")


def test_retry_plan_targets_weak_confident_competencies_with_new_questions() -> None:
    transcript = Transcript(duration_ms=60_000, segments=[
        Segment(id="s0001", speaker="interviewer", start_ms=0, end_ms=2000, text="Tell me about a difficult project."),
        Segment(id="s0002", speaker="candidate", start_ms=2500, end_ms=9000, text="..."),
        Segment(id="s0003", speaker="interviewer", start_ms=9500, end_ms=11000, text="Why this company?"),
    ])
    plan = build_retry_plan(
        [
            score("interview.behavioral.answer_structure", 61),
            score("comm.pace", 40, Confidence.LOW),  # too little evidence to target
            score("comm.structure", 70),
            score("interview.behavioral.motivation", 90),
        ],
        [
            QuestionClassification(segmentId="s0001", questionFamily="difficult project",
                                   competencyIds=["interview.behavioral.answer_structure"]),
            QuestionClassification(segmentId="s0003", questionFamily="motivation",
                                   competencyIds=["interview.behavioral.motivation"]),
        ],
        transcript,
        {"excludeQuestions": ["Why us?", "Tell me about a difficult project."]},
    )
    assert plan["competencyIds"] == ["interview.behavioral.answer_structure", "comm.structure"]
    assert plan["competencyNames"] == ["Answer structure", "Answer structure"]
    assert plan["questionFamilies"] == ["difficult project"]
    assert plan["excludeQuestions"] == ["Why us?", "Tell me about a difficult project.", "Why this company?"]


def test_profile_weighting_and_previous_attempt_choice() -> None:
    entries: list[dict[str, Any]] = [
        {"score": 80, "confidence": "high", "sessionId": "new", "context": {"roundId": "r1", "applicationId": "a1"}},
        {"score": 50, "confidence": "low", "sessionId": "s3", "context": {"roundId": "r1", "applicationId": "a1"}},
        {"score": 60, "confidence": "medium", "sessionId": "s2", "context": {"roundId": "r9", "applicationId": "a1"}},
        {"score": 70, "confidence": "medium", "sessionId": "s1", "context": {"roundId": "r1", "applicationId": "a1"}},
    ]
    assert weighted_current(entries) == round((80 * 1 + 50 * 0.35 + 60 * 0.7 + 70 * 0.7) / 2.75)
    assert pick_previous(entries, "new", {"roundId": "r1", "applicationId": "a1"})["sessionId"] == "s1"
    assert pick_previous(entries, "new", {"practice": "general_behavioral"})["sessionId"] == "s2"
    assert pick_previous(entries[:1], "new", {}) is None
    assert weighted_current([]) == 0


def test_local_signed_links_expire_and_resist_tampering() -> None:
    expires = int(time.time()) + 60
    sig = _local_signature("bucket", "users/a/audio.m4a", expires, "inline")
    assert verify_local_signature("bucket", "users/a/audio.m4a", expires, "inline", sig)
    assert not verify_local_signature("bucket", "users/b/audio.m4a", expires, "inline", sig)
    assert not verify_local_signature("bucket", "users/a/audio.m4a", expires, "attachment", sig)
    past = int(time.time()) - 1
    assert not verify_local_signature("bucket", "users/a/audio.m4a", past, "inline",
                                      _local_signature("bucket", "users/a/audio.m4a", past, "inline"))


# Worker OIDC verification is covered in test_worker_auth.py.


def test_budget_event_trips_kill_switch(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ROLE", "worker")
    get_settings.cache_clear()
    from app.main import create_app
    from app.platform.jobs import worker_api

    calls: list[tuple[bool, str]] = []

    async def fake_set(enabled: bool, reason: str) -> None:
        calls.append((enabled, reason))

    monkeypatch.setattr(worker_api, "set_ai_enabled", fake_set)
    with TestClient(create_app()) as client:
        def push(cost: float, budget: float) -> dict[str, Any]:
            data = base64.b64encode(json.dumps({"costAmount": cost, "budgetAmount": budget}).encode()).decode()
            response = client.post("/internal/events/budget", json={"message": {"data": data}})
            assert response.status_code == 200
            return response.json()

        assert push(30_000, 70_000) == {"status": "ok"}
        assert push(71_000, 70_000) == {"status": "ai_disabled"}
        assert client.post("/internal/events/budget", json={"message": {"data": "!!"}}).json() == {"status": "ignored"}
    assert calls == [(False, "budget exceeded: 71000 of 70000")]
