"""The single path for structured (non-live) model calls.

Every call goes through `ModelGateway.generate`, which:
- refuses work when the kill switch is off;
- picks the model, location, temperature, token limit and thinking level for the
  purpose from configuration, so models can change without touching callers;
- runs an ADK agent with an output schema and a hard cap on model calls;
- optionally streams the answer as it is written (`on_text`), for live progress;
- retries briefly when the model is busy, telling the caller about each wait (`on_wait`);
- records token usage per user and logs latency without any content;
- validates the output against the schema before returning it.

With `AI_PROVIDER=fake`, callers supply a deterministic stand-in instead.
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass
from enum import StrEnum
from typing import Any, TypeVar

from pydantic import BaseModel, ValidationError

from app.core.errors import ServiceUnavailable
from app.core.settings import AiProvider, Settings, get_settings
from app.platform.ai.pricing import input_tokens, output_tokens, token_cost_micros
from app.platform.clients import clients
from app.platform.runtime_config import ai_enabled
from app.platform.usage import Metric, Period, UsageService

log = logging.getLogger(__name__)

T = TypeVar("T", bound=BaseModel)

APP_NAME = "atrium-structured"

#: Receives everything written so far each time more of the answer arrives.
TextCallback = Callable[[str], Awaitable[None]]
#: Receives the web sources and search queries found so far during research.
SourcesCallback = Callable[[list[dict[str, str]], list[str]], Awaitable[None]]
#: Told before waiting to retry a busy model: (attempt number, seconds until the retry).
WaitCallback = Callable[[int, float], Awaitable[None]]

#: Vertex AI answers 429 when shared capacity is briefly exhausted. Seconds to wait before each retry;
#: kept short, and reported to the user instead of being hidden inside the HTTP client.
BUSY_RETRY_DELAYS: tuple[float, ...] = (3.0, 6.0, 12.0, 20.0)
RETRYABLE_STATUS = (429, 500, 502, 503, 504)


class Purpose(StrEnum):
    EVALUATOR = "evaluator"
    STRATEGIST_RESEARCH = "strategist_research"
    BLUEPRINT = "blueprint"
    RESUME_PROFILE = "resume_profile"
    PRACTICE_COACH = "practice_coach"
    PANEL_WRITER = "panel_writer"
    ROUND_PREP = "round_prep"
    EXAM_ANALYSIS = "exam_analysis"
    EXAM_FORMAT = "exam_format"
    DEBATE_ANALYZER = "debate_analyzer"
    DEBATE_BRIEF = "debate_brief"
    DEBATE_TOPICS = "debate_topics"
    DEBATE_MATERIAL = "debate_material"
    DEBATE_EVALUATOR = "debate_evaluator"


@dataclass(frozen=True, slots=True)
class ModelProfile:
    model: str
    location: str
    temperature: float
    max_output_tokens: int
    timeout_s: float
    max_llm_calls: int = 3
    #: Gemini thinking level ("LOW", "MEDIUM", "HIGH"); None keeps the model's default. Measured on
    #: Gemini 3.8 Flash structured output: LOW starts answering after ~2.5 s, the default after ~13 s.
    thinking_level: str | None = None


def profile_for(purpose: Purpose, settings: Settings) -> ModelProfile:
    model, location = settings.text_model, settings.text_location
    match purpose:
        case Purpose.EVALUATOR:
            # Runs in the background after the interview; full reasoning is worth the time.
            return ModelProfile(model, location, temperature=0.2, max_output_tokens=16_000, timeout_s=240)
        case Purpose.STRATEGIST_RESEARCH:
            return ModelProfile(
                model, location, temperature=0.3, max_output_tokens=8_000, timeout_s=240, max_llm_calls=8,
                thinking_level="LOW",
            )
        case Purpose.BLUEPRINT:
            return ModelProfile(
                model, location, temperature=0.3, max_output_tokens=12_000, timeout_s=180, thinking_level="LOW"
            )
        case Purpose.PANEL_WRITER:
            # Written while the candidate waits for the next question: must be quick.
            return ModelProfile(
                model, location, temperature=0.6, max_output_tokens=800, timeout_s=20, thinking_level="LOW"
            )
        case Purpose.PRACTICE_COACH:
            # The user is waiting on the drill screen: short, fast and focused.
            return ModelProfile(
                model, location, temperature=0.2, max_output_tokens=3_000, timeout_s=45, thinking_level="LOW"
            )
        case Purpose.ROUND_PREP:
            # The candidate waits on the journey screen while a long, careful guide is written.
            return ModelProfile(
                model, location, temperature=0.4, max_output_tokens=12_000, timeout_s=120, thinking_level="LOW"
            )
        case Purpose.EXAM_ANALYSIS:
            # Reads a term of slides, notes and past papers in one pass: the long input is the cost.
            return ModelProfile(
                model, location, temperature=0.2, max_output_tokens=14_000, timeout_s=240, thinking_level="LOW"
            )
        case Purpose.EXAM_FORMAT:
            # One decision from research notes: short, and the student is waiting on it.
            return ModelProfile(
                model, location, temperature=0.1, max_output_tokens=1_000, timeout_s=45, thinking_level="LOW"
            )
        case Purpose.DEBATE_ANALYZER:
            # Runs mid-debate, between the opponent's turn and the user's next one. It has
            # perhaps two seconds before it would be steering a turn that already happened,
            # so this is the tightest budget on the platform.
            return ModelProfile(
                model, location, temperature=0.1, max_output_tokens=1_600, timeout_s=12, max_llm_calls=1,
                thinking_level="LOW",
            )
        case Purpose.DEBATE_TOPICS:
            # The user is looking at an empty screen waiting for something to debate.
            return ModelProfile(
                model, location, temperature=0.8, max_output_tokens=2_000, timeout_s=30, thinking_level="LOW"
            )
        case Purpose.DEBATE_BRIEF:
            # Both sides of a motion, argued properly. Worth real reasoning; nobody is waiting
            # on the live model for it.
            return ModelProfile(
                model, location, temperature=0.3, max_output_tokens=12_000, timeout_s=180, thinking_level="LOW"
            )
        case Purpose.DEBATE_MATERIAL:
            # A course reader or a set of papers, read once into retrievable records.
            return ModelProfile(
                model, location, temperature=0.2, max_output_tokens=14_000, timeout_s=240, thinking_level="LOW"
            )
        case Purpose.DEBATE_EVALUATOR:
            # After the debate, over the whole transcript and the argument state.
            return ModelProfile(model, location, temperature=0.2, max_output_tokens=16_000, timeout_s=240)
        case Purpose.RESUME_PROFILE:
            return ModelProfile(
                model, location, temperature=0.1, max_output_tokens=4_000, timeout_s=120, thinking_level="LOW"
            )


class AiUnavailable(ServiceUnavailable):
    code = "ai_unavailable"


class StructuredOutputError(RuntimeError):
    """The model did not return output matching the schema."""


class ModelBusy(StructuredOutputError):
    """The model stayed overloaded (429/5xx) through the retries; try the work again later."""


@dataclass(frozen=True, slots=True)
class MediaRef:
    """A recording the model reads directly from Cloud Storage (`gs://...`), e.g. an answer's audio."""

    uri: str
    mime_type: str


