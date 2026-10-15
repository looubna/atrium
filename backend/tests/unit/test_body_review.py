"""The AI review of flagged moments: clips cut right, verdicts applied, measurements never changed."""

from __future__ import annotations

from typing import Any

import pytest

from app.platform.ai import gateway as gateway_module
from app.platform.ai.gateway import MediaRef
from app.platform.media import body_review
from app.platform.media.body import BodyFinding, BodyReport
from app.platform.media.body_review import MAX_CLIPS, BodyReviewDraft, ClipReview, clip_bounds, review_findings


def finding(start_s: int, end_s: int, confidence: str = "medium", check: str = "sway") -> BodyFinding:
    return BodyFinding(
        id=f"{check}-{start_s}", check=check, kind="heuristic", start_ms=start_s * 1000, end_ms=end_s * 1000,  # type: ignore[arg-type]
        observation="Measured sway.", measurements={"seconds": end_s - start_s}, confidence=confidence,  # type: ignore[arg-type]
        exercise_id="anchor-your-stance", scenario="interview",
    )


def report(*findings: BodyFinding) -> BodyReport:
    return BodyReport(framing="upper_body", tracked_seconds=100, body_visible_pct=100, hands_visible_pct=100,
                      clear_pct=100, pose_hz=4, findings=list(findings))


VIDEO = MediaRef("gs://bucket/users/u/sessions/s/video-1.mp4", "video/mp4")


def test_clips_follow_the_video_clock_with_a_little_context() -> None:
    # The camera started 5 s into the session: a finding at 20-30 s is 15-25 s into the video.
    assert clip_bounds(finding(20, 30), 5_000) == (13.0, 27.0)
    assert clip_bounds(finding(0, 4), 3_000) == (0.0, 3.0)
    assert clip_bounds(finding(0, 2), 10_000) is None
    start, end = clip_bounds(finding(10, 100), 0) or (0, 0)
    assert end - start == body_review.MAX_CLIP_S


class FakeGateway:
    def __init__(self, reviews: list[ClipReview]) -> None:
        self.reviews = reviews
        self.calls: list[dict[str, Any]] = []

    async def generate(self, **kwargs: Any) -> BodyReviewDraft:
        self.calls.append(kwargs)
        return BodyReviewDraft(reviews=self.reviews)


@pytest.fixture
def fake(monkeypatch: pytest.MonkeyPatch) -> Any:
    def install(reviews: list[ClipReview]) -> FakeGateway:
        g = FakeGateway(reviews)
        monkeypatch.setattr(body_review, "gateway", g)
        return g

    return install


async def test_verdicts_are_applied_without_touching_the_measurement(fake: Any) -> None:
    g = fake([
        ClipReview(findingId="sway-20", verdict="confirmed", whatISee="You shift  from foot\nto foot.",
                   howToFix="Plant both feet."),
        ClipReview(findingId="sway-60", verdict="not_seen", whatISee="You stand still.", howToFix="ignored"),
        ClipReview(findingId="sway-99", verdict="confirmed", whatISee="made up", howToFix="made up"),
    ])
    original = report(finding(20, 34), finding(60, 75), finding(90, 95, confidence="low"))
    out = await review_findings("u", original, VIDEO, 0)

    first, second, third = out.findings
    assert first.review == {"verdict": "confirmed", "whatISee": "You shift from foot to foot.",
                            "howToFix": "Plant both feet."}
    assert (first.start_ms, first.measurements, first.observation) == (20_000, {"seconds": 14}, "Measured sway.")
    assert second.review == {"verdict": "not_seen", "whatISee": "You stand still.", "howToFix": ""}
    assert not second.shown() and first.shown()
    assert third.review is None and third.shown()
    assert out.summary()["findingCount"] == 2

    media = g.calls[0]["media"]
    assert all(m.high_resolution and m.fps == body_review.CLIP_FPS and m.uri == VIDEO.uri for m in media)
    assert [m.start_s for m in media] == [18.0, 58.0, 88.0]
    assert "<findings>" in g.calls[0]["content"]


async def test_only_a_few_clips_and_the_most_trustworthy_first(fake: Any) -> None:
    g = fake([])
    findings = [finding(i * 30, i * 30 + 12, confidence="low") for i in range(MAX_CLIPS)]
    findings.append(finding(500, 520, confidence="high"))
    await review_findings("u", report(*findings), VIDEO, 0)
    media = g.calls[0]["media"]
    assert len(media) == MAX_CLIPS
    assert 498.0 in [m.start_s for m in media]


async def test_nothing_to_review_makes_no_call(fake: Any) -> None:
    g = fake([])
    out = await review_findings("u", report(finding(0, 2)), VIDEO, 60_000)
    assert g.calls == [] and out.findings[0].review is None


async def test_the_fake_provider_reviews_without_watching(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.core.settings import AiProvider, get_settings

    monkeypatch.setattr(get_settings(), "ai_provider", AiProvider.FAKE)

    async def enabled() -> bool:
        return True

    monkeypatch.setattr(gateway_module, "ai_enabled", enabled)
    out = await review_findings("u", report(finding(20, 34)), VIDEO, 0)
    assert out.findings[0].review is not None and out.findings[0].review["verdict"] == "confirmed"
