"""Debate practice module.

The user picks something to argue about, takes a side, and debates an opponent that
listens: it understands their arguments as structure, remembers them, challenges the
weakest part rather than every part, defends its own position, concedes a fair point
without abandoning its side, and comes back to what they never answered.

The intelligence is split so that no single model is asked to do a job it is bad at:

    catalogs.py       formats, difficulties, positions, competencies — configuration
    argument.py       the argument model (claim / reason / evidence / assumption)
    state.py          the explicit debate state, kept by application code
    orchestrator.py   what the opponent does next, decided deterministically
    sources.py        retrieval over the user's own material, a few records per turn
    brief.py          the prepared debate context, and the rules its draft must pass
    topics.py         where a motion comes from, and whether it needs research
    plans.py          session -> the plan the opponent argues from
    observer.py       the live loop: analyse, update state, decide, steer
    argument_map.py   the map and the patterns, derived from what was tracked
    agents/analyzer.py    one user turn -> structure                (fast, live)
    agents/debater.py     the opponent's instruction and its per-turn note
    agents/live_debater.py the live_agent_factory
    agents/preparer.py    research, reading material, writing the brief  (worker)
    agents/evaluator.py   the feedback engine                            (worker)

Everything else — identity, consent, quotas, recording, transcripts, the live gateway,
the processing pipeline, competencies, deletion — is the platform's, unchanged.
"""

from __future__ import annotations

from app.modules.registry import ModuleDescriptor

MODULE_ID = "debate"


def descriptor() -> ModuleDescriptor:
    from app.modules.debate.agents.evaluator import DebateEvaluator
    from app.modules.debate.agents.live_debater import DebateLiveAgentFactory
    from app.modules.debate.api import router
    from app.modules.debate.debates_api import router as debates_router
    from app.modules.debate.observer import DebateTurnObserver
    from app.modules.debate.retry import build_retry_plan, competency_name, post_evaluation_steps
    from app.modules.debate.tasks import TASKS

    return ModuleDescriptor(
        id=MODULE_ID,
        api_routers=(router, debates_router),
        services={
            "live_agent_factory": DebateLiveAgentFactory(),
            # The debate's own state tracker: sees every turn, steers the next one.
            "turn_observer": DebateTurnObserver(),
            "evaluator": DebateEvaluator(),
            "retry_planner": build_retry_plan,
            "competency_name": competency_name,
            "post_evaluation_steps": post_evaluation_steps,
            "tasks": TASKS,
        },
    )