def static_instruction(text: str) -> Callable[[Any], str]:
    """ADK fills `{placeholders}` in plain string instructions from session state; a provider is used verbatim."""

    def provider(_ctx: Any) -> str:
        return text

    return provider


def _gemini(profile: ModelProfile, settings: Settings) -> Any:
    from google.adk.models.google_llm import Gemini

    # No retry options: busy responses are retried by `call_with_busy_retry`, so waits are visible.
    return Gemini(
        model=profile.model,
        client_kwargs={"vertexai": True, "project": settings.ai_project, "location": profile.location},
    )


def _is_busy(exc: BaseException) -> bool:
    from google.genai import errors

    return isinstance(exc, errors.APIError) and exc.code in RETRYABLE_STATUS


async def call_with_busy_retry[R](
    run: Callable[[], Awaitable[R]],
    *,
    delays: Sequence[float] = BUSY_RETRY_DELAYS,
    on_wait: WaitCallback | None = None,
    sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
) -> R:
    """Run `run`, retrying after each delay while the model is busy; then raise `ModelBusy`."""
    for attempt, delay in enumerate(delays, start=1):
        try:
            return await run()
        except Exception as exc:
            if not _is_busy(exc):
                raise
            log.info("model busy; retrying", extra={"attempt": attempt, "delaySeconds": delay})
            if on_wait is not None:
                await on_wait(attempt, delay)
            await sleep(delay)
    try:
        return await run()
    except Exception as exc:
        if _is_busy(exc):
            raise ModelBusy("model busy") from exc
        raise


