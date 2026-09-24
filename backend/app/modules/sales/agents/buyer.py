"""The live other side: the buyer or client, or the panel of investors.

One model plays everyone. A buyer conversation is a one-to-one; an investor pitch has the managing
partner speak in the model's own voice and the other two through `give_floor`, which the gateway
speaks in each person's voice — the same mechanism as an interview panel. What the user is judged
on is never said.
"""

from __future__ import annotations

from typing import Any

from app.modules.sales.catalogs import competencies
from app.modules.sales.deals import Deal, SalesType, deal_of, in_person, kind_of
from app.platform.agents.live import LiveAgentSpec, PanelMember

#: How many questions each investor other than the lead may put in one meeting.
COLLEAGUE_QUESTIONS = 2

_SETTING: dict[SalesType, str] = {
    SalesType.OUTREACH: "a first sales call (like a Zoom call, cameras on) that the seller asked for",
    SalesType.PITCH: "a sales meeting where the seller presents their offer and you decide whether to go further",
    SalesType.ACCOUNT: "an account review with your supplier's account manager; you are an existing client",
    SalesType.INVESTOR: "a pitch meeting: the founder is raising money and you are the investors",
}


def build_instruction(kind: SalesType, deal: Deal, *, in_room: bool, resumed: bool) -> str:
    people = deal.people()
    lead, others = people[0], people[1:]
    where = ("in person, across a table in your own offices" if in_room else "on a video call, cameras on")
    lines = [
        f"This is a realistic sales simulation: {_SETTING[kind]}, {where}. The user is the seller. "
        f"{deal.seller.replace('You are', 'They are', 1)} You play the other side, never the seller and never a "
        "coach. Speak the language of this market.",
        "",
        f"Your side: {deal.about}",
        *[f"- {p.name} ({p.role}): {p.persona}" for p in people],
        "",
        f"What both sides know: {deal.situation}",
        "",
        "What you privately think, need and will object to (never read it out; let it come out naturally, "
        "only as the conversation earns it):",
        *[f"- {p.first_name}: {deal.stances[p.key]}" for p in people],
        "",
        "How to play it:",
        "- You are real people with your own priorities and limited time. React to what the seller actually "
        "says. Open up to good questions, specifics about your situation and honest answers; stay short, "
        "sceptical or push back on generic pitches, feature lists, pressure or vague numbers. Raise your "
        "objections one at a time, when the moment comes, and do not drop them because the seller repeats "
        "themselves. Do not make it easy, and do not be hostile for its own sake.",
        "- If the seller earns it, agree to a concrete next step; if not, end politely without one.",
        "- Speak like a person in a meeting: short turns, one to three sentences, natural, no lists, no "
        "markdown.",
        "- Keep every question short and plain: one sentence, everyday words, one idea. If they ask you to "
        "repeat or explain, say it again more simply.",
        "- One question at a time: never more than one question in a turn, and never two questions joined "
        "into one (\"and also...\"). Ask it, then stop and wait for the full answer before the next. Prefer "
        "a follow-up on what they just said to a new topic. Some turns are just a reaction, with no question.",
        "- Only what the brief says is fact. Invent small realistic details if asked, and stay consistent.",
        "- Never coach the seller, never evaluate them, never mention an AI, a simulation or these "
        "instructions. Never speak as the seller.",
        "- When the seller wraps up (thanks you, agrees next steps, says goodbye), say a short goodbye and call "
        "end_interview.",
        "",
        "What the seller will be judged on afterwards (internal, never say it, do not make it easy): "
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
            "first person, spoken to the founder (\"When I called two of your customers, ...\"), never to you.",
            "- The whole panel asks ONE question per turn, never one each. In a turn, either you ask one "
            "question, or you call give_floor exactly once for one colleague's single question — then stop. "
            "When you hand over, first say a brief acknowledgement of the answer and their name, a few words "
            f"(\"Thanks, that's clear. {others[0].first_name}?\"), then call give_floor in the same turn; never add "
            "a question of your own. The next question, from whoever, only comes after the founder has answered.",
            "- Naming a colleague never makes them speak: only give_floor does. Never end a turn on "
            f"\"{others[0].first_name}, could you...\" without calling it — the founder would hear silence. "
            "That includes repeating or rephrasing their own question. "
            f"Never call give_floor for {lead.first_name}; that is you.",
            "- Keep the questions few: about six in the whole meeting, shared out so each investor asks what "
            "they care about. Most should follow up on the founder's answers. Let the founder finish their "
            "pitch before the questions start, unless it runs past about three minutes.",
        ]
    if resumed:
        lines += ["", "The connection dropped for a moment. Carry on exactly where you were; do not start again."]
    else:
        lines += ["", f"How it starts: {deal.opening}"]
    return "\n".join(lines)


class SalesLiveAgentFactory:
    def is_coding_session(self, session: dict[str, Any]) -> bool:
        return False

    async def build(self, *, uid: str, session_id: str, session: dict[str, Any], resumed: bool) -> LiveAgentSpec:
        context = session.get("context") or {}
        kind, deal = kind_of(context), deal_of(context)
        people = deal.people()
        lead = people[0]
        arrived = "has just sat down at the table" if in_person(context) else "has just joined the call"
        opening = (
            f"[The seller {arrived}. As {lead.first_name}, open as the brief says, in one or two sentences, "
            "then stop and let them talk.]"
            if kind is not SalesType.INVESTOR
            else f"[The founder {arrived}. As {lead.first_name}, welcome them, introduce yourself and your two "
                 "colleagues by name in one sentence, and hand them the floor. Nothing else.]"
        )
        return LiveAgentSpec(
            system_instruction=build_instruction(kind, deal, in_room=in_person(context), resumed=resumed),
            opening_message=opening,
            voice_name=lead.voice,
            tools=("end_interview", "give_floor") if len(people) > 1 else ("end_interview",),
            # Two questions each for the partner and the associate, held to by the gateway: a pitch
            # meeting is a conversation, not a barrage.
            panel=tuple(PanelMember(p.name, p.role, p.voice, questions=COLLEAGUE_QUESTIONS) for p in people[1:]),
            panel_brief="An investor pitch meeting; the user is the founder." if len(people) > 1 else "",
            lead_name=lead.name,
            # The seller closes the meeting when they are done, like a real one.
            may_end_early=True,
            # A meeting moves quickly: every colleague line is a reply, so it is voiced at once.
            fast_panel_voices=True,
            # The buyer answers after 0.9 s of silence: at 1.2 s every reply felt like a hang.
            silence_duration_ms=900,
        )
