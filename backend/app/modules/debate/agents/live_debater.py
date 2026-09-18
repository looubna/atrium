"""The debate module's `live_agent_factory`: the opponent, ready to argue.

Thin on purpose. The instruction is built in `debater.py`, the plan is read in
`plans.py`, and everything that happens after the first word is the turn observer's.
"""

from __future__ import annotations

from typing import Any

from app.modules.debate.agents.debater import (
    brief_line,
    build_instruction,
    opening_message,
    resume_message,
)
from app.modules.debate.catalogs import DebateFormat, parse_format
from app.modules.debate.debaters import debater_for
from app.modules.debate.plans import load_plan
from app.platform.agents.live import LiveAgentSpec

#: A debater pauses to think, and a debate where every hesitation is taken as "your turn"
#: is unusable. Longer than the interview's window, and longer again for formal turns.
SILENCE_MS = 1600
FORMAL_SILENCE_MS = 2200


class DebateLiveAgentFactory:
    def is_coding_session(self, session: dict[str, Any]) -> bool:
        """No writing surface in a debate: it is spoken, both ways."""
        return False

    async def build(self, *, uid: str, session_id: str, session: dict[str, Any], resumed: bool) -> LiveAgentSpec:
        plan, _ = await load_plan(uid, session)
        debater = debater_for(plan.fmt)
        instruction = build_instruction(plan, debater=debater, resumed=resumed)
        formal = plan.fmt in (DebateFormat.OXFORD, DebateFormat.STRUCTURED)
        return LiveAgentSpec(
            system_instruction=instruction,
            opening_message=resume_message() if resumed else opening_message(plan),
            voice_name=debater.voice,
            silence_duration_ms=FORMAL_SILENCE_MS if formal else SILENCE_MS,
            # No `give_floor`: a debate is two people, and the opponent never hands over.
            tools=("end_interview",),
            lead_name=debater.name,
        )


def session_brief(session: dict[str, Any]) -> str:
    """One line describing a debate session, for logs. Never any of its content."""
    context = session.get("context") or {}
    return (
        f"{parse_format(context.get('format')).value}/{context.get('difficulty')} "
        f"user={context.get('userPosition')} ai={context.get('aiPosition')}"
    )


__all__ = ["DebateLiveAgentFactory", "brief_line", "session_brief"]
