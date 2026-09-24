"""Scholarship and university admission interview preparation.

The candidate names the opportunity and hands over whatever application materials they
already have. A researcher reads what is publicly known about that scholarship or programme
— the funder's own guidelines first, then what past applicants have written about sitting
the interview — an analyzer turns their documents into a profile held together by evidence,
and a preparation engine works out what *this* candidate should be ready to explain. Only
then does a panel interview them, on a compact context rather than on the research itself.

The module is deliberately split that way (§1 of the brief): research may be slow, may fail
and may be reused between candidates, while the interview must be fast, stateful and cheap.
Nothing in `agents/live_*` is allowed to browse or to read a PDF.

Registered with its routers, its jobs, and the interview itself: a professor from the selection
committee on a video call (`agents/interviewer.py`), questioning the candidate from the prepared
brief, and the committee's report afterwards (`agents/evaluator.py`).
"""

from __future__ import annotations

from app.modules.registry import ModuleDescriptor

MODULE_ID = "admission"


def descriptor() -> ModuleDescriptor:
    from app.modules.admission.agents.evaluator import AdmissionEvaluator, build_retry_plan, competency_name
    from app.modules.admission.agents.interviewer import AdmissionLiveAgentFactory
    from app.modules.admission.api import router
    from app.modules.admission.sessions_api import router as sessions_router
    from app.modules.admission.tasks import TASKS

    return ModuleDescriptor(
        id=MODULE_ID,
        api_routers=(router, sessions_router),
        services={
            "live_agent_factory": AdmissionLiveAgentFactory(),
            "evaluator": AdmissionEvaluator(),
            "retry_planner": build_retry_plan,
            "competency_name": competency_name,
            "tasks": TASKS,
        },
    )
