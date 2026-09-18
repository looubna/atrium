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


def sign(secret: str, avatar: str, *, now: float | None = None) -> str:
    """`<avatar>.<expiry>.<hmac>`, checked by the server's `server/atrium.py`."""
    expiry = str(int(now if now is not None else time.time()) + TOKEN_TTL_S)
    mac = hmac.new(secret.encode(), f"{avatar}.{expiry}".encode(), hashlib.sha256).digest()
    return f"{avatar}.{expiry}.{base64.urlsafe_b64encode(mac).rstrip(b'=').decode()}"


def session(url: str, secret: str, avatar: str) -> dict[str, str]:
    """What the browser needs to open one face."""
    return {"url": url.rstrip("/"), "token": sign(secret, avatar)}
