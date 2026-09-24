"""Speech-to-Text for the candidate track.

Production uses Speech-to-Text v2 batch recognition with Chirp 3 (word time
offsets and confidence), reading FLAC chunks from the processing bucket and
writing JSON results next to them. Recognition is a long-running operation:
the pipeline starts it, stores the operation names, and polls from a later
task instead of blocking a request.

`FakeSpeechToText` stands in locally and in tests: it spreads the live turn
log's candidate text over each turn's time window.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Protocol

from google.api_core.client_options import ClientOptions
from google.cloud.speech_v2 import SpeechAsyncClient
from google.cloud.speech_v2.types import cloud_speech as cs

from app.core.settings import AiProvider, Env, get_settings
from app.platform.storage.objects import processing
from app.platform.transcripts.model import Word

MAX_FILES_PER_REQUEST = 5


class SttFailed(RuntimeError):
    def __init__(self, message: str, *, retryable: bool) -> None:
        super().__init__(message)
        self.retryable = retryable


@dataclass(frozen=True)
class AudioChunk:
    name: str  # object name in the processing bucket
    offset_ms: int


@dataclass(frozen=True)
class CandidateTurn:
    text: str
    start_ms: int
    end_ms: int


class SpeechToText(Protocol):
    async def start(self, chunks: list[AudioChunk], output_prefix: str, language: str) -> list[str]:
        """Starts recognition; returns operation names to poll."""
        ...

    async def results(self, operations: list[str]) -> dict[str, str] | None:
        """None while running; when done, maps input object name to result object name."""
        ...

    async def words(self, chunks: list[AudioChunk], result_names: dict[str, str]) -> list[Word]:
        """Words on the media clock (chunk offsets applied)."""
        ...


class ChirpSpeechToText:
    def __init__(self) -> None:
        settings = get_settings()
        self.location = settings.speech_location
        self.project = settings.ai_project
        self.bucket = settings.processing_bucket
        self.client = SpeechAsyncClient(
            client_options=ClientOptions(api_endpoint=f"{self.location}-speech.googleapis.com")
        )

    async def start(self, chunks: list[AudioChunk], output_prefix: str, language: str) -> list[str]:
        config = cs.RecognitionConfig(
            auto_decoding_config=cs.AutoDetectDecodingConfig(),
            model="chirp_3",
            language_codes=[language],
            # Chirp 3 rejects enable_word_confidence ("Recognizer does not support feature:
            # word_level_confidence"); word timings are what feedback needs.
            features=cs.RecognitionFeatures(
                enable_word_time_offsets=True,
                enable_automatic_punctuation=True,
            ),
        )
        operations: list[str] = []
        for i in range(0, len(chunks), MAX_FILES_PER_REQUEST):
            group = chunks[i : i + MAX_FILES_PER_REQUEST]
            request = cs.BatchRecognizeRequest(
                recognizer=f"projects/{self.project}/locations/{self.location}/recognizers/_",
                config=config,
                files=[cs.BatchRecognizeFileMetadata(uri=f"gs://{self.bucket}/{c.name}") for c in group],
                recognition_output_config=cs.RecognitionOutputConfig(
                    gcs_output_config=cs.GcsOutputConfig(uri=f"gs://{self.bucket}/{output_prefix}")
                ),
            )
            operation = await self.client.batch_recognize(request=request)
            operations.append(operation.operation.name)
        return operations

    async def results(self, operations: list[str]) -> dict[str, str] | None:
        mapping: dict[str, str] = {}
        prefix = f"gs://{self.bucket}/"
        for name in operations:
            op = await self.client.get_operation(request={"name": name})
            if not op.done:
                return None
            if op.HasField("error") and op.error.code:
                # Invalid audio and similar are permanent; quota and internal errors can be retried.
                raise SttFailed(f"recognition failed ({op.error.code})", retryable=op.error.code in (8, 13, 14))
            response = cs.BatchRecognizeResponse.deserialize(op.response.value)
            for uri, result in response.results.items():
                if result.error and result.error.code:
                    raise SttFailed(f"recognition failed for a chunk ({result.error.code})", retryable=False)
                mapping[uri.removeprefix(prefix)] = result.cloud_storage_result.uri.removeprefix(prefix)
        return mapping

    async def words(self, chunks: list[AudioChunk], result_names: dict[str, str]) -> list[Word]:
        store = processing()
        out: list[Word] = []
        for chunk in chunks:
            result_name = result_names.get(chunk.name)
            if result_name is None:
                raise SttFailed("missing recognition result for a chunk", retryable=False)
            data = await store.read(result_name)
            parsed = cs.BatchRecognizeResults.from_json(data.decode(), ignore_unknown_fields=True)
            for result in parsed.results:
                if not result.alternatives:
                    continue
                for info in result.alternatives[0].words:
                    start = chunk.offset_ms + int(info.start_offset.total_seconds() * 1000)
                    end = chunk.offset_ms + int(info.end_offset.total_seconds() * 1000)
                    out.append(Word(text=info.word, start_ms=start, end_ms=max(start, end),
                                    confidence=float(info.confidence) if info.confidence else None))
        return out


class FakeSpeechToText:
    """Deterministic stand-in: candidate turn text spread evenly over each turn's window."""

    def __init__(self, turns: list[CandidateTurn]) -> None:
        self.turns = turns

    async def start(self, chunks: list[AudioChunk], output_prefix: str, language: str) -> list[str]:
        return ["fake-operation"]

    async def results(self, operations: list[str]) -> dict[str, str] | None:
        return {}

    async def words(self, chunks: list[AudioChunk], result_names: dict[str, str]) -> list[Word]:
        out: list[Word] = []
        for turn in self.turns:
            tokens = turn.text.split()
            if not tokens:
                continue
            span = max(len(tokens) * 250, turn.end_ms - turn.start_ms)
            step = span // len(tokens)
            for i, token in enumerate(tokens):
                start = turn.start_ms + i * step
                out.append(Word(text=token, start_ms=start, end_ms=start + max(1, step - 40), confidence=0.95))
        return out


