"""The Candidate Profile: what this applicant can show, and where they showed it.

The mirror of `opportunity.py`. That file holds what is publicly known about a scholarship and
guards against stating a stranger's recollection as a requirement; this one holds what the
candidate handed over and guards against the opposite failure, which is quieter and worse.

An analyzer reading a CV is being asked to summarise, and a summary of an application is a
short step from an improvement of it. "Led a team" becomes "strong leadership experience";
"took a Python course" becomes "background in machine learning". Neither is a lie the model
intended, and both are fatal here: the candidate reads their profile as a description of
themselves, prepares the answer it suggests, and a panel that has their actual file in front
of it asks the follow-up that the invention cannot survive. The candidate is then worse off
than if they had prepared alone (§33).

So the rule of this module is that a claim exists only where a document supports it. Every
item carries the material it came from and the words it was read in, and an item that cites
no material is dropped rather than demoted — there is nowhere weaker for it to go, because a
claim about a person with no evidence behind it is not a weaker claim, it is a different
person's claim.

Two smaller rules follow from the same reasoning:

- `potentialGaps` may cite nothing, because a gap is the absence of evidence and demanding a
  citation for it would delete exactly the observations worth preparing for. They are held
  apart from everything else for that reason, and they are phrased as what is *missing from
  the file*, never as a judgement of the person.
- Documents about the opportunity (`catalogs.ABOUT_THE_OPPORTUNITY`) are not mined for claims
  about the candidate. A scholarship's own guidelines sitting in the upload folder describe
  the funder, and reading "leadership potential" there as a fact about the applicant is how a
  profile ends up describing the brochure.
"""

from __future__ import annotations

from pydantic import BaseModel, Field

from app.modules.admission.catalogs import ABOUT_THE_OPPORTUNITY, MaterialType, parse_material_type
from app.modules.admission.evidence import integrity_problems

MAX_TEXT = 400
MAX_QUOTE = 300
MAX_PER_SECTION = 14
MAX_GAPS = 8
MAX_EVIDENCE_PER_CLAIM = 4
PROFILE_VERSION = 1

#: The sections a profile is built from, in the order a panel tends to work through them.
#: `motivation` and `careerGoals` are claims like any other here: "I have always wanted to
#: study in Korea" is a sentence in a personal statement, and it is evidence of what the
#: candidate wrote, not of what they feel.
SECTIONS: tuple[str, ...] = (
    "education",
    "experience",
    "research",
    "projects",
    "leadership",
    "internationalExperience",
    "languages",
    "motivation",
    "careerGoals",
)


class EvidenceDraft(BaseModel):
    """Where a claim was read, as the analyzer reports it."""

    materialId: str = Field(description="Id of the uploaded material this was read in")
    quote: str = Field(default="", description="The candidate's own words, quoted, not paraphrased")


class ClaimDraft(BaseModel):
    """One thing the candidate can show, before it has been checked."""

    text: str = Field(description="The claim in one line, as a panel would hear it")
    evidence: list[EvidenceDraft] = Field(default_factory=list)


class CandidateDraft(BaseModel):
    """What the analyzer is asked to produce from the materials."""

    headline: str = Field(default="", description="Who this candidate is, in one sentence")
    education: list[ClaimDraft] = Field(default_factory=list)
    experience: list[ClaimDraft] = Field(default_factory=list)
    research: list[ClaimDraft] = Field(default_factory=list)
    projects: list[ClaimDraft] = Field(default_factory=list)
    leadership: list[ClaimDraft] = Field(default_factory=list)
    internationalExperience: list[ClaimDraft] = Field(default_factory=list)
    languages: list[ClaimDraft] = Field(default_factory=list)
    motivation: list[ClaimDraft] = Field(default_factory=list)
    careerGoals: list[ClaimDraft] = Field(default_factory=list)
    potentialGaps: list[str] = Field(default_factory=list)


class Evidence(BaseModel):
    materialId: str
    materialType: MaterialType = MaterialType.OTHER
    quote: str = ""


class Claim(BaseModel):
    """A validated claim. Nothing reaches the interviewer that is not one of these."""

    text: str
    evidence: tuple[Evidence, ...] = ()

    def cited_in(self) -> tuple[str, ...]:
        """The materials this rests on, for showing the candidate where it came from."""
        return tuple(dict.fromkeys(e.materialId for e in self.evidence))


