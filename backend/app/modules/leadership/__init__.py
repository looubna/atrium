"""Leadership practice module.

The user leads a video call with their team — the full simulation, or one specific
scenario — played live, and the platform's pipeline turns the recording into feedback
on how they led.
"""

from __future__ import annotations

from app.modules.registry import ModuleDescriptor

MODULE_ID = "leadership"


def descriptor() -> ModuleDescriptor:
    from app.modules.leadership.agents.evaluator import LeadershipEvaluator
    from app.modules.leadership.agents.team import LeadershipLiveAgentFactory
    from app.modules.leadership.api import router
    from app.modules.leadership.retry import build_retry_plan, competency_name

    return ModuleDescriptor(
        id=MODULE_ID,
        api_routers=(router,),
        services={
            "live_agent_factory": LeadershipLiveAgentFactory(),
            "evaluator": LeadershipEvaluator(),
            "retry_planner": build_retry_plan,
            "competency_name": competency_name,
        },
    )
