"""Negotiation practice module.

The user negotiates — a salary, a price, a contract, a deadline, scope, a partnership or their own
situation — with one person or a group, online or in person. The other side is played live, with a
private target and limit, and the platform's pipeline turns the recording into feedback on how they
negotiated.
"""

from __future__ import annotations

from app.modules.registry import ModuleDescriptor

MODULE_ID = "negotiation"


def descriptor() -> ModuleDescriptor:
    from app.modules.negotiation.agents.counterpart import NegotiationLiveAgentFactory
    from app.modules.negotiation.agents.evaluator import NegotiationEvaluator
    from app.modules.negotiation.api import router
    from app.modules.negotiation.retry import build_retry_plan, competency_name

    return ModuleDescriptor(
        id=MODULE_ID,
        api_routers=(router,),
        services={
            "live_agent_factory": NegotiationLiveAgentFactory(),
            "evaluator": NegotiationEvaluator(),
            "retry_planner": build_retry_plan,
            "competency_name": competency_name,
        },
    )
