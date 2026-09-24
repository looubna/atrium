"""What this candidate should be ready to explain, and why.

Where the two halves meet. `opportunity.py` holds what the scholarship wants and how firmly
that is known; `candidate.py` holds what the applicant can actually show and where they
showed it. This file holds the join: questions a panel is likely to ask *this* person, what
they could authentically be memorable for, and what their own file leaves unexplained.

Three rules are enforced here rather than asked for in a prompt, because each is a sentence
the model has every incentive to write and no way to support.

The first is that a question must say why it exists (§15). "Why did you choose this
university?" is a question anyone could have guessed; the same question carried by *the
programme weights research and your study plan proposes some* is preparation. A question with
no grounding is not wrong, it is just generic, so it is kept only in the categories that are
honestly generic and refused in the ones that claim to be personal.

The second is that a differentiator must rest on something the candidate actually has (§17).
The failure to prevent is flattery: told they stand out for "passion for development", a
candidate walks into a panel with nothing to say when asked for an example.

The third is that advice must be specific enough to act on. "Be confident", "smile", "show
passion" are refused outright — they are what this feature exists instead of.

Concerns are held to the same standard as gaps in `candidate.py`: they may point at the
absence of something, but never at the person. "The study plan does not name a supervisor" is
preparable; "seems unfocused" is a verdict, and not ours to give.
"""

from __future__ import annotations

import re
from enum import StrEnum

from pydantic import BaseModel, Field

from app.modules.admission.evidence import integrity_problems

MAX_TEXT = 400
MAX_PER_SECTION = 12
MAX_WHY = 4
MAX_PREPARE = 5
PLAN_VERSION = 1


class QuestionCategory(StrEnum):
    """§14. The first three are claims about evidence; the rest are claims about shape."""

    #: Supported by an official requirement or a topic many accounts report.
    VERY_LIKELY = "very_likely"
    #: Recurs in credible accounts, without official backing.
    LIKELY = "likely"
    #: Generated from this candidate's own materials.
    PERSONALIZED = "personalized"
    #: Follows naturally from an answer they are likely to give.
    FOLLOW_UP = "follow_up"
    #: Tests consistency, depth, evidence or commitment.
    CHALLENGING = "challenging"
    #: About this exact scholarship, programme or country.
    OPPORTUNITY_SPECIFIC = "opportunity_specific"


#: Categories that assert the question came from somewhere. One of these with no `why` is a
#: guess wearing a citation's clothes, so it is refused rather than quietly demoted.
GROUNDED: frozenset[QuestionCategory] = frozenset(
    {
        QuestionCategory.VERY_LIKELY,
        QuestionCategory.LIKELY,
        QuestionCategory.PERSONALIZED,
        QuestionCategory.OPPORTUNITY_SPECIFIC,
    }
)

#: Advice that tells the candidate to be a better person rather than to prepare a better
#: answer. §17 names these; they are also the exact filler a model produces when it has
#: nothing specific to say, which is why the check is here and not in the instruction.
_EMPTY_ADVICE = re.compile(
    r"^\W*("
    r"be (?:confident|passionate|yourself|positive|enthusiastic|genuine|authentic|honest|natural|professional)"
    r"|show (?:confidence|passion|enthusiasm|your personality)"
    r"|smile(?: more)?|make eye contact|speak clearly|dress (?:well|smartly|appropriately)"
    r"|stay calm|relax|don't be nervous|practi[cs]e a lot|work hard|do your best|prepare well"
    r"|research the (?:university|programme|program|scholarship)"
    r")\W*$",
    re.IGNORECASE,
)


def advice_problems(text: str) -> list[str]:
    """What is wrong with a line of guidance. Empty means the candidate can act on it."""
    if _EMPTY_ADVICE.match(text.strip()):
        return [f"generic advice with nothing to prepare ({text.strip()[:60]!r})"]
    return []


class QuestionDraft(BaseModel):
    """A question the panel might ask, as the strategist writes it."""

    text: str = Field(description="The question as a panel would say it")
    category: str
    why: list[str] = Field(default_factory=list, description="What in the research or the file makes it likely")
    prepare: list[str] = Field(default_factory=list, description="What to have ready — evidence, not a script")


class DifferentiatorDraft(BaseModel):
    text: str = Field(description="What could make this candidate memorable, in one line")
    why: str = Field(default="", description="Why it matters to this opportunity")
    evidence: list[str] = Field(default_factory=list, description="The candidate's own claims it rests on")
    where: list[str] = Field(default_factory=list, description="Where in the interview to show it")


class ConcernDraft(BaseModel):
    text: str = Field(description="What the file leaves unexplained, phrased as the absence it is")
    why: str = Field(default="", description="What in the requirements or the materials raises it")
    prepare: list[str] = Field(default_factory=list)


class StoryDraft(BaseModel):
    """§19. Four beats and the joins between them, which is where interviews go wrong."""

    past: str = ""
    present: str = ""
    program: str = ""
    future: str = ""
    #: Joins the file does not make. "Mechanical engineering to an AI master's" is the classic.
    missingLinks: list[str] = Field(default_factory=list)


class PreparationDraft(BaseModel):
    questions: list[QuestionDraft] = Field(default_factory=list)
    differentiators: list[DifferentiatorDraft] = Field(default_factory=list)
    concerns: list[ConcernDraft] = Field(default_factory=list)
    story: StoryDraft = Field(default_factory=StoryDraft)


class Question(BaseModel):
    text: str
    category: QuestionCategory
    why: tuple[str, ...] = ()
    prepare: tuple[str, ...] = ()