def _answer_text(content: Any) -> str:
    """The text of a model turn, without thought summaries."""
    if content is None or not content.parts:
        return ""
    return "".join(part.text or "" for part in content.parts if not getattr(part, "thought", False))


def _content_config(profile: ModelProfile, *, low_media_resolution: bool = False) -> Any:
    from google.genai import types

    thinking = (
        types.ThinkingConfig(thinking_level=types.ThinkingLevel(profile.thinking_level))
        if profile.thinking_level
        else None
    )
    return types.GenerateContentConfig(
        temperature=profile.temperature, max_output_tokens=profile.max_output_tokens, thinking_config=thinking,
        # Low resolution is enough to read expressions and posture, at a fraction of the video tokens.
        media_resolution=types.MediaResolution.MEDIA_RESOLUTION_LOW if low_media_resolution else None,
    )


async def _stream_fake(text: str, on_text: TextCallback, pieces: int = 6) -> None:
    """Fake provider: deliver the output in a few pieces, as a streamed response would arrive."""
    size = max(1, -(-len(text) // pieces))
    for end in range(size, len(text) + size, size):
        await on_text(text[: min(end, len(text))])


class ModelGateway:
    async def generate(
        self,
        *,
        purpose: Purpose,
        uid: str,
        instruction: str,
        content: str,
        schema: type[T],
        fake: Callable[[], T] | None = None,
        tools: list[Any] | None = None,
        on_text: TextCallback | None = None,
        on_wait: WaitCallback | None = None,
        media: Sequence[MediaRef] = (),
    ) -> T:
        settings = get_settings()
        if not await ai_enabled():
            raise AiUnavailable()
        if settings.ai_provider is AiProvider.FAKE:
            if fake is None:
                raise RuntimeError(f"no fake output for {purpose.value}")
            result = fake()
            if on_text is not None:
                await _stream_fake(result.model_dump_json(), on_text)
            return result

        from google.adk.agents import Agent
        from google.adk.agents.context import Context
        from google.adk.agents.run_config import RunConfig, StreamingMode  # type: ignore[attr-defined]
        from google.adk.models.llm_response import LlmResponse
        from google.adk.runners import Runner
        from google.adk.sessions import InMemorySessionService
        from google.genai import types

        profile = profile_for(purpose, settings)
        tokens = {"total": 0, "input": 0, "output": 0, "calls": 0}

        # ADK passes callback arguments by keyword; the parameter names are part of the contract.
        def record_usage(callback_context: Context, llm_response: LlmResponse) -> LlmResponse | None:
            if llm_response.partial:
                return None  # streamed pieces; usage is counted once, on the complete response
            tokens["calls"] += 1
            meta = llm_response.usage_metadata
            if meta is not None:
                tokens["total"] += int(meta.total_token_count or 0)
                tokens["input"] += input_tokens(meta)
                tokens["output"] += output_tokens(meta)
            return None

        agent = Agent(
            name=purpose.value,
            model=_gemini(profile, settings),
            instruction=static_instruction(instruction),
            output_schema=schema,
            tools=tools or [],
            generate_content_config=_content_config(profile, low_media_resolution=bool(media)),
            after_model_callback=record_usage,
        )
        session_service = InMemorySessionService()
        runner = Runner(app_name=APP_NAME, agent=agent, session_service=session_service)
        run_config = RunConfig(
            max_llm_calls=profile.max_llm_calls,
            streaming_mode=StreamingMode.SSE if on_text is not None else StreamingMode.NONE,
        )
        started = time.monotonic()
        timing: dict[str, int | None] = {"first_text_ms": None}

        parts = [
            *(types.Part.from_uri(file_uri=item.uri, mime_type=item.mime_type) for item in media),
            types.Part.from_text(text=content),
        ]

        async def run_once() -> str:
            # A fresh session per attempt, so a retry doesn't carry the failed attempt's turn.
            session = await session_service.create_session(app_name=APP_NAME, user_id=uid)
            streamed, final = "", ""
            async with asyncio.timeout(profile.timeout_s):
                async for event in runner.run_async(
                    user_id=uid,
                    session_id=session.id,
                    new_message=types.Content(role="user", parts=parts),
                    run_config=run_config,
                ):
                    if event.partial:
                        piece = _answer_text(event.content)
                        if piece and on_text is not None:
                            if timing["first_text_ms"] is None:
                                timing["first_text_ms"] = int((time.monotonic() - started) * 1000)
                            streamed += piece
                            await on_text(streamed)
                    elif event.is_final_response():
                        text = _answer_text(event.content)
                        if text:
                            final = text
            return final

        outcome = "ok"
        final_text = ""
        try:
            final_text = await call_with_busy_retry(run_once, on_wait=on_wait)
        except TimeoutError:
            outcome = "timeout"
            raise StructuredOutputError(f"{purpose.value} timed out") from None
        except ModelBusy as exc:
            outcome = "busy"
            raise ModelBusy(f"{purpose.value}: model busy") from exc
        except Exception:
            outcome = "error"
            raise
        finally:
            cost = token_cost_micros(
                tokens["input"], tokens["output"], settings.text_input_micros_per_m, settings.text_output_micros_per_m
            )
            log.info(
                "ai_usage",
                extra={
                    "purpose": purpose.value,
                    "model": profile.model,
                    "tokens": tokens["total"],
                    "inputTokens": tokens["input"],
                    "outputTokens": tokens["output"],
                    "estCostMicros": cost,
                    "modelCalls": tokens["calls"],
                    "latencyMs": int((time.monotonic() - started) * 1000),
                    "firstTextMs": timing["first_text_ms"],
                    "outcome": outcome,
                },
            )
            if tokens["calls"]:
                await UsageService(clients.firestore()).record(
                    uid,
                    {Metric.AI_CALLS: tokens["calls"], Metric.AI_TOKENS: tokens["total"],
                     Metric.EST_COST_MICROS: cost or 0},
                    period=Period.MONTH,
                )

        if not final_text.strip():
            raise StructuredOutputError(f"{purpose.value} returned no output")
        try:
            return schema.model_validate_json(final_text)
        except ValidationError as exc:
            raise StructuredOutputError(f"{purpose.value} output does not match its schema") from exc

    async def research(
        self,
        *,
        uid: str,
        instruction: str,
        content: str,
        fake: Callable[[], ResearchResult],
        on_text: TextCallback | None = None,
        on_sources: SourcesCallback | None = None,
        on_wait: WaitCallback | None = None,
    ) -> ResearchResult:
        """Web research with Google Search grounding; returns notes plus the sources actually retrieved."""
        settings = get_settings()
        if not await ai_enabled():
            raise AiUnavailable()
        if settings.ai_provider is AiProvider.FAKE:
            result = fake()
            if on_sources is not None:
                await on_sources(result.sources, result.queries)
            if on_text is not None:
                await _stream_fake(result.text, on_text)
            return result

        from google.adk.agents import Agent
        from google.adk.agents.context import Context
        from google.adk.agents.run_config import RunConfig, StreamingMode  # type: ignore[attr-defined]
        from google.adk.models.llm_response import LlmResponse
        from google.adk.runners import Runner
        from google.adk.sessions import InMemorySessionService
        from google.adk.tools.google_search_tool import google_search
        from google.genai import types

        profile = profile_for(Purpose.STRATEGIST_RESEARCH, settings)
        found: dict[tuple[str, str], dict[str, str]] = {}
        queries: list[str] = []
        suggestions = {"html": ""}
        usage = {"total": 0, "input": 0, "output": 0, "calls": 0}

        def capture(callback_context: Context, llm_response: LlmResponse) -> LlmResponse | None:
            if not llm_response.partial:
                usage["calls"] += 1
                if llm_response.usage_metadata is not None:
                    usage["total"] += int(llm_response.usage_metadata.total_token_count or 0)
                    usage["input"] += input_tokens(llm_response.usage_metadata)
                    usage["output"] += output_tokens(llm_response.usage_metadata)
            grounding = llm_response.grounding_metadata
            if grounding is None:
                return None
            for chunk in grounding.grounding_chunks or []:
                web = chunk.web
                if web is None:
                    continue
                domain = (web.domain or web.title or "").strip().lower().removeprefix("www.")
                title = (web.title or domain).strip()
                if domain:
                    found.setdefault((domain, title), {"title": title[:160], "domain": domain[:253]})
            queries.extend(q for q in grounding.web_search_queries or [] if q not in queries)
            if grounding.search_entry_point and grounding.search_entry_point.rendered_content:
                suggestions["html"] = grounding.search_entry_point.rendered_content
            return None

        def numbered_sources() -> list[dict[str, str]]:
            return [{"id": f"src{i}", **source} for i, source in enumerate(found.values(), start=1)][:20]

        agent = Agent(
            name="interview_researcher",
            model=_gemini(profile, settings),
            instruction=static_instruction(instruction),
            tools=[google_search],
            generate_content_config=_content_config(profile),
            after_model_callback=capture,
        )
        session_service = InMemorySessionService()
        runner = Runner(app_name=APP_NAME, agent=agent, session_service=session_service)
        streaming = on_text is not None or on_sources is not None
        run_config = RunConfig(
            max_llm_calls=profile.max_llm_calls,
            streaming_mode=StreamingMode.SSE if streaming else StreamingMode.NONE,
        )
        reported: dict[str, tuple[int, int]] = {"counts": (0, 0)}

        async def run_once() -> list[str]:
            session = await session_service.create_session(app_name=APP_NAME, user_id=uid)
            streamed, texts = "", []
            async with asyncio.timeout(profile.timeout_s):
                async for event in runner.run_async(
                    user_id=uid,
                    session_id=session.id,
                    new_message=types.Content(role="user", parts=[types.Part.from_text(text=content)]),
                    run_config=run_config,
                ):
                    if on_sources is not None and (len(found), len(queries)) != reported["counts"]:
                        reported["counts"] = (len(found), len(queries))
                        await on_sources(numbered_sources(), list(queries))
                    if event.partial:
                        piece = _answer_text(event.content)
                        if piece and on_text is not None:
                            streamed += piece
                            await on_text(streamed)
                    elif event.is_final_response():
                        text = _answer_text(event.content)
                        if text:
                            texts.append(text)
            return texts

        started, outcome = time.monotonic(), "ok"
        texts: list[str] = []
        try:
            texts = await call_with_busy_retry(run_once, on_wait=on_wait)
        except TimeoutError:
            outcome = "timeout"
            raise StructuredOutputError("research timed out") from None
        except ModelBusy as exc:
            outcome = "busy"
            raise ModelBusy("research: model busy") from exc
        except Exception:
            outcome = "error"
            raise
        finally:
            # Excludes the separately billed Google Search grounding queries (logged as `searchQueries`).
            cost = token_cost_micros(
                usage["input"], usage["output"], settings.text_input_micros_per_m, settings.text_output_micros_per_m
            )
            log.info("ai_usage", extra={"purpose": Purpose.STRATEGIST_RESEARCH.value, "model": profile.model,
                                        "tokens": usage["total"], "inputTokens": usage["input"],
                                        "outputTokens": usage["output"], "estCostMicros": cost,
                                        "modelCalls": usage["calls"], "outcome": outcome,
                                        "latencyMs": int((time.monotonic() - started) * 1000),
                                        "sources": len(found), "searchQueries": len(queries)})
            if usage["calls"]:
                await UsageService(clients.firestore()).record(
                    uid,
                    {Metric.AI_CALLS: usage["calls"], Metric.AI_TOKENS: usage["total"],
                     Metric.EST_COST_MICROS: cost or 0},
                    period=Period.MONTH,
                )
        return ResearchResult(text="\n".join(texts).strip(), sources=numbered_sources(), queries=queries[:10],
                              search_suggestions_html=suggestions["html"][:20_000])


@dataclass(frozen=True)
class ResearchResult:
    text: str
    sources: list[dict[str, str]]
    queries: list[str]
    #: Google Search Suggestions markup that must be shown with grounded results (render sandboxed).
    search_suggestions_html: str


gateway = ModelGateway()
