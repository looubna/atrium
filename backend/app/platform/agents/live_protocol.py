"""Wire protocol between the app and the live gateway.

Binary client frames: seq u32 | capture_ms u32 | PCM16 mono 16 kHz (50-250 ms).
Binary server frames: turn_seq u32 | chunk u32 | PCM16 mono 24 kHz.
JSON text messages carry control data in both directions.
"""

from __future__ import annotations

import struct
from dataclasses import dataclass
from enum import IntEnum
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter

CLIENT_FRAME = struct.Struct("<II")
SERVER_FRAME = struct.Struct("<II")
MAX_CLIENT_PCM_BYTES = 16_000 * 2 // 4  # 250 ms
MAX_TEXT_MESSAGE_BYTES = 64_000


class CloseCode(IntEnum):
    NORMAL = 1000
    PROTOCOL_ERROR = 4400
    UNAUTHENTICATED = 4401
    FORBIDDEN = 4403
    NOT_FOUND = 4404
    AUTH_TIMEOUT = 4408
    CONFLICT = 4409
    QUOTA = 4429
    UNAVAILABLE = 4503


class ProtocolError(ValueError):
    pass


@dataclass(frozen=True, slots=True)
class AudioFrame:
    seq: int
    capture_ms: int
    pcm: bytes


def parse_audio_frame(data: bytes) -> AudioFrame:
    if len(data) <= CLIENT_FRAME.size:
        raise ProtocolError("audio frame too short")
    pcm = data[CLIENT_FRAME.size :]
    if len(pcm) > MAX_CLIENT_PCM_BYTES or len(pcm) % 2:
        raise ProtocolError("invalid audio frame length")
    seq, capture_ms = CLIENT_FRAME.unpack_from(data, 0)
    return AudioFrame(seq=seq, capture_ms=capture_ms, pcm=pcm)


def encode_server_audio(turn_seq: int, chunk: int, pcm: bytes) -> bytes:
    return SERVER_FRAME.pack(turn_seq, chunk) + pcm


class _Msg(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class AuthMessage(_Msg):
    type: Literal["auth"]
    idToken: Annotated[str, Field(min_length=1, max_length=4096)]
    appCheckToken: Annotated[str | None, Field(max_length=4096)] = None
    lastAckSeq: Annotated[int | None, Field(ge=0)] = None


class PlaybackStarted(_Msg):
    type: Literal["playback_started"]
    turnSeq: Annotated[int, Field(ge=0)]
    mediaMs: Annotated[int, Field(ge=0)]


class PlaybackStopped(_Msg):
    type: Literal["playback_stopped"]
    turnSeq: Annotated[int, Field(ge=0)]
    mediaMs: Annotated[int, Field(ge=0)]


class CodeSnapshot(_Msg):
    type: Literal["code_snapshot"]
    mediaMs: Annotated[int, Field(ge=0)]
    language: Annotated[str, Field(pattern=r"^[a-z0-9+#-]{1,24}$")]
    text: Annotated[str, Field(max_length=20_000)]


class ClientEnd(_Msg):
    type: Literal["end"]


class Ping(_Msg):
    type: Literal["ping"]
    mediaMs: Annotated[int, Field(ge=0)]


Control = PlaybackStarted | PlaybackStopped | CodeSnapshot | ClientEnd | Ping
_control: TypeAdapter[Control] = TypeAdapter(Annotated[Control, Field(discriminator="type")])
_auth: TypeAdapter[AuthMessage] = TypeAdapter(AuthMessage)


def parse_auth(text: str) -> AuthMessage:
    if len(text) > MAX_TEXT_MESSAGE_BYTES:
        raise ProtocolError("message too large")
    try:
        return _auth.validate_json(text)
    except ValueError as exc:
        raise ProtocolError("invalid auth message") from exc


def parse_control(text: str) -> Control:
    if len(text) > MAX_TEXT_MESSAGE_BYTES:
        raise ProtocolError("message too large")
    try:
        return _control.validate_json(text)
    except ValueError as exc:
        raise ProtocolError("invalid control message") from exc
