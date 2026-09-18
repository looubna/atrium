"""Gemini Live through ADK bidi streaming.

ADK keeps the latest session-resumption handle and reconnects on the Live
API's GoAway by itself. Across Cloud Run instances the gateway persists the
handle and passes it back through `LiveAgentSpec.resumption_handle`.
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any

from google.adk.agents import Agent, LiveRequestQueue

# Documented import path; StreamingMode is defined in a private ADK module and
# re-exported here without an explicit export marker.
from google.adk.agents.run_config import RunConfig, StreamingMode  # type: ignore[attr-defined]
from google.adk.models.google_llm import Gemini
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService, Session
from google.adk.tools.function_tool import FunctionTool
from google.genai import types

from app.core.settings import get_settings
from app.platform.agents.live import (
    AudioOut,
    BoardWrite,
    EndRequested,
    EngineError,
    InputText,
    Interrupted,
    LiveAgentSpec,
    LiveConnection,
    LiveEvent,
    OutputText,
    PanelTurn,
    ResumptionHandle,
    TurnComplete,
    Usage,
)

log = logging.getLogger(__name__)

APP_NAME = "atrium-live"
#: A board holds a problem, not an essay.
MAX_BOARD_TEXT = 1_200
COMPRESSION_TRIGGER_TOKENS = 32_000
COMPRESSION_TARGET_TOKENS = 16_000


def end_interview(reason: str) -> dict[str, str]:
    """End the interview. Call this only after you have closed the conversation
    politely, or when the candidate clearly asks to stop.

    Args:
        reason: A few words on why the interview is ending.
    """
    return {"status": "ending"}


def give_floor(colleague: str, words: str, purpose: str = "question") -> dict[str, str]:
    """Give one panel colleague the floor to ask their question, in their own voice.
    Call it as the last thing in your turn, then stay silent.

    Args:
        colleague: The colleague's first name, exactly as given in your instructions.
        words: The question the colleague asks, in their own words (first person).
        purpose: Always "question".
    """
    if purpose == "question":
        return {"status": "speaking", "next": "Your colleague is asking now. Stay silent and listen to the answer."}
    return {"status": "speaking", "next": "Your colleague is greeting the candidate. Carry on when you are ready."}


def write_on_board(text: str) -> dict[str, str]:
    """Write on the board so the student can see it. Use it for anything they cannot
    hold in their head from hearing it once: a problem statement, its numbers and units,
    a dataset, an equation to work from. Keep it to the few lines you would really write
    on a board, and say it out loud as well.

    Args:
        text: Exactly what appears on the board, in plain text, over a few short lines.
    """
    return {"status": "written"}


def _static_instruction(text: str) -> Any:
    """Provide the instruction verbatim: ADK fills `{placeholders}` from session
    state in plain string instructions, and interview material can contain braces."""

    def provider(_ctx: Any) -> str:
        return text

    return provider


def build_run_config(spec: LiveAgentSpec) -> RunConfig:
    return RunConfig(
        streaming_mode=StreamingMode.BIDI,
        response_modalities=[types.Modality.AUDIO],
        speech_config=types.SpeechConfig(
            language_code=spec.language_code,
            voice_config=types.VoiceConfig(
                prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=spec.voice_name)
            ),
        ),
        input_audio_transcription=types.AudioTranscriptionConfig(),
        output_audio_transcription=types.AudioTranscriptionConfig(),
        realtime_input_config=types.RealtimeInputConfig(
            automatic_activity_detection=types.AutomaticActivityDetection(
                end_of_speech_sensitivity=types.EndSensitivity.END_SENSITIVITY_LOW,
                silence_duration_ms=spec.silence_duration_ms,
                prefix_padding_ms=200,
            ),
            activity_handling=types.ActivityHandling.START_OF_ACTIVITY_INTERRUPTS,
        ),
        session_resumption=types.SessionResumptionConfig(handle=spec.resumption_handle),
        context_window_compression=types.ContextWindowCompressionConfig(
            trigger_tokens=COMPRESSION_TRIGGER_TOKENS,
            sliding_window=types.SlidingWindow(target_tokens=COMPRESSION_TARGET_TOKENS),
        ),
    )


def map_event(event: Any) -> list[LiveEvent]:
    """Translate one ADK event into engine-neutral events."""
    out: list[LiveEvent] = []
    update = getattr(event, "live_session_resumption_update", None)
    if update is not None and getattr(update, "resumable", False) and getattr(update, "new_handle", None):
        out.append(ResumptionHandle(str(update.new_handle)))

    usage = getattr(event, "usage_metadata", None)
    if usage is not None:
        prompt = int(getattr(usage, "prompt_token_count", 0) or 0)
        response = int(
            getattr(usage, "response_token_count", None) or getattr(usage, "candidates_token_count", 0) or 0
        )
        total = int(getattr(usage, "total_token_count", 0) or prompt + response)
        out.append(Usage(prompt, response, total))

    transcription = getattr(event, "input_transcription", None)
    if transcription is not None and (transcription.text or transcription.finished):
        out.append(InputText(transcription.text or "", bool(transcription.finished)))
    transcription = getattr(event, "output_transcription", None)
    if transcription is not None and (transcription.text or transcription.finished):
        out.append(OutputText(transcription.text or "", bool(transcription.finished)))

    content = getattr(event, "content", None)
    for part in (content.parts or []) if content is not None else []:
        blob = part.inline_data
        if blob is not None and blob.data and (blob.mime_type or "").startswith("audio/pcm"):
            out.append(AudioOut(bytes(blob.data)))

    for call in event.get_function_calls() if hasattr(event, "get_function_calls") else []:
        if call.name == "end_interview":
            reason = str((call.args or {}).get("reason", ""))[:200]
            out.append(EndRequested(reason))
        elif call.name == "give_floor":
            args = call.args or {}
            colleague, words = str(args.get("colleague", ""))[:80], str(args.get("words", ""))[:600]
            if str(args.get("purpose", "")).lower() == "hello":
                out.append(PanelTurn(colleague, words, "hello"))
            else:
                out.append(PanelTurn(colleague, words, "question"))
        elif call.name == "write_on_board":
            written = str((call.args or {}).get("text", ""))[:MAX_BOARD_TEXT]
            if written.strip():
                out.append(BoardWrite(written))

    if getattr(event, "interrupted", False):
        out.append(Interrupted())
    if getattr(event, "turn_complete", False):
        out.append(TurnComplete())
    if getattr(event, "error_code", None):
        out.append(EngineError(str(event.error_code)))
    return out


@dataclass
class AdkLiveConnection:
    runner: Runner
    session: Session
    queue: LiveRequestQueue
    run_config: RunConfig
    user_id: str

    async def send_audio(self, pcm16k: bytes) -> None:
        self.queue.send_realtime(types.Blob(mime_type="audio/pcm;rate=16000", data=pcm16k))

    async def send_text(self, text: str) -> None:
        self.queue.send_content(types.Content(role="user", parts=[types.Part.from_text(text=text)]))

    async def send_image(self, jpeg: bytes) -> None:
        # The board as the student has written it, on the same realtime channel as the audio.
        self.queue.send_realtime(types.Blob(mime_type="image/jpeg", data=jpeg))

    async def events(self) -> AsyncIterator[LiveEvent]:
        async for event in self.runner.run_live(
            user_id=self.user_id,
            session_id=self.session.id,
            live_request_queue=self.queue,
            run_config=self.run_config,
        ):
            for mapped in map_event(event):
                yield mapped

    async def close(self) -> None:
        self.queue.close()


def warm_up() -> None:
    """Import the live flow and create the model client once, off the event loop."""
    import google.adk.flows.llm_flows.base_llm_flow
    import google.adk.models.gemini_llm_connection  # noqa: F401

    settings = get_settings()
    model = Gemini(
        model=settings.live_model,
        client_kwargs={"vertexai": True, "project": settings.ai_project, "location": settings.live_location},
    )
    _ = model.api_client
    log.info("live stack warmed up")


class AdkLiveEngine:
    async def connect(self, spec: LiveAgentSpec, *, user_id: str, session_id: str) -> LiveConnection:
        settings = get_settings()
        model = Gemini(
            model=settings.live_model,
            client_kwargs={
                "vertexai": True,
                "project": settings.ai_project,
                "location": settings.live_location,
            },
        )
        tools = [
            FunctionTool(fn)
            for name, fn in (
                ("end_interview", end_interview),
                ("give_floor", give_floor),
                ("write_on_board", write_on_board),
            )
            if name in spec.tools
        ]
        for tool in tools:
            if tool.name == "write_on_board":
                # Writing is part of asking: the examiner carries straight on speaking.
                tool.response_scheduling = types.FunctionResponseScheduling.SILENT
            if tool.name == "give_floor":
                # The colleague asks next and the candidate answers: the result must not start
                # the lead talking again (a blocking result makes it restart its turn).
                tool.response_scheduling = types.FunctionResponseScheduling.SILENT
        agent = Agent(
            name="interviewer",
            model=model,
            instruction=_static_instruction(spec.system_instruction),
            tools=tools,
        )
        session_service = InMemorySessionService()
        runner = Runner(app_name=APP_NAME, agent=agent, session_service=session_service)
        session = await session_service.create_session(app_name=APP_NAME, user_id=user_id)
        return AdkLiveConnection(
            runner=runner,
            session=session,
            queue=LiveRequestQueue(),
            run_config=build_run_config(spec),
            user_id=user_id,
        )
