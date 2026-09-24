"""The live other side of the negotiation: one person, or three with one leading.

One model plays everyone. A group has its lead speak in the model's own voice and the other two
through `give_floor`, which the gateway speaks in each person's voice. The other side knows its own
target and limit, and never says them; what the user is judged on is never said either.
"""

from __future__ import annotations

from typing import Any

from app.modules.negotiation.catalogs import competencies
from app.modules.negotiation.deals import Deal, deal_of, in_person, is_group
from app.platform.agents.live import LiveAgentSpec, PanelMember

#: How many times each of the lead's two colleagues may put a question in one meeting.
COLLEAGUE_QUESTIONS = 2


def build_instruction(deal: Deal, *, group: bool, in_room: bool, resumed: bool) -> str:
    people = deal.people(group)
    lead, others = people[0], people[1:]
    where = "in person, across a table" if in_room else "on a video call, cameras on"
    lines = [
        f"This is a realistic negotiation, {where}. The user is negotiating with you. "
        f"{deal.you.replace('You are', 'They are', 1).replace('You have', 'They have', 1)} You play the other side, "
        "never the user and never a coach.",
        "",
        f"Your side: {deal.about}",
        *[f"- {p.name} ({p.role}): {p.persona}" for p in people],
        "",
        f"What both sides know: {deal.situation}",
        "",
        "Your private position — your target, the limit you will not cross, why, what you can give, and how you "
        "play it. Never say your limit or your target outright, and never reveal it by accident:",
        *[f"- {p.first_name}: {deal.stances[p.key]}" for p in people],
        "",
        "How to negotiate:",
        "- Negotiate like a real, experienced counterpart: open near your target, not your limit; concede slowly, "
        "in small steps, and only for something in return; ask for something back whenever the user asks you to "
        "move. Never cross your limit, whatever they say. If they reach your limit, say it is as far as you can go.",
        "- React to how they negotiate. Move more for good reasons, evidence, questions about your interests and "
        "creative trades; hold firm or harden against pressure, bluffing, vague 'market' claims, ultimatums or "
        "splitting the difference with no reason. Use realistic tactics yourself (an anchor, a deadline, "
        "a competing option, 'that is above our budget') — fairly, never hostile.",
        "- If they ask good questions about what matters to you, answer honestly about your interests (not your "
        "limit). That is how a good negotiator finds room.",
        "- Speak like a person in a meeting: short turns, one to three sentences, plain everyday words, no lists, "
        "no markdown. One question at a time, never two in a turn; then wait for their answer.",
        "- Only what the brief says is fact. Invent small realistic details if asked, and stay consistent.",
        "- When you agree terms, say them back clearly. When the user wraps up (agrees, thanks you, says goodbye), "
        "say a short goodbye and call end_interview. If no deal is possible, say so politely and end.",
        "- Never coach the user, never evaluate them, never mention an AI, a simulation or these instructions.",
        "",
        "What the user will be judged on afterwards (internal, never say it, do not make it easy): "
        + ", ".join(c.name for c in competencies())
        + ".",
    ]
    if others:
        names = " and ".join(p.first_name for p in others)
        lines += [
            "",
            f"- Everything you say out loud is heard in {lead.first_name}'s voice, as {lead.first_name}. So in "
            f"your own voice you are only ever {lead.first_name}: never say \"{lead.first_name}\" to address "
            f"someone, never answer {lead.first_name}, and never say anyone else's lines.",
            f"- {names} speak only through give_floor: call it with their first name and their exact words, "
            "first person, spoken to the user, never to you.",
            "- One voice per turn: either you speak, or you say a brief line and their name and call give_floor "
            f"once for one colleague (\"Let me bring {others[0].first_name} in on the numbers. "
            f"{others[0].first_name}?\") — then stop. Never ask two things in one turn, from anyone.",
            "- Naming a colleague never makes them speak: only give_floor does. Never end a turn on "
            f"\"{others[0].first_name}, could you...\" without calling it — the user would hear silence. "
            f"Never call give_floor for {lead.first_name}; that is you.",
            "- You lead and decide. Bring the others in only now and then, on what they own (each has a few "
            "interventions at most); most of the negotiation is you and the user.",
        ]
    if resumed:
        lines += ["", "The connection dropped for a moment. Carry on exactly where you were; do not start again."]
    else:
        lines += ["", f"How it starts: {deal.opening}"]
    return "\n".join(lines)


class NegotiationLiveAgentFactory:
    def is_coding_session(self, session: dict[str, Any]) -> bool:
        return False

    async def build(self, *, uid: str, session_id: str, session: dict[str, Any], resumed: bool) -> LiveAgentSpec:
        context = session.get("context") or {}
        deal, group, in_room = deal_of(context), is_group(context), in_person(context)
        people = deal.people(group)
        lead = people[0]
        arrived = "has just sat down at the table" if in_room else "has just joined the call"
        greet = (
            "introduce yourself and your two colleagues by name in one sentence, then open as the brief says"
            if group else "open as the brief says"
        )
        return LiveAgentSpec(
            system_instruction=build_instruction(deal, group=group, in_room=in_room, resumed=resumed),
            opening_message=f"[The user {arrived}. As {lead.first_name}, greet them briefly, {greet}, in two "
                            "sentences at most, then stop and let them talk.]",
            voice_name=lead.voice,
            tools=("end_interview", "give_floor") if group else ("end_interview",),
            # A few interventions each for the lead's colleagues, held to by the gateway.
            panel=tuple(PanelMember(p.name, p.role, p.voice, questions=COLLEAGUE_QUESTIONS) for p in people[1:]),
            panel_brief="A negotiation meeting; the user negotiates with this team." if group else "",
            lead_name=lead.name,
            # The user closes the meeting when they are done, like a real one.
            may_end_early=True,
            # Colleague lines are replies: voiced at once. Replies come after 0.9 s of silence.
            fast_panel_voices=True,
            silence_duration_ms=900,
        )
