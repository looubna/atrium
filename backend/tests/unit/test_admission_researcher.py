from __future__ import annotations

from typing import Any

import pytest

from app.modules.admission.agents import researcher as mod
from app.modules.admission.agents.researcher import OpportunityResearcher
from app.modules.admission.cache import assert_impersonal, to_document
from app.modules.admission.catalogs import OpportunityKind
from app.modules.admission.opportunity import OpportunityRejected
from app.platform.ai.gateway import ResearchResult


class Recorder:
    """Stands in for the app watching research happen (§10)."""

    def __init__(self) -> None:
        self.stages: list[str] = []
        self.sources: list[dict[str, str]] = []
        self.queries: list[str] = []
        self.notes: list[str] = []

    async def stage(self, stage: str) -> None:
        self.stages.append(stage)

    async def found(
        self,
        *,
        notes: str | None = None,
        sources: list[dict[str, str]] | None = None,
        queries: list[str] | None = None,
    ) -> None:
        if notes:
            self.notes.append(notes)
        if sources:
            self.sources.extend(sources)
        if queries:
            self.queries.extend(queries)

    async def waiting(self, seconds: float) -> None:
        return None


async def run(progress: Any = None, **over: Any) -> tuple[Any, list[str], ResearchResult]:
    kwargs: dict[str, Any] = {
        "uid": "u1",
        "name": "Global Korea Scholarship",
        "kind": OpportunityKind.BOTH,
        "cycle": "2026",
        "progress": progress,
    }
    kwargs.update(over)
    return await OpportunityResearcher().run(**kwargs)


@pytest.mark.asyncio
class TestResearch:
    async def test_it_produces_a_validated_profile_from_what_it_retrieved(self) -> None:
        profile, problems, research = await run()
        assert problems == [], "a well-formed draft should need no corrections"
        assert profile.name == "Global Korea Scholarship"
        assert profile.kind is OpportunityKind.BOTH
        assert profile.cycle == "2026"
        assert profile.officialRequirements, "a profile with no requirements is not worth serving"
        # Every insight is anchored to a source that was actually retrieved.
        for insight in profile.officialRequirements + profile.selectionCriteria:
            assert set(insight.sourceIds) <= set(profile.sources)
        assert research.sources

    async def test_it_reports_each_stage_so_the_app_can_show_progress(self) -> None:
        recorder = Recorder()
        await run(progress=recorder)
        assert recorder.stages == ["researching", "profiling", "ready"]
        assert recorder.sources, "the app should see sources as they are retrieved"
        assert recorder.queries

    async def test_the_result_is_safe_to_share_between_candidates(self) -> None:
        profile, _, research = await run()
        assert_impersonal(profile)
        document = to_document(profile, queries=research.queries)
        assert "profile" in document and document["cycle"] == "2026"

    async def test_research_that_retrieves_nothing_is_refused_rather_than_imagined(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The failure mode worth refusing: a plausible scholarship written from memory."""
        monkeypatch.setattr(
            mod,
            "fake_research",
            lambda name: ResearchResult(text="nothing found", sources=[], queries=[], search_suggestions_html=""),
        )
        with pytest.raises(OpportunityRejected):
            await run()

    async def test_the_candidate_is_not_an_input(self) -> None:
        """Nothing in the signature can carry a person: that is what makes the cache safe."""
        import inspect

        params = set(inspect.signature(OpportunityResearcher.run).parameters)
        assert not params & {"candidate", "profile", "materials", "resume", "documents"}
