"""Meeting practice module.

The user runs a meeting, takes part in one, or is the client a team reports to — one-to-one or with
a group, online or in person — on their own topic and material. The others are played live, and
the platform's pipeline turns the recording into feedback on how they did in the meeting.
"""

from __future__ import annotations

from app.modules.registry import ModuleDescriptor

MODULE_ID = "meeting"


def descriptor() -> ModuleDescriptor:
    from app.modules.meeting.agents.attendees import MeetingLiveAgentFactory
    from app.modules.meeting.agents.evaluator import MeetingEvaluator
    from app.modules.meeting.api import router
    from app.modules.meeting.retry import build_retry_plan, competency_name

    return ModuleDescriptor(
        id=MODULE_ID,
        api_routers=(router,),
        services={
            "live_agent_factory": MeetingLiveAgentFactory(),
            "evaluator": MeetingEvaluator(),
            "retry_planner": build_retry_plan,
            "competency_name": competency_name,
        },
    )
