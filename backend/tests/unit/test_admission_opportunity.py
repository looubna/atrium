from __future__ import annotations

import pytest

from app.modules.admission.catalogs import EvidenceTier, OpportunityKind
from app.modules.admission.evidence import InsightDraft, SourceDraft
from app.modules.admission.opportunity import (
    STANDING_CAVEAT,
    OpportunityDraft,
    OpportunityRejected,
    TopicDraft,
    validate_opportunity,
)


def sources() -> list[SourceDraft]:
    return [
        SourceDraft(id="s1", title="GKS guidelines", domain="gks.go.kr", tier="official", published="2026"),
        SourceDraft(id="s2", title="My GKS interview", domain="reddit.com", tier="reported", published="2025"),
    ]


def draft(**over: object) -> OpportunityDraft:
    base: dict[str, object] = {
        "name": "Global Korea Scholarship",
        "kind": "both",
        "cycle": "2026",
        "summary": "A Korean government scholarship for graduate study.",
        "officialRequirements": [InsightDraft(text="Applicants must be under 25.", tier="official", sourceIds=["s1"])],
        "selectionCriteria": [InsightDraft(text="Academic record is weighted.", tier="official", sourceIds=["s1"])],
        "sources": sources(),
    }
    base.update(over)
    return OpportunityDraft(**base)  # type: ignore[arg-type]


class TestRejection:
    def test_a_profile_with_no_sources_is_refused(self) -> None:
        with pytest.raises(OpportunityRejected):
            validate_opportunity(draft(sources=[]))

    def test_a_profile_with_no_name_is_refused(self) -> None:
        with pytest.raises(OpportunityRejected):
            validate_opportunity(draft(name="   "))


class TestSelectedCandidatePatterns:
    """The most dangerous object in the module, per the module docstring."""

    def test_an_unsourced_pattern_is_deleted_not_demoted(self) -> None:
        profile, problems = validate_opportunity(
            draft(
                selectedCandidatePatterns=[
                    InsightDraft(text="Several recipients mention research experience.", tier="reported", sourceIds=[]),
                ]
            )
        )
        assert profile.selectedCandidatePatterns == []
        assert any("unsourced claim about selected candidates" in p for p in problems)

    def test_a_sourced_pattern_survives_and_drags_the_caveat_with_it(self) -> None:
        profile, _ = validate_opportunity(
            draft(
                selectedCandidatePatterns=[
                    InsightDraft(
                        text="Several accounts describe published research.", tier="reported", sourceIds=["s2"]
                    )
                ]
            )
        )
        assert len(profile.selectedCandidatePatterns) == 1
        assert profile.caveats[0] == STANDING_CAVEAT

    def test_no_patterns_means_no_caveat_about_patterns(self) -> None:
        profile, _ = validate_opportunity(draft())
        assert STANDING_CAVEAT not in profile.caveats

    def test_a_pattern_cannot_claim_the_funder_published_it(self) -> None:
        profile, problems = validate_opportunity(
            draft(
                selectedCandidatePatterns=[
                    InsightDraft(text="Recipients tend to have leadership roles.", tier="official", sourceIds=["s1"])
                ]
            )
        )
        assert profile.selectedCandidatePatterns[0].tier is EvidenceTier.REPORTED
        assert any("claimed to be official" in p for p in problems)

    def test_a_causal_pattern_never_reaches_the_profile(self) -> None:
        profile, problems = validate_opportunity(
            draft(
                selectedCandidatePatterns=[
                    InsightDraft(
                        text="They were selected because they had publications.", tier="reported", sourceIds=["s2"]
                    )
                ]
            )
        )
        assert profile.selectedCandidatePatterns == []
        assert any("causation" in p for p in problems)


class TestTopics:
    def test_topics_are_ordered_by_how_many_people_remember_being_asked(self) -> None:
        profile, _ = validate_opportunity(
            draft(
                interviewTopics=[
                    TopicDraft(text="Why this university?", tier="reported", sourceIds=["s2"], accounts=2),
                    TopicDraft(text="Why Korea?", tier="reported", sourceIds=["s2"], accounts=9),
                    TopicDraft(text="Your study plan", tier="official", sourceIds=["s1"], accounts=0),
                ]
            )
        )
        assert [t.text for t in profile.interviewTopics] == ["Why Korea?", "Why this university?", "Your study plan"]

    def test_a_topic_with_a_bad_count_is_clamped_rather_than_crashing(self) -> None:
        profile, _ = validate_opportunity(
            draft(interviewTopics=[TopicDraft(text="Why Korea?", tier="reported", sourceIds=["s2"], accounts=-4)])
        )
        assert profile.interviewTopics[0].accounts == 0


class TestProfile:
    def test_it_keeps_the_cycle_and_reports_a_missing_one(self) -> None:
        profile, problems = validate_opportunity(draft(cycle=""))
        assert profile.cycle == ""
        assert any("names no application cycle" in p for p in problems)

    def test_it_knows_when_research_found_too_little_to_prepare_anyone(self) -> None:
        thin, _ = validate_opportunity(draft(officialRequirements=[], selectionCriteria=[]))
        assert thin.is_thin()
        full, _ = validate_opportunity(draft())
        assert not full.is_thin()

    def test_kind_and_sources_survive_validation(self) -> None:
        profile, _ = validate_opportunity(draft())
        assert profile.kind is OpportunityKind.BOTH
        assert set(profile.sources) == {"s1", "s2"}
        assert profile.sources["s1"]["domain"] == "gks.go.kr"
