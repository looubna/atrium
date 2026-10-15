"""How the browser reaches the face server's video: ICE servers for `RTCPeerConnection`.

Direct first (Google's STUN tells the browser its public address), and, when Cloudflare TURN is
configured, a relay as the fallback: networks that drop WebRTC's own traffic (office, school, hotel and
café Wi-Fi) still let TLS on port 443 through, so the video goes through Cloudflare there. The browser
picks the route that works on its own; most conversations never use the relay.

Relay credentials are short-lived (minted with the TURN key's API token, never shipped in the app) and
cached here, so a busy hour costs one Cloudflare call. Without TURN settings, or if Cloudflare is
unreachable, this returns only the STUN server: exactly the behaviour before the relay existed.
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

import httpx

from app.core.settings import get_settings

log = logging.getLogger(__name__)

STUN: dict[str, Any] = {"urls": ["stun:stun.l.google.com:19302"]}
#: How long minted relay credentials are valid, and how long before expiry they are replaced.
TTL_S = 24 * 3600
REFRESH_BEFORE_S = 3600

_cache: tuple[float, list[dict[str, Any]]] | None = None
_lock = asyncio.Lock()


def _usable(servers: Any) -> list[dict[str, Any]]:
    """Cloudflare's answer, minus port-53 URLs (browsers refuse them and stall trying)."""
    out = []
    for server in servers if isinstance(servers, list) else [servers]:
        if not isinstance(server, dict):
            continue
        urls = server.get("urls")
        urls = [urls] if isinstance(urls, str) else list(urls or [])
        urls = [u for u in urls if isinstance(u, str) and ":53?" not in u and not u.endswith(":53")]
        if urls:
            out.append({**server, "urls": urls})
    return out


async def _mint(key_id: str, token: str) -> list[dict[str, Any]]:
    url = f"https://rtc.live.cloudflare.com/v1/turn/keys/{key_id}/credentials/generate-ice-servers"
    async with httpx.AsyncClient(timeout=5) as http:
        response = await http.post(url, headers={"Authorization": f"Bearer {token}"}, json={"ttl": TTL_S})
    response.raise_for_status()
    return _usable(response.json().get("iceServers"))


async def ice_servers(now: float | None = None) -> list[dict[str, Any]]:
    """STUN, plus the Cloudflare relay when configured and reachable."""
    global _cache
    settings = get_settings()
    key_id, token = settings.cloudflare_turn_key_id, settings.cloudflare_turn_api_token.get_secret_value()
    if not key_id or not token:
        return [STUN]
    now = now if now is not None else time.time()
    async with _lock:
        if _cache and now < _cache[0] - REFRESH_BEFORE_S:
            return [STUN, *_cache[1]]
        try:
            relay = await _mint(key_id, token)
            _cache = (now + TTL_S, relay)
        except Exception as exc:  # the relay is a fallback: never let it break the direct route
            log.warning("TURN credentials unavailable", extra={"data": {"error": type(exc).__name__}})
            return [STUN, *(_cache[1] if _cache and now < _cache[0] else [])]
    return [STUN, *relay]
