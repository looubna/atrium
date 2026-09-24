from __future__ import annotations

import pytest

from app.modules.admission.catalogs import (
    ADMISSION_COMPETENCIES,
    PHASE_ORDER,
    PHASE_WEIGHT,
    EvidenceTier,
    OpportunityKind,
    Phase,
    competencies_for_kind,
    parse_kind,
    parse_material_type,
    parse_tier,
)
from app.modules.admission.evidence import (
    InsightDraft,
    SourceDraft,
    integrity_problems,
    validate_insight,
    validate_sources,
)

SOURCES = {"s1", "s2"}


class TestIntegrity:
    """The claims nobody can support, which the model has every incentive to write anyway."""

    @pytest.mark.parametrize(
        "text",
        [
            "They were accepted because they had two publications.",
            "Several recipients had research experience, and that is why they were selected.",
            "Strong Korean led to their selection.",
            "A publication guarantees your place.",
            "This combination will get you a scholarship.",
            "Research experience is the key to being selected.",
            "She was awarded thanks to her volunteering.",
        ],
    )
    def test_rejects_claims_that_an_attribute_caused_selection(self, text: str) -> None:
        assert integrity_problems(text), f"should have been refused: {text}"

    @pytest.mark.parametrize(
        "text",
        [
            "Copy the selected candidates' answers.",
            "Imitate successful applicants when describing your motivation.",
            "Do what they did and you will be fine.",
        ],
    )
    def test_rejects_telling_the_candidate_to_imitate_others(self, text: str) -> None:
        assert integrity_problems(text)

    @pytest.mark.parametrize(
        "text",
        [
            "Several publicly shared selected-candidate profiles mention research experience.",
            "The official guidelines require a study plan of no more than two pages.",
            "Candidates who described their interview were asked why they chose Korea.",
            "Your mechanical engineering background and your AI projects are both relevant here.",
        ],
    )
    def test_allows_attributed_observation(self, text: str) -> None:
        assert integrity_problems(text) == []


class TestInsightValidation:
    def test_official_insight_keeps_its_sources(self) -> None:
        insight, problems = validate_insight(
            InsightDraft(text="The interview is held in English.", tier="official", sourceIds=["s1"], cycle="2026"),
            SOURCES,
        )
        assert insight is not None
        assert insight.tier is EvidenceTier.OFFICIAL
        assert insight.sourceIds == ("s1",)
        assert insight.cycle == "2026"
        assert problems == []

    def test_uncited_official_claim_is_demoted_not_trusted(self) -> None:
        """The citation is the only thing separating a requirement from a guess."""
        insight, problems = validate_insight(
            InsightDraft(text="Applicants must hold TOPIK level 4.", tier="official", sourceIds=[]), SOURCES
        )
        assert insight is not None
        assert insight.tier is EvidenceTier.INFERENCE
        assert problems and "cites no retrievable source" in problems[0]

    def test_invented_citations_are_dropped_and_reported(self) -> None:
        insight, problems = validate_insight(
            InsightDraft(text="The panel has three members.", tier="reported", sourceIds=["s1", "s9"]), SOURCES
        )
        assert insight is not None
        assert insight.sourceIds == ("s1",)
        assert any("never retrieved" in p for p in problems)

    def test_an_inference_may_not_cite_a_source_it_was_not_read_in(self) -> None:
        insight, _ = validate_insight(
            InsightDraft(text="You may be asked about your career change.", tier="inference", sourceIds=["s1"]),
            SOURCES,
        )
        assert insight is not None
        assert insight.sourceIds == ()

    def test_a_causal_claim_is_dropped_entirely(self) -> None:
        insight, problems = validate_insight(
            InsightDraft(text="They were accepted because they had a publication.", tier="reported", sourceIds=["s1"]),
            SOURCES,
        )
        assert insight is None
        assert problems

    def test_unknown_tier_falls_to_the_weakest_reading(self) -> None:
        assert parse_tier("wishful") is EvidenceTier.INFERENCE
        assert parse_tier(None) is EvidenceTier.INFERENCE

    def test_attribution_is_attached_to_what_the_candidate_sees(self) -> None:
        insight, _ = validate_insight(
            InsightDraft(text="Contribution to Korea comes up often.", tier="reported", sourceIds=["s2"]), SOURCES
        )
        assert insight is not None
        assert insight.attributed().startswith("Candidates who described their own interview mention")


class TestSources:
    def test_a_source_without_a_domain_is_not_a_source(self) -> None:
        kept, problems = validate_sources(
            [SourceDraft(id="s1", title="Somewhere", domain="", tier="official", published="2026")]
        )
        assert kept == {}
        assert problems

    def test_a_source_cannot_claim_to_be_an_inference(self) -> None:
        kept, problems = validate_sources(
            [SourceDraft(id="s1", title="Guide", domain="example.com", tier="inference", published="")]
        )
        assert kept["s1"]["tier"] == "secondary"
        assert problems

    def test_title_falls_back_to_the_domain(self) -> None:
        kept, _ = validate_sources(
            [SourceDraft(id="s1", title="", domain="GKS.go.kr", tier="official", published="2026")]
        )
        assert kept["s1"]["title"] == "gks.go.kr"
        assert kept["s1"]["domain"] == "gks.go.kr"


class TestCatalogs:
    def test_each_kind_is_scored_on_the_shared_competencies(self) -> None:
        for kind in OpportunityKind:
            ids = competencies_for_kind(kind)
            assert ids, kind
            assert any(cid.startswith("admission.shared.") for cid in ids), kind
            assert set(ids) <= set(ADMISSION_COMPETENCIES)

    def test_a_department_and_a_funder_weigh_the_interview_differently(self) -> None:
        university = PHASE_WEIGHT[OpportunityKind.UNIVERSITY]
        scholarship = PHASE_WEIGHT[OpportunityKind.SCHOLARSHIP]
        assert university[Phase.STUDY_PLAN] > scholarship[Phase.STUDY_PLAN]
        assert scholarship[Phase.CONTRIBUTION] > university[Phase.CONTRIBUTION]

    def test_every_kind_weights_every_phase_and_they_sum_to_one(self) -> None:
        for kind, weights in PHASE_WEIGHT.items():
            assert set(weights) == set(PHASE_ORDER), kind
            assert sum(weights.values()) == pytest.approx(1.0), kind

    def test_unknown_input_falls_back_without_raising(self) -> None:
        assert parse_kind("fellowship") is OpportunityKind.SCHOLARSHIP
        assert parse_material_type("napkin").value == "other"
