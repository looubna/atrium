"""Sales practice module.

The user sells: a first call with a prospect, a pitch or demo, an account review with a client,
or a pitch to a panel of investors — online on a video call, or in person across a table. The
other side is played live, and the platform's pipeline turns the recording into feedback on how
they sold.
"""

from __future__ import annotations

from app.modules.registry import ModuleDescriptor

MODULE_ID = "sales"


def descriptor() -> ModuleDescriptor:
    from app.modules.sales.agents.buyer import SalesLiveAgentFactory
    from app.modules.sales.agents.evaluator import SalesEvaluator
    from app.modules.sales.api import router
    from app.modules.sales.retry import build_retry_plan, competency_name

    return ModuleDescriptor(
        id=MODULE_ID,
        api_routers=(router,),
        services={
            "live_agent_factory": SalesLiveAgentFactory(),
            "evaluator": SalesEvaluator(),
            "retry_planner": build_retry_plan,
            "competency_name": competency_name,
        },
    )
