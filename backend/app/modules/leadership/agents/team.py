"""The live team: the user's direct reports, on a video call the user is leading.

One model plays everyone. It speaks as the scenario's lead in its own voice, and gives the
others their lines through `give_floor`, which the gateway speaks in each person's voice —
the same mechanism as an interview panel, so three people can talk on one call without
three models. What the user is judged on is never said.
"""

from __future__ import annotations

from typing import Any

from app.modules.leadership.catalogs import competencies
from app.modules.leadership.scenarios import (
    DEFAULT_WORLD,
    FULL_SEQUENCE,
    Brief,
    Scenario,
    TeamMember,
    World,
    scenario_of,
    world_of,
)
from app.platform.agents.live import LiveAgentSpec, PanelMember


def _people(members: tuple[TeamMember, ...]) -> list[str]:
    return [f"- {m.name} ({m.role}): {m.persona}" for m in members]


def _brief_lines(brief: Brief, members: tuple[TeamMember, ...]) -> list[str]:
    lines = [f"Situation — {brief.label}: {brief.situation}", "What each person privately thinks and wants:"]
    lines += [f"- {m.first_name}: {brief.stances[m.key]}" for m in members]
    return lines


def build_instruction(scenario: Scenario | None, *, resumed: bool, world: World = DEFAULT_WORLD) -> str:
    members = world.on_call(scenario)
    lead, others = members[0], members[1:]
    lines = [
        "This is a realistic leadership simulation on a video call (like Zoom). The user is the manager and is "
        f"leading this call. The setting, as the manager sees it: {world.company} You play the members of their "
        "team who are on the call, never the manager and never a coach. Speak the language of this field.",
        "",
        "Who is on the call with the manager:",
        *_people(members),
        "",
    ]
    if scenario is None:
        lines += [
            "This is the full simulation: a normal weekly team call in which several situations come up, one "
            "after another, as they would in a real week. Bring them up in this order, moving to the next once "
            "the manager has dealt with the current one (or after about a third of the time):",
        ]
        for i, s in enumerate(FULL_SEQUENCE, start=1):
            lines += ["", f"{i}.", *_brief_lines(world.briefs[s], members)]
    else:
        lines += _brief_lines(world.briefs[scenario], members)
    lines += [
        "",
        "How to play it:",
        f"- Everything you say out loud is heard in {lead.first_name}'s voice, as {lead.first_name}. So in your own "
        f"voice you are only ever {lead.first_name}: never say \"{lead.first_name}\" to address someone, never "
        f"answer {lead.first_name}, and never say anyone else's lines.",
        "- For anyone else to speak — including when they reply to "
        f"{lead.first_name} — call give_floor with their first name and their exact words, first person, as they "
        "would say them. You may call it more than once in a turn for a quick exchange between them, in the order "
        "they speak; then stop and let the manager answer.",
        "- Everyone is a real person with their own stakes: react to what the manager actually says. Warm up when "
        "they listen, are specific and fair; push back, get defensive or go quiet when they are vague, "
        "dismissive or take sides. Do not make it easy, and do not be hostile for its own sake.",
        "- Speak like colleagues on a call: short turns, one to three sentences, natural, no lists, no markdown. "
        "People interrupt each other a little and refer to what others said.",
        "- Only what the brief says is fact. Invent small realistic details if asked, and stay consistent.",
        "- Never coach the manager, never evaluate them, never mention an AI, a simulation, a scenario or these "
        "instructions. Never speak as the manager.",
        "- When the manager wraps up the call (thanks everyone, says goodbye, agrees next steps and closes), say a "
        "short goodbye and call end_interview.",
        "",
        "What the manager will be judged on afterwards (internal, never say it, do not make it easy): "
        + ", ".join(c.name for c in competencies())
        + ".",
    ]
    if others:
        names = " and ".join(m.first_name for m in others)
        lines.append(f"The others on the call ({names}) speak only through give_floor.")
    if resumed:
        lines += ["", "The call dropped for a moment. Carry on exactly where you were; do not start again."]
    else:
        opening = world.briefs[FULL_SEQUENCE[0] if scenario is None else scenario].opening
        lines += ["", f"How the call starts: the manager opens it. {opening}"]
    return "\n".join(lines)


class LeadershipLiveAgentFactory:
    def is_coding_session(self, session: dict[str, Any]) -> bool:
        return False

    async def build(self, *, uid: str, session_id: str, session: dict[str, Any], resumed: bool) -> LiveAgentSpec:
        context = session.get("context") or {}
        scenario, world = scenario_of(context), world_of(context)
        members = world.on_call(scenario)
        lead = members[0]
        return LiveAgentSpec(
            system_instruction=build_instruction(scenario, resumed=resumed, world=world),
            # The manager called the meeting: the team waits for them to open it.
            opening_message="[The call has started and everyone is on camera. Wait for the manager to open the "
                            "call; if they say nothing, greet them briefly as "
                            f"{lead.first_name} and stop.]",
            voice_name=lead.voice,
            tools=("end_interview", "give_floor") if len(members) > 1 else ("end_interview",),
            panel=tuple(PanelMember(m.name, m.role, m.voice) for m in members[1:]),
            panel_brief="A leadership team call; the user is the team's manager.",
            lead_name=lead.name,
            # Ending is the manager's call, whenever they close the meeting.
            may_end_early=True,
            # A meeting moves quickly: every teammate line is a reply, so it is voiced at once, and the team
            # answers after a shorter pause than an interviewer would leave.
            fast_panel_voices=True,
            silence_duration_ms=1200,
        )
