from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from app.modules.admission.cache import (
    ImpersonalViolation,
    assert_impersonal,
    cache_key,
    current_cycle,
    from_document,
    is_fresh,
    to_document,
)
from app.modules.admission.catalogs import EvidenceTier, OpportunityKind
from app.modules.admission.evidence import Insight
from app.modules.admission.opportunity import PROFILE_VERSION, OpportunityProfile

NOW = datetime(2026, 9, 23, tzinfo=UTC)


def profile(**over: object) -> OpportunityProfile:
    base: dict[str, object] = {
        "name": "Global Korea Scholarship",
        "kind": OpportunityKind.BOTH,
        "cycle": "2027",
        "summary": "A Korean government scholarship.",
        "officialRequirements": [Insight(text="Applicants must be under 25.", tier=EvidenceTier.OFFICIAL)],
        "sources": {"s1": {"id": "s1", "domain": "gks.go.kr", "title": "GKS", "tier": "official", "published": "2027"}},
    }
    base.update(over)
    return OpportunityProfile(**base)  # type: ignore[arg-type]


class TestKey:
    def test_the_cycle_is_part_of_the_key_so_years_can_never_be_served_for_each_other(self) -> None:
        assert cache_key("GKS", OpportunityKind.BOTH, "2026") != cache_key("GKS", OpportunityKind.BOTH, "2027")

    def test_the_same_opportunity_written_differently_lands_in_one_bucket(self) -> None:
        assert cache_key("Global Korea Scholarship!", OpportunityKind.SCHOLARSHIP, "2026") == cache_key(
            "  global korea   scholarship  ", OpportunityKind.SCHOLARSHIP, "2026"
        )

    def test_a_missing_cycle_gets_its_own_bucket_rather_than_joining_another(self) -> None:
        assert cache_key("GKS", OpportunityKind.BOTH, "") .endswith("no-cycle")

    def test_kinds_do_not_share_research(self) -> None:
        assert cache_key("Oxford", OpportunityKind.UNIVERSITY, "2026") != cache_key(
            "Oxford", OpportunityKind.SCHOLARSHIP, "2026"
        )


class TestCycle:
    def test_the_live_cycle_rolls_over_in_the_second_half_of_the_year(self) -> None:
        assert current_cycle(datetime(2026, 3, 1, tzinfo=UTC)) == "2026"
        assert current_cycle(datetime(2026, 9, 1, tzinfo=UTC)) == "2027"


class TestFreshness:
    def test_research_on_the_live_cycle_goes_stale_quickly(self) -> None:
        entry = {"version": PROFILE_VERSION, "cycle": "2027", "researchedAt": NOW - timedelta(days=10)}
        assert is_fresh(entry, now=NOW)
        entry["researchedAt"] = NOW - timedelta(days=20)
        assert not is_fresh(entry, now=NOW)

    def test_a_closed_cycle_is_kept_far_longer_because_its_pages_will_not_change(self) -> None:
        entry = {"version": PROFILE_VERSION, "cycle": "2024", "researchedAt": NOW - timedelta(days=100)}
        assert is_fresh(entry, now=NOW)

    def test_a_profile_from_an_older_schema_is_never_reused(self) -> None:
        entry = {"version": PROFILE_VERSION - 1, "cycle": "2027", "researchedAt": NOW}
        assert not is_fresh(entry, now=NOW)

    def test_an_entry_with_no_timestamp_is_not_trusted(self) -> None:
        assert not is_fresh({"version": PROFILE_VERSION, "cycle": "2027"}, now=NOW)

    def test_a_naive_timestamp_is_read_as_utc_rather_than_crashing(self) -> None:
        entry = {"version": PROFILE_VERSION, "cycle": "2027", "researchedAt": datetime(2026, 9, 20)}
        assert is_fresh(entry, now=NOW)


class TestImpersonal:
    """Nothing about the candidate who triggered the research may enter a shared document."""

    @pytest.mark.parametrize(
        "text",
        [
            "Your mechanical engineering background is relevant here.",
            "The programme values what you did at university.",
            "The candidate's study plan matches the lab.",
            "This applicant's research proposal fits the lab.",
        ],
    )
    def test_a_profile_that_addresses_a_person_is_refused(self, text: str) -> None:
        tainted = profile(programPriorities=[Insight(text=text, tier=EvidenceTier.INFERENCE)])
        with pytest.raises(ImpersonalViolation):
            assert_impersonal(tainted)

    def test_an_ordinary_profile_passes(self) -> None:
        assert_impersonal(profile())

    def test_caching_runs_the_check(self) -> None:
        tainted = profile(
            officialRequirements=[Insight(text="Your study plan must be two pages.", tier=EvidenceTier.OFFICIAL)]
        )
        with pytest.raises(ImpersonalViolation):
            to_document(tainted, queries=[])

    def test_official_text_written_in_the_second_person_is_not_a_leak(self) -> None:
        """Funders write "you must hold a degree"; quoting that faithfully is not personal data."""
        assert_impersonal(
            profile(
                officialRequirements=[
                    Insight(text="You must be under 25 on the application deadline.", tier=EvidenceTier.OFFICIAL),
                    Insight(text="You must hold a bachelor's degree.", tier=EvidenceTier.OFFICIAL),
                ]
            )
        )


class TestRoundTrip:
    def test_a_stored_profile_reads_back_as_itself(self) -> None:
        document = to_document(profile(), queries=["gks 2027 interview"], now=NOW)
        assert document["key"] == cache_key("Global Korea Scholarship", OpportunityKind.BOTH, "2027")
        assert document["researchedAt"] == NOW
        restored = from_document(document)
        assert restored is not None
        assert restored.name == "Global Korea Scholarship"
        assert restored.officialRequirements[0].tier is EvidenceTier.OFFICIAL

    def test_an_unreadable_entry_is_a_miss_rather_than_a_crash(self) -> None:
        assert from_document({"profile": {"name": 5}}) is None
        assert from_document({}) is None
