"""Brain Lab module: a live consultation with a neuroscientist coach.

The user tells her what they want to change (speaking confidence, motivation and habits, or their
own); she explains what happens in their brain and teaches evidence-based techniques live; the
platform scores the session, and a post-evaluation step writes their Brain Plan (plan.py).
"""

from __future__ import annotations

from app.modules.registry import ModuleDescriptor

MODULE_ID = "brainlab"


def descriptor() -> ModuleDescriptor:
    from app.modules.brainlab.agents.evaluator import BrainLabEvaluator
    from app.modules.brainlab.agents.neuroscientist import BrainLabLiveAgentFactory
    from app.modules.brainlab.api import router
    from app.modules.brainlab.plan import post_evaluation_steps
    from app.modules.brainlab.retry import build_retry_plan, competency_name

    return ModuleDescriptor(
        id=MODULE_ID,
        api_routers=(router,),
        services={
            "live_agent_factory": BrainLabLiveAgentFactory(),
            "evaluator": BrainLabEvaluator(),
            "retry_planner": build_retry_plan,
            "competency_name": competency_name,
            "post_evaluation_steps": post_evaluation_steps,
        },
    )