class CandidateProfile(BaseModel):
    """The candidate as their own documents describe them."""

    headline: str = ""
    education: list[Claim] = Field(default_factory=list)
    experience: list[Claim] = Field(default_factory=list)
    research: list[Claim] = Field(default_factory=list)
    projects: list[Claim] = Field(default_factory=list)
    leadership: list[Claim] = Field(default_factory=list)
    internationalExperience: list[Claim] = Field(default_factory=list)
    languages: list[Claim] = Field(default_factory=list)
    motivation: list[Claim] = Field(default_factory=list)
    careerGoals: list[Claim] = Field(default_factory=list)
    #: What the file does not show. No citations by design: see the module docstring.
    potentialGaps: list[str] = Field(default_factory=list)
    #: Material ids that were read, so a profile can say what it is based on.
    materials: list[str] = Field(default_factory=list)
    version: int = PROFILE_VERSION

    def claims(self) -> list[Claim]:
        """Every claim, in section order. What the preparation engine matches against."""
        return [claim for section in SECTIONS for claim in getattr(self, section)]

    def is_thin(self) -> bool:
        """True when the materials did not describe a person well enough to prepare them.

        An empty profile is not a candidate with nothing to say; it is a CV that failed to
        parse, a photograph of a document, or a link that resolved to a login page. The
        difference matters because the answer is to ask for another file, not to interview
        someone about a blank page.
        """
        return len(self.claims()) < 3


def _claim(
    draft: ClaimDraft,
    materials: dict[str, MaterialType],
    problems: list[str],
    *,
    label: str,
    about_opportunity: frozenset[str] = frozenset(),
) -> Claim | None:
    text = " ".join(str(draft.text or "").split())[:MAX_TEXT]
    if not text:
        return None

    if found := integrity_problems(text):
        problems.extend(f"{label}: {p}" for p in found)
        return None

    kept: list[Evidence] = []
    for item in draft.evidence[:MAX_EVIDENCE_PER_CLAIM]:
        material_id = " ".join(str(item.materialId or "").split())[:64]
        if material_id in about_opportunity:
            # Uploaded, but it describes the funder. Saying "never uploaded" here would send
            # whoever reads the log looking for a missing file that is sitting right there.
            problems.append(f"{label}: cites {material_id}, which describes the opportunity rather than the candidate")
            continue
        if material_id not in materials:
            problems.append(f"{label}: cites a material that was never uploaded ({material_id or 'unnamed'})")
            continue
        material_type = materials[material_id]
        kept.append(
            Evidence(
                materialId=material_id,
                materialType=material_type,
                quote=" ".join(str(item.quote or "").split())[:MAX_QUOTE],
            )
        )

    if not kept:
        # The claim may well be true. We have nothing showing that it is, and a profile is
        # read as a record of the file, so an uncited claim is removed rather than softened.
        problems.append(f"{label}: no material supports {text[:60]!r}, so it was dropped")
        return None

    return Claim(text=text, evidence=tuple(kept))


def validate_candidate(
    draft: CandidateDraft, materials: dict[str, MaterialType]
) -> tuple[CandidateProfile, list[str]]:
    """The profile as it may be stored, plus everything that had to be corrected.

    Never raises. A candidate who uploaded one thin document still gets a profile, and
    `is_thin()` is how the rest of the module finds out; refusing here would mean the
    difference between a sparse file and a failed upload reached the user as the same error.

    `materials` maps the ids that were actually uploaded to what each document turned out to
    be. Claims read out of the opportunity's own paperwork are dropped: that folder describes
    the funder, not the applicant.
    """
    problems: list[str] = []
    about_candidate = {
        mid: mtype for mid, mtype in materials.items() if mtype not in ABOUT_THE_OPPORTUNITY
    }
    # Uploading the funder's own guidelines is normal and invited (§4); they feed the
    # opportunity profile instead. Only a *claim* that leans on one is worth reporting.
    about_opportunity = frozenset(set(materials) - set(about_candidate))

    sections: dict[str, list[Claim]] = {}
    for section in SECTIONS:
        kept: list[Claim] = []
        for item in getattr(draft, section)[:MAX_PER_SECTION]:
            if claim := _claim(item, about_candidate, problems, label=section, about_opportunity=about_opportunity):
                kept.append(claim)
        sections[section] = kept

    gaps: list[str] = []
    for gap in draft.potentialGaps[:MAX_GAPS]:
        text = " ".join(str(gap or "").split())[:MAX_TEXT]
        if not text:
            continue
        if found := integrity_problems(text):
            problems.extend(f"gap: {p}" for p in found)
            continue
        gaps.append(text)

    profile = CandidateProfile(
        headline=" ".join(str(draft.headline or "").split())[:240],
        potentialGaps=gaps,
        materials=sorted(about_candidate),
        **sections,
    )
    if profile.is_thin():
        problems.append("the materials yielded almost nothing about the candidate")
    return profile, problems


__all__ = [
    "SECTIONS",
    "CandidateDraft",
    "CandidateProfile",
    "Claim",
    "ClaimDraft",
    "Evidence",
    "EvidenceDraft",
    "parse_material_type",
    "validate_candidate",
]
