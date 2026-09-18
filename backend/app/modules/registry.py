"""The contract between the platform and coaching modules.

The platform never imports a module directly. A module describes itself with a
`ModuleDescriptor`; the platform asks the registry for routers, catalogs, live
agent factories, evaluators, and deletion hooks. Adding a module means adding a
descriptor, not editing platform code.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable, Iterable
from dataclasses import dataclass, field
from typing import Any

from fastapi import APIRouter

DeletionHook = Callable[[str], Awaitable[None]]


@dataclass(frozen=True)
class ModuleDescriptor:
    id: str
    api_routers: tuple[APIRouter, ...] = ()
    worker_routers: tuple[APIRouter, ...] = ()
    # Module services looked up by platform code by name, e.g. "live_agent_factory",
    # "evaluator", "post_evaluation_steps". Typed protocols live next to the platform
    # feature that consumes them.
    services: dict[str, Any] = field(default_factory=dict)
    deletion_hooks: tuple[DeletionHook, ...] = ()


class ModuleRegistry:
    def __init__(self) -> None:
        self._modules: dict[str, ModuleDescriptor] = {}
        self._platform_api: list[APIRouter] = []
        self._platform_worker: list[APIRouter] = []

    def register(self, module: ModuleDescriptor) -> None:
        if module.id in self._modules:
            raise ValueError(f"module {module.id!r} already registered")
        self._modules[module.id] = module

    def register_platform_routers(
        self, *, api: Iterable[APIRouter] = (), worker: Iterable[APIRouter] = ()
    ) -> None:
        self._platform_api.extend(api)
        self._platform_worker.extend(worker)

    def get(self, module_id: str) -> ModuleDescriptor:
        try:
            return self._modules[module_id]
        except KeyError:
            raise LookupError(f"unknown module {module_id!r}") from None

    def service(self, module_id: str, name: str) -> Any:
        services = self.get(module_id).services
        if name not in services:
            raise LookupError(f"module {module_id!r} has no service {name!r}")
        return services[name]

    def modules(self) -> list[ModuleDescriptor]:
        return list(self._modules.values())

    def api_routers(self) -> list[APIRouter]:
        _ensure_loaded()
        return [*self._platform_api, *(r for m in self._modules.values() for r in m.api_routers)]

    def worker_routers(self) -> list[APIRouter]:
        _ensure_loaded()
        return [*self._platform_worker, *(r for m in self._modules.values() for r in m.worker_routers)]

    def deletion_hooks(self) -> list[DeletionHook]:
        return [h for m in self._modules.values() for h in m.deletion_hooks]


registry = ModuleRegistry()

_loaded = False


def _ensure_loaded() -> None:
    """Import the wiring module once; it registers platform routers and modules."""
    global _loaded
    if _loaded:
        return
    _loaded = True
    from app import wiring  # noqa: F401
