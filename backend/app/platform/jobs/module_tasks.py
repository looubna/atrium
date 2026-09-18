"""Background tasks owned by modules (resume extraction, blueprint generation, ...).

A module exposes handlers through its descriptor's `tasks` service. The platform
enqueues them on Cloud Tasks and runs them on the worker at
`/internal/modules/{module}/tasks/{task}`, so modules never need their own
queue plumbing. Handlers keep their own state and raise `RetryableTaskError`
when Cloud Tasks should try again.
"""

from __future__ import annotations

import logging
import re
from collections.abc import Awaitable, Callable
from typing import Any

from app.core.errors import NotFound, ServiceUnavailable
from app.modules.registry import registry
from app.platform.jobs.pipeline import dispatch_local as dispatch_pipeline
from app.platform.jobs.queue import TaskRequest, task_name, task_queue

log = logging.getLogger(__name__)

ModuleTaskHandler = Callable[[dict[str, Any]], Awaitable[None]]
_NAME = re.compile(r"[a-z][a-z0-9_]{1,40}")
QUEUE = "processing"


class RetryableTaskError(RuntimeError):
    """Transient failure; the task should be delivered again."""


def module_task_path(module: str, task: str) -> str:
    return f"/internal/modules/{module}/tasks/{task}"


async def enqueue_module_task(
    module: str, task: str, payload: dict[str, Any], *, name_parts: tuple[str, ...], delay_s: int = 0
) -> bool:
    return await task_queue().enqueue(
        TaskRequest(
            queue=QUEUE,
            path=module_task_path(module, task),
            payload=payload,
            name=task_name(module, task, *name_parts),
            delay_seconds=delay_s,
        )
    )


async def run_module_task(module: str, task: str, payload: dict[str, Any]) -> None:
    if not _NAME.fullmatch(module) or not _NAME.fullmatch(task):
        raise NotFound()
    try:
        handlers: dict[str, ModuleTaskHandler] = registry.service(module, "tasks")
    except LookupError:
        raise NotFound() from None
    handler = handlers.get(task)
    if handler is None:
        raise NotFound()
    try:
        await handler(payload)
    except RetryableTaskError as exc:
        # Not "module": LogRecord reserves that attribute and logging would raise instead of logging.
        log.warning("module task will be retried", extra={"taskModule": module, "task": task})
        raise ServiceUnavailable("retrying") from exc


async def dispatch_local(request: TaskRequest) -> None:
    """Local development: run pipeline steps and module tasks in-process."""
    parts = request.path.strip("/").split("/")
    if len(parts) == 5 and parts[:2] == ["internal", "modules"] and parts[3] == "tasks":
        try:
            await run_module_task(parts[2], parts[4], request.payload)
        except ServiceUnavailable:
            log.info("local module task retry scheduled")
            await task_queue().enqueue(
                TaskRequest(queue=request.queue, path=request.path, payload=request.payload, delay_seconds=2)
            )
        return
    if request.path == "/internal/media/remux":
        from app.platform.media.video import remux_video

        payload = request.payload
        await remux_video(str(payload["uid"]), str(payload["sessionId"]), str(payload["uploadId"]))
        return
    await dispatch_pipeline(request)
