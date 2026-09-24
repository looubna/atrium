"""Research about an opportunity, kept once and shared between candidates.

Researching GKS 2026 costs a grounded model call, a dozen web fetches and the better part of
a minute. The answer is the same for everyone applying to GKS 2026, so doing it per candidate
would be paying repeatedly for one fact. This is the first store in the codebase that is
deliberately *not* scoped to a uid, which is worth stating plainly because every other path in
`firestore/paths.py` exists to make cross-user reads impossible.

What makes it safe is that an `OpportunityProfile` is about the opportunity and never about a
person: it is built from public pages, and the candidate's own documents are analysed
elsewhere and never merged into it. `assert_impersonal` enforces that at the boundary rather
than trusting the pipeline to keep being right.

Freshness (§32) is the other half. Requirements change between cycles and sometimes within
one, so a profile is stamped with the cycle it describes and the time it was written, and a
profile for the cycle a candidate is actually applying to expires far sooner than one kept for
its historical interview accounts. A stale entry is never silently mixed with a fresh one:
the key includes the cycle, so last year's requirements can only ever be read as last year's.
"""

from __future__ import annotations

import re
from datetime import UTC, datetime, timedelta
from typing import Any

from app.modules.admission.catalogs import OpportunityKind
from app.modules.admission.opportunity import PROFILE_VERSION, OpportunityProfile

#: Top-level collection. Not under a user, by design; see the module docstring.
COLLECTION = "opportunityResearch"

#: How long research stands before it is worth doing again. A live cycle is short because a
#: funder can post a correction, a deadline change or the interview format at any point.
FRESH_CURRENT_CYCLE = timedelta(days=14)
#: A closed cycle is history: the pages are not going to change, and what we keep it for is
#: the interview accounts.
FRESH_PAST_CYCLE = timedelta(days=180)

_SLUG = re.compile(r"[^a-z0-9]+")
MAX_SLUG = 80


def slug(value: str) -> str:
    return _SLUG.sub("-", str(value).lower()).strip("-")[:MAX_SLUG]


def cache_key(name: str, kind: OpportunityKind, cycle: str) -> str:
    """The document id for one opportunity in one cycle.

    The cycle is part of the key rather than a field, so a request for 2026 can never be
    served 2024's requirements however stale the store gets. An unknown cycle gets its own
    bucket for the same reason: it is a different claim, not a missing field.
    """
    parts = [slug(name) or "unnamed", str(kind), slug(cycle) or "no-cycle"]
    return "--".join(parts)


def current_cycle(now: datetime | None = None) -> str:
    """The cycle a candidate applying today is most likely preparing for.

    Admission cycles are named for the year of entry and open the year before, so from the
    second half of a year the live cycle is the next one. Only a default: whatever the
    candidate or the research says wins.
    """
    moment = now or datetime.now(UTC)
    return str(moment.year + 1 if moment.month >= 7 else moment.year)


def is_fresh(entry: dict[str, Any], *, now: datetime | None = None) -> bool:
    """Whether stored research may be reused as it stands."""
    if int(entry.get("version") or 0) != PROFILE_VERSION:
        return False
    researched = entry.get("researchedAt")
    if not isinstance(researched, datetime):
        return False
    if researched.tzinfo is None:
        researched = researched.replace(tzinfo=UTC)
    moment = now or datetime.now(UTC)
    live = str(entry.get("cycle") or "") >= current_cycle(moment)
    return moment - researched <= (FRESH_CURRENT_CYCLE if live else FRESH_PAST_CYCLE)


class ImpersonalViolation(ValueError):
    """Raised rather than writing anything about a candidate into a shared document."""


#: The shapes a leak takes: a reference to the candidate's own materials or history. Note what
#: is deliberately absent — a bare "you". Official pages are routinely written in the second
#: person ("you must hold a bachelor's degree"), and a requirement quoted faithfully from one
#: is not personal data; rejecting it would fail the honest case while catching nothing.
_PERSONAL = re.compile(
    r"\b("
    r"the candidate'?s\b"
    r"|this applicant'?s?\b"
    # "your background" but also "your mechanical engineering background": the giveaway noun
    # is often a few adjectives away from the possessive.
    r"|your (?:[\w-]+ ){0,3}(?:cv|resume|study plan|research proposal|personal statement|motivation letter"
    r"|essay|portfolio"
    r"|background|experience|degree|project|publication|profile|materials)\b"
    r"|what you (?:did|studied|wrote|built|researched|published)\b"
    r")",
    re.IGNORECASE,
)


def assert_impersonal(profile: OpportunityProfile) -> None:
    """Refuse to cache a profile that has picked up anything about the person who triggered it.

    The failure this guards against is not malice but drift: one day someone passes the
    candidate's materials into the research prompt to make the questions sharper, the model
    quotes their study plan back as a "programme priority", and it is served to every other
    applicant. Cheap to check, and the alternative is a privacy incident.

    A backstop, not a classifier. The real protection is structural — the researcher is never
    handed the candidate's documents — and this catches the day somebody changes that.
    """
    for field_name in ("officialRequirements", "selectionCriteria", "programPriorities", "interviewFormat"):
        for insight in getattr(profile, field_name):
            if match := _PERSONAL.search(insight.text):
                raise ImpersonalViolation(
                    f"{field_name} refers to a specific candidate ({match.group(0)!r}) "
                    f"and must not be cached: {insight.text[:80]!r}"
                )


def to_document(profile: OpportunityProfile, *, queries: list[str], now: datetime | None = None) -> dict[str, Any]:
    """The stored shape. `queries` is kept so a later run can see what was already searched."""
    assert_impersonal(profile)
    return {
        "key": cache_key(profile.name, profile.kind, profile.cycle),
        "name": profile.name,
        "kind": str(profile.kind),
        "cycle": profile.cycle,
        "version": PROFILE_VERSION,
        "researchedAt": now or datetime.now(UTC),
        "queries": queries[:40],
        "profile": profile.model_dump(mode="json"),
    }


def from_document(entry: dict[str, Any]) -> OpportunityProfile | None:
    """The profile in a stored entry, or None when it cannot be read as one any more."""
    try:
        return OpportunityProfile.model_validate(entry.get("profile") or {})
    except ValueError:
        return None
