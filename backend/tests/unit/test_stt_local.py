from __future__ import annotations

from pathlib import Path

import pytest

from app.core.settings import get_settings
from app.platform.transcripts import stt
from app.platform.transcripts.model import Word


def _settings(monkeypatch: pytest.MonkeyPatch, **env: str) -> None:
    for key, value in env.items():
        monkeypatch.setenv(key, value)
    get_settings.cache_clear()


def test_local_real_models_recognise_inline(monkeypatch: pytest.MonkeyPatch) -> None:
    # Locally the chunks are on this machine: batch recognition could never read them.
    _settings(monkeypatch, APP_ENV="local", AI_PROVIDER="vertex", VERTEX_PROJECT="atrium-coach-dev")
    assert isinstance(stt.speech_to_text([]), stt.InlineChirpSpeechToText)


def test_fake_models_stay_fake_locally(monkeypatch: pytest.MonkeyPatch) -> None:
    _settings(monkeypatch, APP_ENV="local", AI_PROVIDER="fake")
    assert isinstance(stt.speech_to_text([]), stt.FakeSpeechToText)


async def test_inline_words_land_on_the_media_clock(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv("LOCAL_OBJECTS_DIR", str(tmp_path))
    _settings(monkeypatch, APP_ENV="local", AI_PROVIDER="vertex", VERTEX_PROJECT="atrium-coach-dev")
    from app.platform.storage.objects import processing

    await processing().write("job/chunk-000.flac", b"first", "audio/flac")
    await processing().write("job/chunk-001.flac", b"second", "audio/flac")

    async def decode(data: bytes, sample_rate: int) -> bytes:
        assert sample_rate == 16_000
        return data

    async def recognise(pcm: bytes, *, sample_rate: int) -> list[Word]:
        return [Word(text=pcm.decode(), start_ms=100, end_ms=400, confidence=0.9)]

    monkeypatch.setattr("app.platform.media.ffmpeg.decode_to_pcm16", decode)
    monkeypatch.setattr(stt, "transcribe_short", recognise)

    engine = stt.InlineChirpSpeechToText()
    chunks = [stt.AudioChunk("job/chunk-000.flac", 0), stt.AudioChunk("job/chunk-001.flac", 900_000)]
    assert await engine.results(await engine.start(chunks, "job/stt/", "en-US")) == {}
    words = await engine.words(chunks, {})

    assert [(w.text, w.start_ms, w.end_ms) for w in words] == [
        ("first", 100, 400),
        ("second", 900_100, 900_400),
    ]
