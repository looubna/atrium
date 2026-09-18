"""Oral exam preparation module.

The student says what they are preparing for and hands over whatever material they
have; an analyst works out what the exam covers and how it is run, a live examiner
questions them on it, and the platform's pipeline turns the recording into feedback.
"""

from __future__ import annotations

from app.modules.registry import ModuleDescriptor

MODULE_ID = "exam"


def descriptor() -> ModuleDescriptor:
    from app.modules.exam.agents.evaluator import ExamEvaluator
    from app.modules.exam.agents.examiner import ExamLiveAgentFactory
    from app.modules.exam.api import router
    from app.modules.exam.courses_api import router as courses_router
    from app.modules.exam.retry import build_retry_plan, competency_name
    from app.modules.exam.tasks import TASKS

    return ModuleDescriptor(
        id=MODULE_ID,
        api_routers=(router, courses_router),
        services={
            "live_agent_factory": ExamLiveAgentFactory(),
            "evaluator": ExamEvaluator(),
            "retry_planner": build_retry_plan,
            "competency_name": competency_name,
            "tasks": TASKS,
        },
    )
