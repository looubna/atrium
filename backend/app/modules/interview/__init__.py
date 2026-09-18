"""Interview preparation module."""

from __future__ import annotations

from app.modules.registry import ModuleDescriptor

MODULE_ID = "interview"


def descriptor() -> ModuleDescriptor:
    from app.modules.interview.agents.evaluator import InterviewEvaluator
    from app.modules.interview.agents.live_interviewer import InterviewLiveAgentFactory
    from app.modules.interview.api import router
    from app.modules.interview.applications_api import router as applications_router
    from app.modules.interview.resumes_api import router as resumes_router
    from app.modules.interview.retry import build_retry_plan, competency_name
    from app.modules.interview.tasks import TASKS

    return ModuleDescriptor(
        id=MODULE_ID,
        api_routers=(router, resumes_router, applications_router),
        services={
            "live_agent_factory": InterviewLiveAgentFactory(),
            "evaluator": InterviewEvaluator(),
            "retry_planner": build_retry_plan,
            "competency_name": competency_name,
            "tasks": TASKS,
        },
    )
