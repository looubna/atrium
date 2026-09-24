"""Wire protocol between the app and the live gateway.

Binary client frames: seq u32 | capture_ms u32 | PCM16 mono 16 kHz (50-250 ms).
Binary server frames: turn_seq u32 | chunk u32 | PCM16 mono 24 kHz.
JSON text messages carry control data in both directions.
"""

from __future__ import annotations

import struct
from dataclasses import dataclass
from enum import IntEnum, StrEnum
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter

CLIENT_FRAME = struct.Struct("<II")
SERVER_FRAME = struct.Struct("<II")
MAX_CLIENT_PCM_BYTES = 16_000 * 2 // 4  # 250 ms
#: Control messages are small; a board image is the one exception, and every other field
#: on every message is length-capped by its own schema, so the envelope can be generous.
MAX_TEXT_MESSAGE_BYTES = 200_000
#: About 120 KB of JPEG once decoded: a readable board, not a photograph.
MAX_BOARD_IMAGE_B64 = 160_000


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


class ForbiddenReason(StrEnum):
    """Why a 4403 closed the socket, sent as the close reason.

    The client shows a different message for each, so these strings are wire format: the web app
    matches them in `src/platform/live/protocol.ts`. Changing one changes what the candidate reads.
    """

    EMAIL_UNVERIFIED = "email not verified"
    CONSENT_REQUIRED = "consent_required"
    ACCOUNT_DELETING = "account_deleting"
    ORIGIN = "origin not allowed"


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
    #: Connect now, but the interviewer only opens once `begin` arrives (the candidate has sat
    #: down). Connecting during the walk to the room takes the connection off the wait.
    holdOpening: bool = False


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


class BoardImage(_Msg):
    """The board as the student has written it by hand, so the examiner can read the work."""

    type: Literal["board_image"]
    mediaMs: Annotated[int, Field(ge=0)]
    jpegBase64: Annotated[str, Field(min_length=64, max_length=MAX_BOARD_IMAGE_B64)]


class ClientEnd(_Msg):
    type: Literal["end"]


class Begin(_Msg):
    """The candidate is in place: the interviewer may open (after `holdOpening`)."""

    type: Literal["begin"]


class Release(_Msg):
    """The user hands the floor over (takes questions): only for a session that holds it."""

    type: Literal["release"]


class Ping(_Msg):
    type: Literal["ping"]
    mediaMs: Annotated[int, Field(ge=0)]


Control = PlaybackStarted | PlaybackStopped | CodeSnapshot | BoardImage | Begin | ClientEnd | Release | Ping
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
