"""Retrieving the few things from the user's material that bear on what was just said.

What §9 of the brief actually requires is this: during the debate, retrieve only
relevant material, and never send whole documents to the model on every turn. That is
what happens here.

The unit of retrieval is not a text chunk but an extracted record — a claim, a piece of
evidence, a definition, an assumption or a contradiction, each with the material it came
from and a verbatim quote (see `brief.MaterialClaimDraft`). Debates run on a handful of
documents and last twenty minutes, so the whole candidate set is tens of records, not
thousands: scoring them by term overlap is both exact and free, where an embedding index
would mean a vector store, an index build and an embedding call per turn for no better
answer.

`Retriever` is a protocol so that stays a decision rather than an assumption. If material
sets grow to the point where lexical scoring misses paraphrases, a pgvector or Firestore
vector-search retriever implements the same two methods and nothing else changes.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol

from app.modules.debate.argument import content_words

#: Records handed to the debater in one turn. More than this and the instruction bloats
#: without the opponent using any of it.
TOP_K = 4
#: Below this the record has nothing to do with the turn, and citing it would be padding.
MIN_SCORE = 0.08

#: Records of these kinds are worth more when the opponent needs something to argue with.
_KIND_WEIGHT: dict[str, float] = {
    "evidence": 1.25,
    "fact": 1.2,
    "contradiction": 1.15,
    "definition": 1.1,
    "claim": 1.0,
    "assumption": 1.0,
}


@dataclass(frozen=True, slots=True)
class MaterialRecord:
    """One retrievable thing the user's own material says."""

    text: str
    kind: str
    material_id: str
    quote: str = ""
    topic: str = ""
    #: The material's display name, for telling the user where a point came from.
    material_name: str = ""

    @property
    def terms(self) -> frozenset[str]:
        return content_words(f"{self.text} {self.topic}")

    def to_doc(self) -> dict[str, Any]:
        return {
            "text": self.text, "kind": self.kind, "materialId": self.material_id,
            "quote": self.quote, "topic": self.topic,
        }

    @classmethod
    def from_doc(cls, data: dict[str, Any], names: dict[str, str] | None = None) -> MaterialRecord:
        material_id = str(data.get("materialId", ""))
        return cls(
            text=str(data.get("text", "")),
            kind=str(data.get("kind", "claim")),
            material_id=material_id,
            quote=str(data.get("quote", "")),
            topic=str(data.get("topic", "")),
            material_name=(names or {}).get(material_id, ""),
        )


class Retriever(Protocol):
    """Anything that can answer "what in the material bears on this?"."""

    def search(
        self, query: str, *, limit: int = TOP_K, exclude: frozenset[str] = frozenset()
    ) -> list[MaterialRecord]: ...

    def __len__(self) -> int: ...


@dataclass
class LexicalRetriever:
    """Term-overlap scoring over the extracted records, weighted by how rare a term is.

    Rare terms carry the signal: two records both mentioning "regulation" says nothing
    in a debate about regulation, while both mentioning "Brussels effect" says a lot. So
    each term is weighted by how few records contain it, which is the useful half of what
    an inverse document frequency does, without needing a corpus.
    """

    records: list[MaterialRecord] = field(default_factory=list)
    _weights: dict[str, float] = field(default_factory=dict, init=False, repr=False)

    def __post_init__(self) -> None:
        total = len(self.records) or 1
        counts: dict[str, int] = {}
        for record in self.records:
            for term in record.terms:
                counts[term] = counts.get(term, 0) + 1
        # A term in every record scores 0; a term in one scores 1.
        self._weights = {term: 1.0 - (count - 1) / total for term, count in counts.items()}

    def __len__(self) -> int:
        return len(self.records)

    def score(self, query_terms: frozenset[str], record: MaterialRecord) -> float:
        terms = record.terms
        if not terms or not query_terms:
            return 0.0
        shared = terms & query_terms
        if not shared:
            return 0.0
        earned = sum(self._weights.get(term, 1.0) for term in shared)
        # Normalised by the query, not the record: a long record that happens to cover the
        # whole question is a good answer, not a diluted one.
        possible = sum(self._weights.get(term, 1.0) for term in query_terms) or 1.0
        return (earned / possible) * _KIND_WEIGHT.get(record.kind, 1.0)

    def search(self, query: str, *, limit: int = TOP_K, exclude: frozenset[str] = frozenset()) -> list[MaterialRecord]:
        query_terms = content_words(query)
        scored = [
            (self.score(query_terms, record), index, record)
            for index, record in enumerate(self.records)
            if record.text not in exclude
        ]
        scored = [item for item in scored if item[0] >= MIN_SCORE]
        # Index breaks ties, so the order is stable rather than dependent on sort internals.
        scored.sort(key=lambda item: (-item[0], item[1]))
        return [record for _, _, record in scored[:limit]]


@dataclass(frozen=True, slots=True)
class NoMaterial:
    """The retriever used when the debate has no documents behind it."""

    def search(self, query: str, *, limit: int = TOP_K, exclude: frozenset[str] = frozenset()) -> list[MaterialRecord]:
        return []

    def __len__(self) -> int:
        return 0


def build_retriever(claims: list[dict[str, Any]], names: dict[str, str] | None = None) -> Retriever:
    records = [MaterialRecord.from_doc(c, names) for c in claims if isinstance(c, dict) and c.get("text")]
    return LexicalRetriever(records) if records else NoMaterial()


def material_block(records: list[MaterialRecord]) -> str:
    """The retrieved records as lines for the debater's instruction.

    Each line names its material so the opponent can say where a point comes from, and
    carries the quote so it cannot paraphrase the document into saying something else.
    """
    lines = []
    for record in records:
        where = f" [{record.material_name}]" if record.material_name else ""
        quote = f' — it says: "{record.quote}"' if record.quote else ""
        lines.append(f"- ({record.kind}){where} {record.text}{quote}")
    return "\n".join(lines)
