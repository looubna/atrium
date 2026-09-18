"""Where a motion comes from, and whether it needs looking up.

Three ways in (§4): the user types a topic, asks for one, or hands over material and lets
us find the debatable claims in it. The first two land here; the third is read by
`agents/preparer.py` from the documents themselves.

`needs_research` decides whether the topic is one where current facts matter (§7). It is
keyword-based and deliberately so: asking a model whether it needs to search is both a
model call and a question models answer with "yes", and a needless search costs money,
thirty seconds of the user's time and nothing gained on a motion about free will.
"""

from __future__ import annotations

import re

from pydantic import BaseModel, Field

from app.modules.interview.sanitize import clean_phrase
from app.platform.ai.gateway import Purpose, gateway

MAX_SUGGESTIONS = 6

#: Subject areas where a debate turns on what is currently true: politics, economics,
#: technology, climate, business, law, current events, public policy, science in dispute.
_CURRENT: tuple[str, ...] = (
    "ai", "artificial intelligence", "machine learning", "algorithm", "social media", "encryption", "privacy",
    "data", "crypto", "blockchain", "automation", "robot", "chip", "semiconductor", "platform", "antitrust",
    "election", "vote", "democracy", "parliament", "congress", "government", "policy", "regulat", "legislat",
    "law", "court", "constitution", "rights", "immigration", "border", "asylum", "war", "sanction", "treaty",
    "nato", "eu ", "european union", "tariff", "trade",
    "economy", "economic", "inflation", "interest rate", "tax", "wage", "minimum wage", "unemployment", "labour",
    "labor", "union", "housing", "rent", "pension", "welfare", "universal basic income", "market",
    "climate", "carbon", "emission", "energy", "nuclear", "renewable", "fossil", "oil", "gas", "biodiversity",
    "pollution", "plastic", "water",
    "health", "vaccine", "pandemic", "covid", "obesity", "drug", "opioid", "abortion", "assisted dying",
    "mental health", "healthcare", "insurance",
    "school", "university", "tuition", "curriculum", "standardised testing", "standardized testing",
    "company", "corporate", "shareholder", "monopoly", "startup", "gig economy", "remote work", "four-day week",
    "prison", "police", "sentencing", "death penalty", "surveillance", "gun",
)

#: And where it does not: the argument is conceptual, and searching adds nothing.
_TIMELESS: tuple[str, ...] = (
    "free will", "consciousness", "morality is", "moral realism", "meaning of life", "existence of god",
    "beauty", "art is", "happiness", "virtue", "justice is", "personal identity", "ship of theseus",
)


def needs_research(topic: str, *, asked: bool | None = None) -> bool:
    """Whether this motion should be researched before the debate.

    `asked` is the user's own setting and always wins: someone who turned research off
    gets no searches, and someone who turned it on gets them whatever the topic is.
    """
    if asked is not None:
        return asked
    text = f" {topic.lower()} "
    if any(phrase in text for phrase in _TIMELESS):
        return False
    if any(re.search(rf"\b{re.escape(word)}", text) for word in _CURRENT):
        return True
    # A motion naming a year, a figure or a named body is about something that happened.
    return bool(re.search(r"\b(19|20)\d{2}\b|\d+\s?%|\$\d", text))


class TopicSuggestionDraft(BaseModel):
    motion: str = Field(
        description="A motion phrased so that a person can argue for or against it, e.g. 'Governments should "
        "require AI-generated content to be labelled'. Not a question, and never two motions in one."
    )
    area: str = Field(description="Two or three words for the subject area, e.g. 'Technology policy'")
    why: str = Field(description="One sentence on why this makes a good debate: what the real disagreement is")
    #: Shown so the user can pick one they will find hard rather than one they already agree with.
    bothSidesArguable: bool = Field(description="True only if a thoughtful person could genuinely argue either side")


class TopicSuggestionsDraft(BaseModel):
    topics: list[TopicSuggestionDraft]


TOPICS_INSTRUCTION = """You propose motions for a spoken practice debate.

A good motion here is one where both sides have a real case, where the disagreement is about reasons rather than
facts alone, and which can be argued out loud in fifteen minutes without specialist knowledge.

Rules:
- Phrase each as a statement someone can argue for or against, never as a question.
- One proposition per motion. Never join two claims with "and".
- No motion whose only honest side is one side. Avoid anything where arguing a side would mean defending cruelty,
  denying an atrocity, or disputing settled science; those make bad debates rather than hard ones.
- Spread them across different subject areas, and vary how abstract they are.
- Take no side yourself, and do not hint at which side is stronger.
"""


def fake_topics(interest: str) -> TopicSuggestionsDraft:
    subject = clean_phrase(interest, 60) or "public policy"
    return TopicSuggestionsDraft(
        topics=[
            TopicSuggestionDraft(
                motion=f"Governments should regulate {subject} more tightly than they do now",
                area="Public policy",
                why="The disagreement is about who bears the cost of getting it wrong.",
                bothSidesArguable=True,
            ),
            TopicSuggestionDraft(
                motion="Employers should be required to disclose salary ranges in job advertisements",
                area="Labour policy",
                why="Transparency helps applicants and constrains employers; both effects are real.",
                bothSidesArguable=True,
            ),
            TopicSuggestionDraft(
                motion="Universities should stop using standardised admissions tests",
                area="Education",
                why="It turns on whether the tests measure potential or reproduce advantage.",
                bothSidesArguable=True,
            ),
        ]
    )


async def suggest_topics(uid: str, interest: str = "") -> list[dict[str, str | bool]]:
    """Motions to offer when the user asks us to pick (§4, "Give me a topic")."""
    content = (
        f"Propose {MAX_SUGGESTIONS} motions."
        + (f" The user is interested in: {clean_phrase(interest, 120)}." if interest.strip() else "")
    )
    draft = await gateway.generate(
        purpose=Purpose.DEBATE_TOPICS,
        uid=uid,
        instruction=TOPICS_INSTRUCTION,
        content=content,
        schema=TopicSuggestionsDraft,
        fake=lambda: fake_topics(interest),
    )
    out: list[dict[str, str | bool]] = []
    seen: set[str] = set()
    for topic in draft.topics[:MAX_SUGGESTIONS]:
        motion = clean_phrase(topic.motion, 240)
        if not motion or motion.lower() in seen:
            continue
        seen.add(motion.lower())
        out.append(
            {
                "motion": motion,
                "area": clean_phrase(topic.area, 40),
                "why": clean_phrase(topic.why, 200),
                "bothSidesArguable": bool(topic.bothSidesArguable),
                "needsResearch": needs_research(motion),
            }
        )
    return out


def normalise_motion(topic: str) -> str:
    """The user's own topic, tidied — not rewritten.

    It is tempting to turn "Should governments regulate AI?" into a proposition here, and
    it goes wrong immediately: finding where the subject ends needs a parser, and
    "AI-generated should content require labelling" is worse than the question was. A
    question works perfectly well as a motion once a side is attached to it, and
    preparation produces a properly phrased motion anyway (`DebateBriefDraft.motion`).
    """
    return clean_phrase(topic, 240)


__all__ = ["needs_research", "normalise_motion", "suggest_topics"]
