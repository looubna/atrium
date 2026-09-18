"""The knowledge map an oral exam is built from, and the rules its draft must pass.

The analyst reads whatever the student uploaded and returns one structured
document: what each file turned out to be, what the course covers, which topics
an examiner is likely to press on, and how the exam itself is probably run.
Nothing here is trusted as written — ids must reference real materials, topics
are capped and cleaned, and an unrecognised exam style becomes "unknown", which
is what makes the app ask the student instead of guessing.
"""

from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field

from app.modules.exam.catalogs import ExamStyle, MaterialType, parse_material_type, parse_style
from app.modules.interview.sanitize import clean_list, clean_phrase, clean_text

MAX_TOPICS = 18
MAX_OBJECTIVES = 12
MAX_QUESTIONS = 12
MAX_SUBTOPICS = 6

Importance = Literal["high", "medium", "low"]
Confidence = Literal["high", "medium", "low"]


class MaterialReadDraft(BaseModel):
    materialId: str = Field(description="The id of the material this describes, exactly as given in the input")
    type: str = Field(description="One of the allowed material types")
    title: str = Field(description="A short human title for the material, e.g. 'Week 3 — Viscous flow'")
    covers: list[str] = Field(description="The topics this material covers, as short phrases")


class TopicDraft(BaseModel):
    name: str
    importance: Importance = Field(description="How likely an examiner is to press on this topic")
    why: str = Field(description="One sentence: why the material suggests this weight")
    subtopics: list[str]
    sourceMaterialIds: list[str]


class KnowledgeMapDraft(BaseModel):
    courseSummary: str = Field(description="Two or three sentences describing the course from the material")
    scope: str = Field(description="What the exam covers, as the material defines it")
    topics: list[TopicDraft]
    learningObjectives: list[str]
    likelyQuestions: list[str] = Field(description="Questions an examiner would plausibly ask, in their words")
    examStyle: str = Field(description="oral_questions, board_work or unknown")
    examStyleConfidence: Confidence
    examStyleEvidence: str = Field(description="What in the material says so; empty when it is a guess")
    materials: list[MaterialReadDraft]
    caveats: list[str] = Field(description="What the material does not say, in plain words")


class KnowledgeMapRejected(ValueError):
    def __init__(self, problems: list[str]) -> None:
        super().__init__("; ".join(problems[:10]))
        self.problems = problems


def _importance(value: str) -> Importance:
    return value if value in ("high", "medium", "low") else "medium"  # type: ignore[return-value]


def validate_knowledge_map(
    draft: KnowledgeMapDraft, material_ids: set[str]
) -> tuple[dict[str, Any], list[str]]:
    """Cleaned, storable fields plus the problems found (non-fatal ones are simply dropped)."""
    problems: list[str] = []

    materials: list[dict[str, Any]] = []
    seen: set[str] = set()
    for read in draft.materials:
        if read.materialId not in material_ids:
            problems.append(f"unknown material id {read.materialId[:40]!r}")
            continue
        if read.materialId in seen:
            continue
        seen.add(read.materialId)
        materials.append(
            {
                "materialId": read.materialId,
                "type": parse_material_type(read.type).value,
                "title": clean_phrase(read.title, 100),
                "covers": clean_list(read.covers, max_items=8, max_chars=80),
            }
        )
    for missing in sorted(material_ids - seen):
        # Every material must be accounted for, or the student sees a file vanish from the count.
        problems.append(f"material {missing} was not classified")
        materials.append(
            {"materialId": missing, "type": MaterialType.OTHER.value, "title": "", "covers": []}
        )

    topics: list[dict[str, Any]] = []
    for topic in draft.topics[:MAX_TOPICS]:
        name = clean_phrase(topic.name, 90)
        if not name:
            continue
        topics.append(
            {
                "name": name,
                "importance": _importance(topic.importance),
                "why": clean_phrase(topic.why, 200),
                "subtopics": clean_list(topic.subtopics, max_items=MAX_SUBTOPICS, max_chars=80),
                "sourceMaterialIds": [i for i in topic.sourceMaterialIds if i in material_ids][:6],
            }
        )
    if not topics:
        problems.append("no topics were identified")

    style = parse_style(draft.examStyle)
    confidence = draft.examStyleConfidence if draft.examStyleConfidence in ("high", "medium", "low") else "low"
    evidence = clean_phrase(draft.examStyleEvidence, 240)
    # A style claimed without evidence is a guess, and a guess must not silence the question.
    if style is not ExamStyle.UNKNOWN and not evidence and confidence == "high":
        confidence = "medium"

    fields = {
        "courseSummary": clean_text(draft.courseSummary, 700),
        "scope": clean_text(draft.scope, 700),
        "topics": topics,
        "learningObjectives": clean_list(draft.learningObjectives, max_items=MAX_OBJECTIVES, max_chars=160),
        "likelyQuestions": clean_list(draft.likelyQuestions, max_items=MAX_QUESTIONS, max_chars=240),
        "examStyle": style.value,
        "examStyleConfidence": confidence,
        "examStyleEvidence": evidence,
        "materials": materials,
        "caveats": clean_list(draft.caveats, max_items=6, max_chars=200),
    }
    if not fields["courseSummary"]:
        problems.append("the course summary is empty")
    return fields, problems


def needs_exam_style(analysis: dict[str, Any]) -> bool:
    """True when asking the student how their exam is run would actually change the questions."""
    style = parse_style(analysis.get("examStyle"))
    return style is ExamStyle.UNKNOWN or str(analysis.get("examStyleConfidence")) == "low"


#: Work a student is asked to *do* rather than explain: the mark of an exam held at the board.
_WORKED = (
    "derive", "calculate", "compute", "solve", "prove", "evaluate", "integrate", "differentiate",
    "sketch the graph", "draw the diagram", "find the value", "determine the", "show that",
)


def style_from_materials(analysis: dict[str, Any]) -> ExamStyle:
    """The examined style when neither the material nor the research settled it.

    "I'm not sure" must still produce a decision, and it should come from what the course
    actually is: a course that sets problems to work is examined at the board, and one that
    asks for explanations is examined across a desk. This reads the analysis rather than
    picking a fixed answer, and it is deterministic so the same course always decides the
    same way.
    """
    material_types = {str(m.get("type", "")) for m in analysis.get("materials", [])}
    if MaterialType.PROBLEM_SET.value in material_types:
        return ExamStyle.BOARD_WORK
    questions = " ".join(str(q) for q in analysis.get("likelyQuestions", [])).lower()
    scope = f"{analysis.get('scope', '')} {analysis.get('courseSummary', '')}".lower()
    worked = sum(1 for verb in _WORKED if verb in questions)
    # One stray "show that" is not a board exam; a course that keeps asking for work is.
    if worked >= 2 or (worked >= 1 and any(verb in scope for verb in _WORKED)):
        return ExamStyle.BOARD_WORK
    return ExamStyle.ORAL_QUESTIONS


class StyleAnswer(BaseModel):
    """The student's own answer to the one question the app may ask."""

    style: Annotated[str, Field(max_length=32)]
