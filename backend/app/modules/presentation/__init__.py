"""Presentation practice module.

The user gives a talk — in a small room, to a large audience or on a video call — with their own
slides, to an audience that listens without a word and then asks questions, one at a time, about
the talk and the slides. The platform's pipeline turns the recording into feedback on the talk and
the Q&A.
"""

from __future__ import annotations

from app.modules.registry import ModuleDescriptor

MODULE_ID = "presentation"


def descriptor() -> ModuleDescriptor:
    from app.modules.presentation.agents.evaluator import PresentationEvaluator
    from app.modules.presentation.agents.room import PresentationLiveAgentFactory
    from app.modules.presentation.api import router
    from app.modules.presentation.retry import build_retry_plan, competency_name

    return ModuleDescriptor(
        id=MODULE_ID,
        api_routers=(router,),
        services={
            "live_agent_factory": PresentationLiveAgentFactory(),
            "evaluator": PresentationEvaluator(),
            "retry_planner": build_retry_plan,
            "competency_name": competency_name,
        },
    )
