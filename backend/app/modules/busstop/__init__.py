"""Bus Stop module: short live conversations with strangers while waiting for the bus.

Two areas: Small Talk (a stranger when the bus is late, someone whose name you forgot, wrapping up when
your bus arrives) and Help & Boundaries (asking a stranger for help, a pushy stranger, a queue jumper).
The user talks live with the other person, who reacts like a real one; the platform then scores the
conversation with a coach's feedback.
"""

from __future__ import annotations

from app.modules.registry import ModuleDescriptor

MODULE_ID = "busstop"


def descriptor() -> ModuleDescriptor:
    from app.modules.busstop.agents.evaluator import BusStopEvaluator
    from app.modules.busstop.agents.person import BusStopLiveAgentFactory
    from app.modules.busstop.api import router
    from app.modules.busstop.retry import build_retry_plan, competency_name

    return ModuleDescriptor(
        id=MODULE_ID,
        api_routers=(router,),
        services={
            "live_agent_factory": BusStopLiveAgentFactory(),
            "evaluator": BusStopEvaluator(),
            "retry_planner": build_retry_plan,
            "competency_name": competency_name,
        },
    )
