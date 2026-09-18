"""Task queue: Cloud Tasks to the private worker, authenticated with OIDC.

Task names make enqueueing idempotent (a duplicate name is rejected by Cloud
Tasks for days), so callers derive names from job, run, step and attempt.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import re
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any, Protocol

from google.api_core.exceptions import AlreadyExists
from google.cloud import tasks_v2
from google.protobuf import duration_pb2, timestamp_pb2

from app.core.settings import Env, get_settings
from app.platform.clients import clients

_NAME_SAFE = re.compile(r"[^A-Za-z0-9_-]")


@dataclass(frozen=True, slots=True)
class TaskRequest:
    queue: str
    path: str
    payload: dict[str, Any]
    name: str | None = None
    delay_seconds: int = 0


def task_name(*parts: str) -> str:
    """Hash-prefixed names spread load across Cloud Tasks' index; unsafe characters removed."""
    raw = "-".join(parts)
    safe = _NAME_SAFE.sub("_", raw)[:400]
    return f"{hashlib.sha256(raw.encode()).hexdigest()[:4]}-{safe}"


class TaskQueue(Protocol):
    async def enqueue(self, request: TaskRequest) -> bool:
        """Returns False when a task with the same name already exists."""
        ...


class CloudTasksQueue:
    async def enqueue(self, request: TaskRequest) -> bool:
        settings = get_settings()
        client = clients.tasks()
        parent = client.queue_path(settings.google_cloud_project, settings.tasks_location, request.queue)
        task = tasks_v2.Task(
            http_request=tasks_v2.HttpRequest(
                http_method=tasks_v2.HttpMethod.POST,
                url=f"{settings.worker_url}{request.path}",
                headers={"Content-Type": "application/json"},
                body=json.dumps(request.payload).encode(),
                oidc_token=tasks_v2.OidcToken(
                    service_account_email=settings.tasks_invoker_sa,
                    audience=settings.worker_url,
                ),
            ),
            dispatch_deadline=duration_pb2.Duration(seconds=1800),
        )
        if request.name:
            task.name = client.task_path(
                settings.google_cloud_project, settings.tasks_location, request.queue, request.name
            )
        if request.delay_seconds:
            ts = timestamp_pb2.Timestamp()
            ts.FromDatetime(datetime.now(UTC) + timedelta(seconds=request.delay_seconds))
            task.schedule_time = ts
        try:
            await client.create_task(parent=parent, task=task)
        except AlreadyExists:
            return False
        return True


@dataclass
class RecordingQueue:
    """Local development and tests: records tasks; the worker can be driven directly."""

    requests: list[TaskRequest] = field(default_factory=list)

    async def enqueue(self, request: TaskRequest) -> bool:
        if request.name and any(r.name == request.name and r.queue == request.queue for r in self.requests):
            return False
        self.requests.append(request)
        return True


LocalDispatcher = Callable[[TaskRequest], Awaitable[None]]
_local_dispatcher: LocalDispatcher | None = None
_background: set[asyncio.Task[None]] = set()


def set_local_dispatcher(dispatcher: LocalDispatcher) -> None:
    global _local_dispatcher
    _local_dispatcher = dispatcher


@dataclass
class LocalInlineQueue:
    """Local development: runs tasks in this process shortly after they are enqueued."""

    names: set[str] = field(default_factory=set)

    async def enqueue(self, request: TaskRequest) -> bool:
        if request.name:
            if request.name in self.names:
                return False
            self.names.add(request.name)

        async def run() -> None:
            await asyncio.sleep(min(request.delay_seconds, 2))
            if _local_dispatcher is not None:
                await _local_dispatcher(request)

        task = asyncio.create_task(run())
        _background.add(task)
        task.add_done_callback(_background.discard)
        return True


_recording = RecordingQueue()
_local_inline = LocalInlineQueue()


def task_queue() -> TaskQueue:
    override = clients.overrides.get("task_queue")
    if override is not None:
        return override  # type: ignore[no-any-return]
    env = get_settings().app_env
    if env is Env.TEST:
        return _recording
    if env is Env.LOCAL:
        return _local_inline
    return CloudTasksQueue()
