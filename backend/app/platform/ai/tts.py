"""Spoken examples: a moment's improved answer, read aloud with Gemini-TTS.

Hearing a better version — its pace, emphasis and pauses, not just its words —
makes the advice concrete. The delivery is steered by a style prompt; voices are
prebuilt (never cloned from the user's voice).
"""

from __future__ import annotations

import io
import logging
import math
import time
import wave
from dataclasses import dataclass
from typing import Any, Literal

from google.api_core.exceptions import GoogleAPICallError

from app.core.settings import AiProvider, get_settings
from app.platform.ai.gateway import AiUnavailable
from app.platform.runtime_config import ai_enabled

log = logging.getLogger(__name__)

TTS_MODEL = "gemini-2.5-flash-tts"
Voice = Literal["warm", "deep"]
VOICES: dict[str, str] = {"warm": "Kore", "deep": "Charon"}
MAX_TEXT_CHARS = 700

STYLE_PROMPT = (
    "Read this as a calm, confident job candidate answering an interviewer: a steady pace of about 140 words a "
    "minute, clear articulation, natural emphasis on the key results, a short pause between ideas, and a warm, "
    "sincere tone. Never sound like an advert."
)


@dataclass(frozen=True)
class SpokenExample:
    audio: bytes
    content_type: str
    extension: str


def _tone_wav(seconds: float = 1.0, rate: int = 16_000) -> bytes:
    """Stand-in audio for local development and tests."""
    frames = b"".join(
        int(8000 * math.sin(2 * math.pi * 440 * i / rate)).to_bytes(2, "little", signed=True)
        for i in range(int(seconds * rate))
    )
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(rate)
        out.writeframes(frames)
    return buffer.getvalue()


async def speak_example(text: str, voice: Voice = "warm") -> SpokenExample:
    if not await ai_enabled():
        raise AiUnavailable()
    text = " ".join(text.split())[:MAX_TEXT_CHARS]
    if get_settings().ai_provider is AiProvider.FAKE:
        return SpokenExample(_tone_wav(), "audio/wav", "wav")

    from google.cloud import texttospeech as tts

    started = time.monotonic()
    try:
        response = await tts.TextToSpeechAsyncClient().synthesize_speech(
            input=tts.SynthesisInput(text=text, prompt=STYLE_PROMPT),
            voice=tts.VoiceSelectionParams(language_code="en-US", name=VOICES[voice], model_name=TTS_MODEL),
            audio_config=tts.AudioConfig(audio_encoding=tts.AudioEncoding.MP3),
            timeout=90,
        )
    except GoogleAPICallError as exc:
        log.warning("spoken example failed", extra={"error": type(exc).__name__})
        raise AiUnavailable() from exc
    finally:
        log.info("ai_usage", extra={"purpose": "spoken_example", "model": TTS_MODEL, "characters": len(text),
                                    "latencyMs": int((time.monotonic() - started) * 1000)})
    return SpokenExample(bytes(response.audio_content), "audio/mpeg", "mp3")


PANEL_STYLE_PROMPT = (
    "Speak as an interviewer on a video call asking the candidate a question: natural, friendly and curious, "
    "a conversational pace, as if thinking of the question just now."
)
PANEL_MAX_CHARS = 600
PANEL_TIMEOUT_S = 12


async def speak_as_panelist(text: str, voice: str, rate: int = 24_000, *, fast: bool = False) -> bytes:
    """A panel line as raw PCM16 mono at `rate`, ready for the live call.

    `fast` goes straight to Chirp 3 HD (the same voices, in about a second) instead of trying
    Gemini-TTS first, which can take 5-12 s: for a conversation where every colleague line is
    a reply, not an occasional question (the leadership call).
    """
    text = " ".join(text.split())[:PANEL_MAX_CHARS]
    if get_settings().ai_provider is AiProvider.FAKE:
        return b"\x00\x00" * (rate // 2)

    from google.cloud import texttospeech as tts

    client = tts.TextToSpeechAsyncClient()
    audio_config = tts.AudioConfig(audio_encoding=tts.AudioEncoding.LINEAR16, sample_rate_hertz=rate)

    async def synthesize(model: str, **request: Any) -> Any:
        started = time.monotonic()
        try:
            return await client.synthesize_speech(audio_config=audio_config, timeout=PANEL_TIMEOUT_S, **request)
        finally:
            log.info("ai_usage", extra={"purpose": "panel_question", "model": model, "characters": len(text),
                                        "latencyMs": int((time.monotonic() - started) * 1000)})

    if fast:
        try:
            response = await synthesize(
                "chirp3-hd",
                input=tts.SynthesisInput(text=text),
                voice=tts.VoiceSelectionParams(language_code="en-US", name=f"en-US-Chirp3-HD-{voice}"),
            )
            with wave.open(io.BytesIO(bytes(response.audio_content))) as wav:
                return bytes(wav.readframes(wav.getnframes()))
        except GoogleAPICallError as exc:
            log.warning("fast panel speech failed", extra={"error": type(exc).__name__})
    try:
        response = await synthesize(
            TTS_MODEL,
            input=tts.SynthesisInput(text=text, prompt=PANEL_STYLE_PROMPT),
            voice=tts.VoiceSelectionParams(language_code="en-US", name=voice, model_name=TTS_MODEL),
        )
    except GoogleAPICallError as exc:
        # Gemini-TTS is sometimes slow; the same voice from Chirp 3 HD answers in about a second.
        log.warning("panel question speech failed", extra={"error": type(exc).__name__})
        try:
            response = await synthesize(
                "chirp3-hd",
                input=tts.SynthesisInput(text=text),
                voice=tts.VoiceSelectionParams(language_code="en-US", name=f"en-US-Chirp3-HD-{voice}"),
            )
        except GoogleAPICallError as fallback_exc:
            log.warning("panel question fallback speech failed", extra={"error": type(fallback_exc).__name__})
            raise AiUnavailable() from fallback_exc
    # LINEAR16 arrives as a WAV file; the call wants the samples.
    with wave.open(io.BytesIO(bytes(response.audio_content))) as wav:
        return bytes(wav.readframes(wav.getnframes()))
