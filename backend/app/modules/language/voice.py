"""A native voice for any word or line the learner wants to hear again.

The live tutor speaks both languages in one voice, and in a turn that mixes them its target-language
words drift toward the accent of the sentence around them. For hearing a phrase again (replay,
slower, the word bank, the vocab coach) this is the same voice family (Zephyr) from Chirp 3 HD,
in the target language's own locale: native pronunciation, and in about a second.
"""

from __future__ import annotations

import logging
import time
from collections import OrderedDict

from google.api_core.exceptions import GoogleAPICallError

from app.core.settings import AiProvider, get_settings
from app.modules.language.catalog import Language
from app.platform.ai.gateway import AiUnavailable

log = logging.getLogger(__name__)

VOICE = "Zephyr"
MAX_CHARS = 300
#: Replayed lines repeat (the same word bank, the same card): kept for a while, in memory.
_CACHE: OrderedDict[tuple[str, str, bool], bytes] = OrderedDict()
_CACHE_SIZE = 400


async def native_audio(text: str, lang: Language, *, slow: bool = False) -> bytes | None:
    """MP3 of `text` said by a native speaker of `lang`; None where there is no AI (local fake)."""
    text = " ".join(text.split())[:MAX_CHARS]
    key = (lang.live, text, slow)
    if key in _CACHE:
        _CACHE.move_to_end(key)
        return _CACHE[key]
    if get_settings().ai_provider is AiProvider.FAKE:
        return None

    from google.cloud import texttospeech as tts

    started = time.monotonic()
    try:
        response = await tts.TextToSpeechAsyncClient().synthesize_speech(
            input=tts.SynthesisInput(text=text),
            voice=tts.VoiceSelectionParams(language_code=lang.live, name=f"{lang.live}-Chirp3-HD-{VOICE}"),
            audio_config=tts.AudioConfig(audio_encoding=tts.AudioEncoding.MP3, speaking_rate=0.72 if slow else 0.95),
            timeout=15,
        )
    except GoogleAPICallError as exc:
        log.warning("native voice failed", extra={"error": type(exc).__name__})
        raise AiUnavailable() from exc
    finally:
        log.info("ai_usage", extra={"purpose": "language_voice", "model": "chirp3-hd", "characters": len(text),
                                    "latencyMs": int((time.monotonic() - started) * 1000)})
    audio = bytes(response.audio_content)
    _CACHE[key] = audio
    if len(_CACHE) > _CACHE_SIZE:
        _CACHE.popitem(last=False)
    return audio
