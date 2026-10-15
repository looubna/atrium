"""Café & Restaurant module: live everyday conversations at a café table.

Two areas: Starting Conversations (a stranger, a new colleague, someone you met once) and Everyday
Communication (ordering, a wrong order, a favour, a lost booking). The user talks live with the other
person, who reacts like a real one; the platform then scores the conversation with a coach's feedback.
"""

from __future__ import annotations

from app.modules.registry import ModuleDescriptor

MODULE_ID = "cafe"


def descriptor() -> ModuleDescriptor:
    from app.modules.cafe.agents.evaluator import CafeEvaluator
    from app.modules.cafe.agents.person import CafeLiveAgentFactory
    from app.modules.cafe.api import router
    from app.modules.cafe.retry import build_retry_plan, competency_name

    return ModuleDescriptor(
        id=MODULE_ID,
        api_routers=(router,),
        services={
            "live_agent_factory": CafeLiveAgentFactory(),
            "evaluator": CafeEvaluator(),
            "retry_planner": build_retry_plan,
            "competency_name": competency_name,
        },
    )
