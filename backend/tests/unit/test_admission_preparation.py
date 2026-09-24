from __future__ import annotations

from app.modules.admission.preparation import (
    ConcernDraft,
    DifferentiatorDraft,
    PreparationDraft,
    QuestionCategory,
    QuestionDraft,
    StoryDraft,
    validate_preparation,
)

CLAIMS = (
    "Built a crop-disease classifier for smallholder farms",
    "BSc in Mechanical Engineering",
)


def question(**over: object) -> QuestionDraft:
    base: dict[str, object] = {
        "text": "Why this university rather than one closer to home?",
        "category": "personalized",
        "why": ["The programme weights research", "Their study plan proposes field trials"],
        "prepare": ["Two specific features of the programme", "How each connects to the classifier project"],
    }
    base.update(over)
    return QuestionDraft(**base)  # type: ignore[arg-type]


def test_a_grounded_question_keeps_its_reasons_and_its_category() -> None:
    plan, problems = validate_preparation(PreparationDraft(questions=[question(), question(), question()]))

    assert plan.questions_in(QuestionCategory.PERSONALIZED)
    assert plan.questions[0].why[0] == "The programme weights research"
    assert problems == []


def test_a_question_claiming_support_it_does_not_have_is_demoted_not_dropped() -> None:
    """The category is a claim about evidence; the question itself may still be worth asking."""
    plan, problems = validate_preparation(
        PreparationDraft(questions=[question(category="very_likely", why=[]), question(), question()])
    )

    assert plan.questions[0].category is QuestionCategory.LIKELY
    assert any("nothing behind it" in p for p in problems)


def test_a_follow_up_needs_no_reason_because_it_claims_none() -> None:
    plan, _ = validate_preparation(
        PreparationDraft(
            questions=[
                question(text="Can you give a concrete example?", category="follow_up", why=[]),
                question(),
                question(),
            ]
        )
    )

    assert plan.questions[0].category is QuestionCategory.FOLLOW_UP


def test_generic_advice_is_refused_wherever_it_appears() -> None:
    """§17 names these, and they are also what a model writes when it has nothing to say."""
    plan, problems = validate_preparation(
        PreparationDraft(
            questions=[
                question(prepare=["Be confident", "Two specific features of the programme"]),
                question(),
                question(),
            ]
        )
    )

    assert plan.questions[0].prepare == ("Two specific features of the programme",)
    assert any("generic advice" in p for p in problems)


def test_a_differentiator_must_rest_on_something_the_candidate_actually_has() -> None:
    """Flattery is the failure here: told they stand out for passion, they have no example."""
    plan, problems = validate_preparation(
        PreparationDraft(
            questions=[question(), question(), question()],
            differentiators=[
                DifferentiatorDraft(text="Your passion for development", why="The scholarship values impact"),
                DifferentiatorDraft(
                    text="Engineering plus field-level agriculture",
                    why="The programme wants applied research",
                    evidence=["Built a crop-disease classifier for smallholder farms"],
                    where=["Questions about contribution"],
                ),
            ],
        ),
        candidate_claims=CLAIMS,
    )

    assert [d.text for d in plan.differentiators] == ["Engineering plus field-level agriculture"]
    assert any("rests on nothing in the candidate's own profile" in p for p in problems)


def test_a_differentiator_citing_evidence_nobody_can_check_is_dropped() -> None:
    plan, problems = validate_preparation(
        PreparationDraft(
            questions=[question(), question(), question()],
            differentiators=[DifferentiatorDraft(text="Rare combination", evidence=["Published in Nature"])],
        ),
        candidate_claims=CLAIMS,
    )

    assert plan.differentiators == []
    assert any("rests on nothing" in p for p in problems)


def test_nothing_may_claim_an_attribute_caused_a_selection() -> None:
    plan, problems = validate_preparation(
        PreparationDraft(
            questions=[
                question(text="What guarantees selection for this award?", why=["x"]),
                question(),
                question(),
            ]
        )
    )

    assert all("guarantees selection" not in q.text for q in plan.questions)
    assert any("causation" in p or "caused" in p for p in problems)


def test_a_concern_may_point_at_an_absence_and_is_kept() -> None:
    plan, _ = validate_preparation(
        PreparationDraft(
            questions=[question(), question(), question()],
            concerns=[
                ConcernDraft(
                    text="The study plan does not name a supervisor or lab",
                    why="The programme asks applicants to identify a research group",
                    prepare=["Name one group and why its work fits"],
                )
            ],
        )
    )

    assert plan.concerns[0].prepare == ("Name one group and why its work fits",)


def test_the_story_keeps_the_joins_the_file_does_not_make() -> None:
    plan, _ = validate_preparation(
        PreparationDraft(
            questions=[question(), question(), question()],
            story=StoryDraft(
                past="Mechanical engineering",
                present="Agricultural AI projects",
                program="MSc in machine learning",
                future="Applied research at home",
                missingLinks=["Nothing in the file explains the move from mechanical engineering to AI"],
            ),
        )
    )

    assert not plan.story.is_empty()
    assert plan.story.missingLinks[0].startswith("Nothing in the file explains")


def test_too_little_to_prepare_with_says_so() -> None:
    plan, problems = validate_preparation(PreparationDraft(questions=[question()]))

    assert plan.is_thin()
    assert any("too little" in p for p in problems)
