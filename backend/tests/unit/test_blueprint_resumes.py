from __future__ import annotations

import io
import zipfile
from typing import Any

import pytest

from app.modules.interview.blueprint import (
    BlueprintDraft,
    BlueprintRejected,
    RoundDraft,
    SourceDraft,
    validate_blueprint,
)
from app.modules.interview.resumes import UnsupportedResume, detect_kind, extract_text, fake_profile


def round_draft(**overrides: Any) -> RoundDraft:
    base: dict[str, Any] = dict(
        order=1, type="screening", customLabel="", title="Recruiter screen", format="Phone, one interviewer",
        durationMinutes=30, competencyIds=["interview.screening.motivation", "interview.coding.correctness"],
        questionFamilies=[{"name": "Motivation", "description": "Why this role", "exampleQuestions": ["Why us?"]}],
        reportedQuestions=[], resumeFocus=["payments migration"], roleFocus=[], companyFocus=[],
        rubric=[
            {"competencyId": "interview.screening.motivation", "strongSignals": "Specific", "weakSignals": "Vague"}
        ],
        confidence="medium", rationale="Common first step.", evidenceSourceIds=[],
    )
    return RoundDraft(**{**base, **overrides})


def blueprint(rounds: list[RoundDraft], **overrides: Any) -> BlueprintDraft:
    base: dict[str, Any] = dict(
        processSummary="Three rounds over two weeks.", companySummary="Payments company.", roleSummary="Backend role.",
        rounds=rounds,
        sources=[SourceDraft(id="src1", title="Acme careers", domain="careers.acme.com", kind="official"),
                 SourceDraft(id="src2", title="Bad", domain="not a domain", kind="other")],
        caveats=["Processes vary by team."],
    )
    return BlueprintDraft(**{**base, **overrides})


def test_rounds_are_ordered_typed_and_bounded() -> None:
    draft = blueprint([
        round_draft(order=5, type="Take-home presentation", title="Case presentation", durationMinutes=500),
        round_draft(order=2, type="technical", competencyIds=[], confidence="high", evidenceSourceIds=["src9"]),
        round_draft(order=1, reportedQuestions=[
            {"text": "Why Acme?", "sourceIds": ["src1"]},
            {"text": "Invented question", "sourceIds": ["nowhere"]},
        ], confidence="high", evidenceSourceIds=["src1"]),
    ])
    fields, problems = validate_blueprint(draft)
    rounds = fields["rounds"]
    assert [r["order"] for r in rounds] == [1, 2, 3]
    assert [r["type"] for r in rounds] == ["screening", "technical", "other"]
    assert rounds[2]["customLabel"] == "Take-home presentation" and rounds[2]["durationMin"] is None
    assert rounds[0]["competencyIds"][0] == "interview.screening.motivation"
    assert "interview.coding.correctness" not in rounds[0]["competencyIds"]
    assert len(rounds[1]["competencyIds"]) == 5  # filled from the technical catalog
    assert rounds[0]["reportedQuestions"] == [{"text": "Why Acme?", "sourceIds": ["src1"]}]
    assert any("without a known source" in p for p in problems)
    assert rounds[0]["confidence"] == "high"
    assert rounds[1]["confidence"] == "medium"  # claimed high without evidence
    assert fields["processSummary"].startswith("Likely interview process")
    assert [s["id"] for s in fields["sources"]] == ["src1"]
    assert len({r["id"] for r in rounds}) == 3


@pytest.mark.parametrize(
    "text, expected",
    [
        ("coding", "coding"),
        ("System design", "system_design"),
        ("Take-home review", "take_home_review"),
        ("Recruiter / screening", "screening"),
        ("Phone screen", "screening"),
        ("Behavioural", "behavioral"),
        ("Hiring manager", "hiring_manager"),
        ("  CASE STUDY ", "case"),
    ],
)
def test_round_type_labels_and_aliases(text: str, expected: str) -> None:
    from app.modules.interview.catalogs import parse_round_type

    parsed = parse_round_type(text)
    assert parsed is not None and parsed.value == expected


def test_unknown_round_types_are_none() -> None:
    from app.modules.interview.catalogs import parse_round_type

    assert parse_round_type("Lunch with the team") is None
    assert parse_round_type("") is None


def test_existing_round_ids_are_kept_on_edit() -> None:
    fields, _ = validate_blueprint(blueprint([round_draft()]), existing_ids={1: "r01deadbeef"})
    assert fields["rounds"][0]["id"] == "r01deadbeef"
    fields, _ = validate_blueprint(blueprint([round_draft()]), existing_ids={1: "../../x"})
    assert fields["rounds"][0]["id"] != "../../x"


def test_blueprints_without_rounds_or_with_too_many_are_rejected() -> None:
    with pytest.raises(BlueprintRejected):
        validate_blueprint(blueprint([]))
    with pytest.raises(BlueprintRejected):
        validate_blueprint(blueprint([round_draft(order=i) for i in range(13)]))


def docx_bytes(text: str) -> bytes:
    import docx

    document = docx.Document()
    for line in text.split("\n"):
        document.add_paragraph(line)
    buffer = io.BytesIO()
    document.save(buffer)
    return buffer.getvalue()


RESUME = "\n".join(
    ["Jane Doe - Senior Backend Engineer"] + [f"Led project {i} and cut latency by 40%." for i in range(12)]
)


def test_resume_type_detection_uses_content() -> None:
    assert detect_kind("cv.txt", b"%PDF-1.7 ...") == "pdf"
    assert detect_kind("cv.pdf", docx_bytes(RESUME)) == "docx"
    assert detect_kind("cv.md", RESUME.encode()) == "md"
    assert detect_kind("cv.docx", RESUME.encode()) == "txt"
    archive = io.BytesIO()
    with zipfile.ZipFile(archive, "w") as z:
        z.writestr("payload.exe", b"MZ")
    with pytest.raises(UnsupportedResume):
        detect_kind("cv.docx", archive.getvalue())
    with pytest.raises(UnsupportedResume):
        detect_kind("cv.txt", b"\x00\x01binary")
    with pytest.raises(UnsupportedResume):
        detect_kind("cv.txt", "caf\xe9".encode("latin-1") * 10)


def test_resume_text_extraction() -> None:
    assert "Senior Backend Engineer" in extract_text("docx", docx_bytes(RESUME))
    assert extract_text("txt", (RESUME + "\n\n\n\n  extra   spaces").encode()).endswith("extra spaces")
    with pytest.raises(UnsupportedResume):
        extract_text("txt", b"too short")
    with pytest.raises(UnsupportedResume):
        extract_text("pdf", b"%PDF-1.4 not really a pdf")
    profile = fake_profile(RESUME)
    assert profile.currentTitle.startswith("Jane Doe") and profile.achievements
