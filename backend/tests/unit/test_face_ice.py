from __future__ import annotations

from typing import Any

import pytest

from app.core.settings import get_settings
from app.platform.faces import ice

RELAY = [
    {"urls": ["stun:stun.cloudflare.com:3478", "stun:stun.cloudflare.com:53"]},
    {"urls": ["turn:turn.cloudflare.com:3478?transport=udp", "turn:turn.cloudflare.com:53?transport=udp",
              "turns:turn.cloudflare.com:443?transport=tcp"], "username": "u", "credential": "c"},
]


@pytest.fixture(autouse=True)
def _fresh_cache() -> None:
    ice._cache = None


async def test_without_turn_settings_only_the_direct_route() -> None:
    assert await ice.ice_servers() == [ice.STUN]


async def test_the_relay_is_added_cached_and_port_53_dropped(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CLOUDFLARE_TURN_KEY_ID", "key")
    monkeypatch.setenv("CLOUDFLARE_TURN_API_TOKEN", "token")
    get_settings.cache_clear()
    calls: list[str] = []

    async def mint(key_id: str, token: str) -> list[dict[str, Any]]:
        calls.append(key_id)
        return ice._usable(RELAY)

    monkeypatch.setattr(ice, "_mint", mint)
    first = await ice.ice_servers(now=1000.0)
    assert first[0] == ice.STUN and len(first) == 3
    assert all(":53" not in url for server in first for url in server["urls"])
    assert "turns:turn.cloudflare.com:443?transport=tcp" in first[2]["urls"]  # TLS on 443 gets through
    await ice.ice_servers(now=5000.0)
    assert calls == ["key"]  # served from the cache


async def test_a_cloudflare_outage_never_breaks_the_direct_route(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CLOUDFLARE_TURN_KEY_ID", "key")
    monkeypatch.setenv("CLOUDFLARE_TURN_API_TOKEN", "token")
    get_settings.cache_clear()

    async def down(key_id: str, token: str) -> list[dict[str, Any]]:
        raise RuntimeError("unreachable")

    monkeypatch.setattr(ice, "_mint", down)
    assert await ice.ice_servers() == [ice.STUN]
