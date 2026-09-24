"""Language Center module.

A learner practises a language by speaking: role-plays of real situations (their plan's objectives,
or ready-made scenes) with a live tutor at their level, tips on what they say, a vocab coach that
brings back the words they met, and progress (level, streak, history). The report after each
conversation comes through the platform's feedback pipeline.
"""

from __future__ import annotations

from app.modules.registry import ModuleDescriptor

MODULE_ID = "language"


def descriptor() -> ModuleDescriptor:
    from app.modules.language.agents.evaluator import LanguageEvaluator
    from app.modules.language.agents.tutor import LanguageLiveAgentFactory
    from app.modules.language.api import router
    from app.modules.language.retry import build_retry_plan, competency_name
    from app.modules.language.wrapup import post_evaluation_steps

    return ModuleDescriptor(
        id=MODULE_ID,
        api_routers=(router,),
        services={
            "live_agent_factory": LanguageLiveAgentFactory(),
            "evaluator": LanguageEvaluator(),
            "retry_planner": build_retry_plan,
            "competency_name": competency_name,
            "post_evaluation_steps": post_evaluation_steps,
        },
    )