class InlineChirpSpeechToText:
    """Real Chirp 3 for local development with `AI_PROVIDER=vertex`.

    Locally the chunks live in `LocalObjectStore` on this machine, where batch recognition
    (which only reads Cloud Storage) cannot reach them. So each chunk is decoded here and
    recognised inline, in pieces under the synchronous limit, when its words are asked for.
    """

    SAMPLE_RATE = 16_000

    async def start(self, chunks: list[AudioChunk], output_prefix: str, language: str) -> list[str]:
        return ["inline"]

    async def results(self, operations: list[str]) -> dict[str, str] | None:
        return {}

    async def words(self, chunks: list[AudioChunk], result_names: dict[str, str]) -> list[Word]:
        from app.platform.media.ffmpeg import decode_to_pcm16

        store = processing()
        out: list[Word] = []
        for chunk in chunks:
            pcm = await decode_to_pcm16(await store.read(chunk.name), self.SAMPLE_RATE)
            for word in await transcribe_short(pcm, sample_rate=self.SAMPLE_RATE):
                shift = {"start_ms": chunk.offset_ms + word.start_ms, "end_ms": chunk.offset_ms + word.end_ms}
                out.append(word.model_copy(update=shift))
        return out


def speech_to_text(candidate_turns: list[CandidateTurn]) -> SpeechToText:
    settings = get_settings()
    if settings.ai_provider is AiProvider.FAKE:
        return FakeSpeechToText(candidate_turns)
    if settings.app_env is Env.LOCAL:
        return InlineChirpSpeechToText()
    return ChirpSpeechToText()


#: Synchronous recognition accepts up to a minute of audio per request.
INLINE_CHUNK_SECONDS = 55


async def transcribe_short(pcm16: bytes, *, sample_rate: int = 16_000, fake_text: str = "") -> list[Word]:
    """Words for a short clip (a Practice Center round), recognised inline, on the clip's clock.

    The audio is sent in the request and never written to storage. Longer clips are split into
    pieces under the synchronous limit and recognised in parallel.
    """
    if get_settings().ai_provider is AiProvider.FAKE:
        duration_ms = len(pcm16) // 2 * 1000 // sample_rate
        text = fake_text or "Um I think the answer is simple. First we plan, then we deliver, and we learn."
        return await FakeSpeechToText([CandidateTurn(text, 600, max(1200, duration_ms - 400))]).words([], {})

    settings = get_settings()
    location = settings.speech_location
    client = SpeechAsyncClient(client_options=ClientOptions(api_endpoint=f"{location}-speech.googleapis.com"))
    config = cs.RecognitionConfig(
        explicit_decoding_config=cs.ExplicitDecodingConfig(
            encoding=cs.ExplicitDecodingConfig.AudioEncoding.LINEAR16,
            sample_rate_hertz=sample_rate,
            audio_channel_count=1,
        ),
        model="chirp_3",
        language_codes=["en-US"],
        features=cs.RecognitionFeatures(enable_word_time_offsets=True, enable_automatic_punctuation=True),
    )
    recognizer = f"projects/{settings.ai_project}/locations/{location}/recognizers/_"
    step = INLINE_CHUNK_SECONDS * sample_rate * 2

    async def piece(offset: int) -> list[Word]:
        response = await client.recognize(
            request=cs.RecognizeRequest(recognizer=recognizer, config=config, content=pcm16[offset : offset + step]),
            timeout=60,
        )
        offset_ms = offset // 2 * 1000 // sample_rate
        words: list[Word] = []
        for result in response.results:
            if not result.alternatives:
                continue
            for info in result.alternatives[0].words:
                start = offset_ms + int(info.start_offset.total_seconds() * 1000)
                end = offset_ms + int(info.end_offset.total_seconds() * 1000)
                words.append(Word(text=info.word, start_ms=start, end_ms=max(start, end)))
        return words

    try:
        pieces = await asyncio.gather(*(piece(offset) for offset in range(0, len(pcm16), step)))
    except Exception as exc:  # any recognition failure is reported the same way to the caller
        raise SttFailed(str(exc)[:300], retryable=True) from exc
    return [word for words in pieces for word in words]
