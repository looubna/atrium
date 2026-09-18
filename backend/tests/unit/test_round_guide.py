from __future__ import annotations

import pytest

from app.modules.interview.prep import (
    AskDraft,
    PrepGuideDraft,
    PrepQuestionDraft,
    StandOutDraft,
    guide_content,
    validate_guide,
)

ROUND = {
    "id": "r01aaaaaaaa", "type": "behavioral", "title": "Values interview", "competencyIds": [],
    "reportedQuestions": [{"text": "Why do you want to join us?", "sourceIds": ["src1"]}],
    "questionFamilies": [{"name": "Ownership", "description": "Owning outcomes", "exampleQuestions": ["Tell me..."]}],
}


def question(text: str, reported: bool) -> PrepQuestionDraft:
    return PrepQuestionDraft(question=text, reported=reported, assesses="Motivation", outline=["a", "b", "c"],
                             sampleAnswer="In my role at [company] I led ...", resumeHook="", pitfalls=["Vague"])


def draft(*questions: PrepQuestionDraft) -> PrepGuideDraft:
    return PrepGuideDraft(
        approach="Be concrete.", questions=list(questions),
        standOut=[StandOutDraft(title="Plan", idea="Bring a plan", how="One page", why="Shows intent", effort="prep"),
                  StandOutDraft(title=" ", idea="", how="", why="", effort="quick")],
        questionsToAsk=[AskDraft(question="What does success look like?", why="Impact")],
    )


def test_only_questions_the_journey_reported_are_marked_reported() -> None:
    guide = validate_guide(
        draft(
            question("Tell me about a conflict.", True),  # claimed, but nobody reported it
            question("why do you want to join us?", False),  # the reported one, in other words' case
            question("Tell me about a conflict", False),  # a near-duplicate
        ),
        ROUND, {"src1": "glassdoor.com"},
    )
    assert [q["question"] for q in guide["questions"]] == ["why do you want to join us?", "Tell me about a conflict."]
    assert guide["questions"][0]["reported"] is True and guide["questions"][0]["sources"] == ["glassdoor.com"]
    assert guide["questions"][1]["reported"] is False and guide["questions"][1]["sources"] == []
    assert [i["title"] for i in guide["standOut"]] == ["Plan"]


def test_a_guide_without_questions_is_rejected() -> None:
    with pytest.raises(ValueError):
        validate_guide(draft(), ROUND, {})


def test_the_writer_sees_the_job_resume_research_and_round_as_data() -> None:
    content = guide_content(
        {"company": "Acme", "roleTitle": "PM", "jobDescription": "Own the roadmap."},
        {"research": {"text": "Acme launched a new app in 2026."}, "companySummary": "Fintech"},
        ROUND, {"summary": "Product manager, 6 years"},
    )
    assert "<resume>" in content and "Product manager, 6 years" in content
    assert "Acme launched a new app" in content and "Why do you want to join us?" in content
    assert "(no resume provided)" in guide_content({}, {}, ROUND, None)
