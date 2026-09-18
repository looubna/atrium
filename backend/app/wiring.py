"""Registers platform routers and installed modules with the registry.

This is the only place that knows which modules are installed.
"""

from __future__ import annotations

from app.core.settings import Env, get_settings
from app.modules import debate, exam, interview
from app.modules.practice.api import router as practice_router
from app.modules.registry import registry
from app.platform.agents.live_gateway import router as live_router
from app.platform.competencies.api import router as competencies_router
from app.platform.deletion import router as deletion_router
from app.platform.feedback.examples_api import router as examples_router
from app.platform.jobs.module_tasks import dispatch_local
from app.platform.jobs.queue import set_local_dispatcher
from app.platform.jobs.worker_api import router as worker_router
from app.platform.media.face_metrics import router as face_metrics_router
from app.platform.media.video import local_upload_router
from app.platform.media.video import router as video_router
from app.platform.sessions_api import local_router
from app.platform.sessions_api import router as sessions_router
from app.platform.users import router as users_router

api_routers = [
    users_router, deletion_router, sessions_router, video_router, face_metrics_router, examples_router,
    competencies_router, live_router, practice_router,
]
if get_settings().app_env in (Env.LOCAL, Env.TEST):
    api_routers += [local_router, local_upload_router]
    # Local development runs pipeline steps in-process instead of through Cloud Tasks.
    set_local_dispatcher(dispatch_local)

registry.register_platform_routers(api=api_routers, worker=[worker_router])
registry.register(interview.descriptor())
registry.register(exam.descriptor())
registry.register(debate.descriptor())
