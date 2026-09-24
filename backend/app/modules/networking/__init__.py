"""Networking practice module.

The user walks around a reception and joins a guest's conversation; the guest is
played live, face to face, and the platform's pipeline turns the recording into
feedback on how they networked.
"""

from __future__ import annotations

from app.modules.registry import ModuleDescriptor

MODULE_ID = "networking"


def descriptor() -> ModuleDescriptor:
    from app.modules.networking.agents.evaluator import NetworkingEvaluator
    from app.modules.networking.agents.guest import NetworkingLiveAgentFactory
    from app.modules.networking.api import router
    from app.modules.networking.retry import build_retry_plan, competency_name

    return ModuleDescriptor(
        id=MODULE_ID,
        api_routers=(router,),
        services={
            "live_agent_factory": NetworkingLiveAgentFactory(),
            "evaluator": NetworkingEvaluator(),
            "retry_planner": build_retry_plan,
            "competency_name": competency_name,
        },
    )
