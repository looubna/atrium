from __future__ import annotations

from typing import Any

import pytest

from app.modules.admission.agents import analyzer as analyzer_module
from app.modules.admission.agents.analyzer import AnalysisDraft, ApplicationAnalyzer
from app.modules.admission.candidate import ClaimDraft, EvidenceDraft
from app.modules.admission.catalogs import MaterialType
from app.platform.ai.gateway import StructuredOutputError

MATERIALS = [
    ("m1", "CV.pdf", "BSc Mechanical Engineering, 2019. Organised the student robotics conference."),
    ("m2", "Study plan.docx", "I intend to research soil sensing at the Seoul lab."),
]


class FakeGateway:
    """Stands in for the model: returns whatever the test wants it to have produced."""

    def __init__(self, draft: AnalysisDraft | Exception) -> None:
        self.draft = draft
        self.content: str = ""

    async def generate(self, **kwargs: Any) -> AnalysisDraft:
        self.content = str(kwargs.get("content", ""))
        if isinstance(self.draft, Exception):
            raise self.draft
        return self.draft


@pytest.fixture
def gateway(monkeypatch: pytest.MonkeyPatch):
    def install(draft: AnalysisDraft | Exception) -> FakeGateway:
        fake = FakeGateway(draft)
        monkeypatch.setattr(analyzer_module, "gateway", fake)
        return fake

    return install


async def test_a_cited_claim_survives_with_the_words_it_was_read_in(gateway) -> None:
    gateway(
        AnalysisDraft(
            headline="Engineer applying for graduate study",
            education=[
                ClaimDraft(
                    text="BSc in Mechanical Engineering",
                    evidence=[EvidenceDraft(materialId="m1", quote="BSc Mechanical Engineering, 2019")],
                )
            ],
            materialTypes={"m1": "cv", "m2": "study_plan"},
        )
    )

    profile, types, problems = await ApplicationAnalyzer().run(uid="u1", opportunity="GKS", materials=MATERIALS)

    assert [c.text for c in profile.education] == ["BSc in Mechanical Engineering"]
    assert profile.education[0].evidence[0].quote == "BSc Mechanical Engineering, 2019"
    assert types == {"m1": MaterialType.CV, "m2": MaterialType.STUDY_PLAN}
    # One claim is a thin file, and saying so is the point; nothing was corrected.
    assert not any("dropped" in p or "cites" in p for p in problems)


async def test_an_upgraded_claim_is_dropped_even_when_the_model_insists(gateway) -> None:
    """The failure the module exists to stop: an activity promoted into a trait, uncited."""
    gateway(
        AnalysisDraft(
            leadership=[ClaimDraft(text="Strong leadership and organisational skills")],
            materialTypes={"m1": "cv"},
        )
    )

    profile, _, problems = await ApplicationAnalyzer().run(uid="u1", opportunity="GKS", materials=MATERIALS)

    assert profile.leadership == []
    assert any("no material supports" in p for p in problems)


async def test_claims_taken_from_the_funders_own_paperwork_are_refused(gateway) -> None:
    gateway(
        AnalysisDraft(
            leadership=[
                ClaimDraft(
                    text="Shows leadership potential",
                    evidence=[EvidenceDraft(materialId="m2", quote="candidates should show leadership potential")],
                )
            ],
            materialTypes={"m1": "cv", "m2": "scholarship_guidelines"},
        )
    )

    profile, types, problems = await ApplicationAnalyzer().run(uid="u1", opportunity="GKS", materials=MATERIALS)

    assert profile.leadership == []
    assert types["m2"] is MaterialType.SCHOLARSHIP_GUIDELINES
    assert any("describes the opportunity" in p for p in problems)


async def test_gaps_come_through_without_a_quote(gateway) -> None:
    gateway(
        AnalysisDraft(
            potentialGaps=["The study plan does not say which lab or supervisor."],
            materialTypes={"m1": "cv"},
        )
    )

    profile, _, _ = await ApplicationAnalyzer().run(uid="u1", opportunity="GKS", materials=MATERIALS)

    assert profile.potentialGaps == ["The study plan does not say which lab or supervisor."]


async def test_documents_reach_the_model_with_their_ids_so_claims_can_cite_them(gateway) -> None:
    fake = gateway(AnalysisDraft(materialTypes={}))

    await ApplicationAnalyzer().run(uid="u1", opportunity="GKS", materials=MATERIALS)

    assert '"id": "m1"' in fake.content
    assert "Organised the student robotics conference" in fake.content
    # The type list is offered rather than asked for: §4 says the candidate never labels.
    assert "study_plan" in fake.content


async def test_a_long_document_is_cut_and_the_model_is_told_so(gateway) -> None:
    """A truncated CV must not read as a career that stopped halfway."""
    fake = gateway(AnalysisDraft(materialTypes={}))
    long_cv = [("m1", "CV", "x" * (analyzer_module.MAX_MATERIAL_CHARS + 500))]

    await ApplicationAnalyzer().run(uid="u1", opportunity="GKS", materials=long_cv)

    assert '"truncatedMaterials": ["m1"]' in fake.content.replace("'", '"')


async def test_unreadable_materials_give_an_empty_profile_rather_than_an_invented_one(gateway) -> None:
    gateway(AnalysisDraft(materialTypes={}))

    profile, types, problems = await ApplicationAnalyzer().run(
        uid="u1", opportunity="GKS", materials=[("m1", "Scan.png", "   ")]
    )

    assert profile.claims() == []
    assert types == {}
    assert any("almost nothing" in p for p in problems)


async def test_a_failed_reading_says_so_instead_of_half_parsing(gateway) -> None:
    gateway(StructuredOutputError("model returned no usable JSON"))

    profile, types, problems = await ApplicationAnalyzer().run(uid="u1", opportunity="GKS", materials=MATERIALS)

    assert profile.claims() == []
    assert types == {}
    assert any("could not be read" in p for p in problems)
