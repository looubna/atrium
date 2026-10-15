"""Emotional communication practice module (the park).

The user sits on a park bench with a close friend and has one hard or tender conversation:
sharing a feeling, comforting them, apologising, thanking them, setting a boundary, or raising a
disappointment. The friend is played live, face to face, with a lip-synced face made from the
park footage; the platform's pipeline turns the recording into feedback.
"""

from __future__ import annotations

from app.modules.registry import ModuleDescriptor

MODULE_ID = "emotional"


def descriptor() -> ModuleDescriptor:
    from app.modules.emotional.agents.evaluator import EmotionalEvaluator
    from app.modules.emotional.agents.partner import EmotionalLiveAgentFactory
    from app.modules.emotional.api import router
    from app.modules.emotional.retry import build_retry_plan, competency_name

    return ModuleDescriptor(
        id=MODULE_ID,
        api_routers=(router,),
        services={
            "live_agent_factory": EmotionalLiveAgentFactory(),
            "evaluator": EmotionalEvaluator(),
            "retry_planner": build_retry_plan,
            "competency_name": competency_name,
        },
    )