class Differentiator(BaseModel):
    text: str
    why: str = ""
    evidence: tuple[str, ...] = ()
    where: tuple[str, ...] = ()


class Concern(BaseModel):
    text: str
    why: str = ""
    prepare: tuple[str, ...] = ()


class Story(BaseModel):
    past: str = ""
    present: str = ""
    program: str = ""
    future: str = ""
    missingLinks: tuple[str, ...] = ()

    def is_empty(self) -> bool:
        return not any((self.past, self.present, self.program, self.future))


class PreparationPlan(BaseModel):
    """What the dashboard shows and the interviewer is briefed from."""

    questions: list[Question] = Field(default_factory=list)
    differentiators: list[Differentiator] = Field(default_factory=list)
    concerns: list[Concern] = Field(default_factory=list)
    story: Story = Field(default_factory=Story)
    version: int = PLAN_VERSION

    def questions_in(self, category: QuestionCategory) -> list[Question]:
        return [q for q in self.questions if q.category is category]

    def is_thin(self) -> bool:
        """True when there is not enough here to call it preparation."""
        return len(self.questions) < 3


def _lines(values: list[str], problems: list[str], *, label: str, limit: int) -> tuple[str, ...]:
    kept: list[str] = []
    for value in values[:limit]:
        text = " ".join(str(value or "").split())[:MAX_TEXT]
        if not text:
            continue
        if found := integrity_problems(text) + advice_problems(text):
            problems.extend(f"{label}: {p}" for p in found)
            continue
        kept.append(text)
    return tuple(kept)


def _category(value: str) -> QuestionCategory:
    try:
        return QuestionCategory(str(value))
    except ValueError:
        # Unknown means unclaimed: the weakest honest reading is that it merely might come up.
        return QuestionCategory.LIKELY


def validate_preparation(
    draft: PreparationDraft, *, candidate_claims: tuple[str, ...] = ()
) -> tuple[PreparationPlan, list[str]]:
    """The plan as it may be shown, plus everything that had to be corrected.

    `candidate_claims` is what the candidate's own profile actually says. A differentiator
    citing something not in it is dropped: the whole point of the section is that they can
    back it up when asked, and evidence we invented for them is evidence they do not have.
    """
    problems: list[str] = []

    questions: list[Question] = []
    for item in draft.questions[:MAX_PER_SECTION * 2]:
        text = " ".join(str(item.text or "").split())[:MAX_TEXT]
        if not text:
            continue
        if found := integrity_problems(text):
            problems.extend(f"question: {p}" for p in found)
            continue
        category = _category(item.category)
        why = _lines(item.why, problems, label="question reason", limit=MAX_WHY)
        if not why and category in GROUNDED:
            # It may well be a fair question; it is not a *supported* one, and the category
            # is a claim about support.
            problems.append(f"question: {text[:60]!r} claimed {category} with nothing behind it; kept as likely")
            category = QuestionCategory.LIKELY
        questions.append(
            Question(
                text=text,
                category=category,
                why=why,
                prepare=_lines(item.prepare, problems, label="question preparation", limit=MAX_PREPARE),
            )
        )

    known = {c.strip().lower() for c in candidate_claims if c.strip()}
    differentiators: list[Differentiator] = []
    for item in draft.differentiators[:MAX_PER_SECTION]:
        text = " ".join(str(item.text or "").split())[:MAX_TEXT]
        if not text:
            continue
        if found := integrity_problems(text) + advice_problems(text):
            problems.extend(f"differentiator: {p}" for p in found)
            continue
        evidence = tuple(
            e for e in (" ".join(str(x or "").split())[:MAX_TEXT] for x in item.evidence[:MAX_WHY]) if e
        )
        if known and not any(e.strip().lower() in known for e in evidence):
            problems.append(
                f"differentiator: {text[:60]!r} rests on nothing in the candidate's own profile, so it was dropped"
            )
            continue
        if not evidence:
            problems.append(f"differentiator: {text[:60]!r} cites no evidence, so it was dropped")
            continue
        differentiators.append(
            Differentiator(
                text=text,
                why=" ".join(str(item.why or "").split())[:MAX_TEXT],
                evidence=evidence,
                where=_lines(item.where, problems, label="differentiator", limit=MAX_WHY),
            )
        )

    concerns: list[Concern] = []
    for item in draft.concerns[:MAX_PER_SECTION]:
        text = " ".join(str(item.text or "").split())[:MAX_TEXT]
        if not text:
            continue
        if found := integrity_problems(text) + advice_problems(text):
            problems.extend(f"concern: {p}" for p in found)
            continue
        concerns.append(
            Concern(
                text=text,
                why=" ".join(str(item.why or "").split())[:MAX_TEXT],
                prepare=_lines(item.prepare, problems, label="concern", limit=MAX_PREPARE),
            )
        )

    story = Story(
        past=" ".join(str(draft.story.past or "").split())[:MAX_TEXT],
        present=" ".join(str(draft.story.present or "").split())[:MAX_TEXT],
        program=" ".join(str(draft.story.program or "").split())[:MAX_TEXT],
        future=" ".join(str(draft.story.future or "").split())[:MAX_TEXT],
        missingLinks=_lines(draft.story.missingLinks, problems, label="story", limit=MAX_WHY),
    )

    plan = PreparationPlan(questions=questions, differentiators=differentiators, concerns=concerns, story=story)
    if plan.is_thin():
        problems.append("too little was produced to call it preparation")
    return plan, problems
