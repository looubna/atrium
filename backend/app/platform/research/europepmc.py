"""Searching the published research: Europe PMC, the open index of biomedical and life-science
papers (PubMed and more), free and without a key.

Used live by the Brain Lab's neuroscientist (`find_research`) to look up what the evidence says
while the user talks, and offline to verify the sources the app cites. Strongest evidence first:
meta-analyses and systematic reviews, then randomised trials, then everything else.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass

import httpx

log = logging.getLogger(__name__)

API = "https://www.ebi.ac.uk/europepmc/webservices/rest/search"
TIMEOUT_S = 6.0
#: Publication types, strongest evidence first.
STRONG = ('"meta-analysis"', '"systematic review"', '"randomized controlled trial"')


@dataclass(frozen=True, slots=True)
class Paper:
    title: str
    authors: str
    journal: str
    year: str
    kind: str
    cited_by: int
    doi: str
    pmid: str

    @property
    def url(self) -> str:
        if self.doi:
            return f"https://doi.org/{self.doi}"
        return f"https://europepmc.org/article/MED/{self.pmid}" if self.pmid else ""

    def cite(self) -> str:
        """One line a listener can follow: first author, year, journal, kind of study."""
        first = self.authors.split(",")[0].strip().rstrip(".") or "Unknown"
        more = " et al." if "," in self.authors else ""
        return f"{first}{more} ({self.year}), {self.journal} — {self.kind}: {self.title}"


def _kind(types: list[str]) -> str:
    lowered = [t.lower() for t in types]
    for label in ("meta-analysis", "systematic review", "randomized controlled trial", "review"):
        if any(label in t for t in lowered):
            return label
    return "study"


def _clean(text: str) -> str:
    return re.sub(r"<[^>]+>", "", text or "").strip()


async def search(query: str, *, limit: int = 3, strong_only: bool = True) -> list[Paper]:
    """The most relevant papers for `query`, meta-analyses and trials first. Empty on any failure.

    The exact phrase in a title or abstract first ("mental contrasting" is a method, not two words);
    then every word; then, if the strongest study types have nothing, any study.
    """
    query = " ".join(query.replace('"', " ").split())[:200]
    if not query:
        return []
    words = [w for w in re.findall(r"[\w'-]+", query) if len(w) > 2][:8]
    for topic in (f'(TITLE:"{query}" OR ABSTRACT:"{query}")',
                  " AND ".join(f'(TITLE:"{w}" OR ABSTRACT:"{w}")' for w in words)):
        if not topic:
            continue
        papers = await _search(topic, limit, strong_only)
        if papers:
            return papers
    return await search(query, limit=limit, strong_only=False) if strong_only else []


async def _search(topic: str, limit: int, strong_only: bool) -> list[Paper]:
    pub_types = " OR ".join(f"PUB_TYPE:{t}" for t in STRONG)
    full = f"({topic}) AND ({pub_types})" if strong_only else topic
    # Europe PMC's own relevance order; the strongest study types are then brought forward.
    params = {"query": full, "format": "json", "pageSize": "12", "resultType": "core"}
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT_S) as client:
            response = await client.get(API, params=params)
            response.raise_for_status()
            results = response.json().get("resultList", {}).get("result", [])
    except (httpx.HTTPError, ValueError) as exc:
        log.warning("research search failed", extra={"error": type(exc).__name__})
        return []
    papers = [
        Paper(
            title=_clean(r.get("title", "")).rstrip("."),
            authors=_clean(r.get("authorString", "")),
            journal=_clean(
                (r.get("journalInfo") or {}).get("journal", {}).get("title", "") or r.get("journalTitle", "")
            ),
            year=str(r.get("pubYear", "")),
            kind=_kind(((r.get("pubTypeList") or {}).get("pubType")) or []),
            cited_by=int(r.get("citedByCount") or 0),
            doi=str(r.get("doi") or ""),
            pmid=str(r.get("pmid") or ""),
        )
        for r in results
        if r.get("title")
    ]
    rank = {"meta-analysis": 0, "systematic review": 1, "randomized controlled trial": 2, "review": 3, "study": 4}
    # Among the most relevant, the strongest evidence first; the order among equals is relevance.
    papers.sort(key=lambda p: rank.get(p.kind, 5))
    return papers[:limit]
