"""LiveTalking faces for in-person interviews (our own lip-sync server, github.com/lipku/LiveTalking).

The browser sends the server the interviewer's own speech (24 kHz PCM16, the same audio the call
plays) and receives the person's video with that voice on it. Here we only sign a short-lived
token naming the recording a face may use; the server checks it with the same secret, so a page
can neither pick another recording nor open sessions on its own.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import time

TOKEN_TTL_S = 15 * 60
#: Signed in place of a face to keep an idle face server from stopping itself (not a recording).
HOLD = "_hold"


def sign(secret: str, avatar: str, *, now: float | None = None) -> str:
    """`<avatar>.<expiry>.<hmac>`, checked by the server's `server/atrium.py`."""
    expiry = str(int(now if now is not None else time.time()) + TOKEN_TTL_S)
    mac = hmac.new(secret.encode(), f"{avatar}.{expiry}".encode(), hashlib.sha256).digest()
    return f"{avatar}.{expiry}.{base64.urlsafe_b64encode(mac).rstrip(b'=').decode()}"


def face_for(avatar_id: str, faces: str, stand_in: str) -> str:
    """The recording that plays `avatar_id`: its own entry in `faces` ("person=recording, ..."),
    else the stand-in for everyone not yet recorded, else a recording of its own name."""
    table: dict[str, str] = {}
    for pair in faces.split(","):
        person, sep, recording = pair.partition("=")
        if sep and person.strip() and recording.strip():
            table[person.strip()] = recording.strip()
    return table.get(avatar_id) or stand_in.strip() or avatar_id


def mapped_face(avatar_id: str, faces: str) -> str:
    """The recording explicitly bound to `avatar_id` in `faces`, or "" when none is.

    `face_for` always yields something, falling back to the id itself, because the lead must
    have a face if any recording exists. A panel colleague must not: showing no face is a
    supported state, while a session opened for a recording the server does not have is
    refused at the token check and shows nothing anyway, after a wasted round trip.
    """
    for pair in faces.split(","):
        person, sep, recording = pair.partition("=")
        if sep and person.strip() == avatar_id.strip() and recording.strip():
            return recording.strip()
    return ""


def session(url: str, secret: str, avatar: str) -> dict[str, str]:
    """What the browser needs to open one face."""
    return {"url": url.rstrip("/"), "token": sign(secret, avatar)}
