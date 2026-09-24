from __future__ import annotations

from app.modules.admission.candidate import (
    CandidateDraft,
    ClaimDraft,
    EvidenceDraft,
    validate_candidate,
)
from app.modules.admission.catalogs import MaterialType

MATERIALS = {
    "cv": MaterialType.CV,
    "plan": MaterialType.STUDY_PLAN,
    "guidelines": MaterialType.SCHOLARSHIP_GUIDELINES,
}


def cited(text: str, material: str = "cv", quote: str = "as written in the file") -> ClaimDraft:
    return ClaimDraft(text=text, evidence=[EvidenceDraft(materialId=material, quote=quote)])


def draft(**over: object) -> CandidateDraft:
    base: dict[str, object] = {
        "headline": "Mechanical engineer moving into machine learning",
        "education": [cited("BSc Mechanical Engineering, 2019")],
        "projects": [cited("Built a crop-disease classifier", "plan")],
        "careerGoals": [cited("Wants to lead an agricultural AI lab", "plan")],
    }
    base.update(over)
    return CandidateDraft(**base)  # type: ignore[arg-type]


def test_a_claim_keeps_the_words_it_was_read_in() -> None:
    profile, problems = validate_candidate(draft(), MATERIALS)

    assert [c.text for c in profile.education] == ["BSc Mechanical Engineering, 2019"]
    evidence = profile.education[0].evidence[0]
    assert evidence.materialId == "cv"
    assert evidence.materialType is MaterialType.CV
    assert evidence.quote == "as written in the file"
    assert not profile.is_thin()
    assert problems == []


def test_an_uncited_claim_is_dropped_rather_than_softened() -> None:
    """The failure this module exists to prevent: a flattering line nothing supports.

    Dropped, not demoted: the candidate reads the profile as a record of their own file, so a
    claim with no evidence behind it is not a weaker claim, it is someone else's.
    """
    profile, problems = validate_candidate(draft(leadership=[ClaimDraft(text="Strong leadership skills")]), MATERIALS)

    assert profile.leadership == []
    assert any("no material supports" in p for p in problems)


def test_the_funders_own_paperwork_is_not_read_as_the_candidates_experience() -> None:
    """Guidelines in the upload folder describe the scholarship, not the applicant."""
    profile, problems = validate_candidate(
        draft(leadership=[cited("Demonstrates leadership potential", "guidelines")]), MATERIALS
    )

    assert profile.leadership == []
    assert "guidelines" not in profile.materials
    assert any("describes the opportunity rather than the candidate" in p for p in problems)


def test_a_citation_to_a_file_that_was_never_uploaded_is_reported_as_missing() -> None:
    profile, problems = validate_candidate(draft(research=[cited("Published on soil sensing", "thesis")]), MATERIALS)

    assert profile.research == []
    assert any("never uploaded" in p for p in problems)


def test_gaps_need_no_evidence_because_a_gap_is_the_absence_of_it() -> None:
    profile, _ = validate_candidate(draft(potentialGaps=["No Korean language certificate in the file"]), MATERIALS)

    assert profile.potentialGaps == ["No Korean language certificate in the file"]


def test_nothing_may_tell_the_candidate_to_imitate_other_applicants() -> None:
    profile, problems = validate_candidate(
        draft(potentialGaps=["Copy the selected candidates' study plans"]), MATERIALS
    )

    assert profile.potentialGaps == []
    assert any("imitate" in p for p in problems)


def test_a_claim_that_asserts_selection_was_caused_by_something_is_refused() -> None:
    profile, problems = validate_candidate(
        draft(experience=[cited("Internship abroad, which guarantees selection")]), MATERIALS
    )

    assert profile.experience == []
    assert any("causation" in p or "caused" in p for p in problems)


def test_a_file_that_yielded_almost_nothing_says_so() -> None:
    """A blank profile is usually a failed upload, and the fix is another file, not an interview."""
    profile, problems = validate_candidate(CandidateDraft(headline="Applicant"), MATERIALS)

    assert profile.is_thin()
    assert any("almost nothing" in p for p in problems)


def test_claims_are_returned_in_section_order() -> None:
    profile, _ = validate_candidate(draft(), MATERIALS)

    assert [c.text for c in profile.claims()] == [
        "BSc Mechanical Engineering, 2019",
        "Built a crop-disease classifier",
        "Wants to lead an agricultural AI lab",
    ]
