"""The live meeting: the other people in the room, played by one model.

In a group the one who speaks most (Robert) is the model's own voice and the others speak through
`give_floor`, which the gateway voices in theirs. How they behave depends on the user's role: when
the user runs the meeting they wait to be led; when someone else chairs, Robert or Claire runs it
and brings the user in; when the user is the client, the team reports to them.
"""

from __future__ import annotations

from typing import Any

from app.modules.meeting.catalogs import competencies
from app.modules.meeting.plan import Plan, Role, in_person, is_group, plan_of
from app.platform.agents.live import LiveAgentSpec, PanelMember

#: How many times each of the lead's two colleagues may be handed the floor for a question of their own.
COLLEAGUE_QUESTIONS = 3

_ROLE_PLAY: dict[Role, str] = {
    Role.LEADER: (
        "The user runs this meeting. Wait for them to open it and follow their lead: answer when they ask, give "
        "your updates and views when they bring you in, and let them manage time and decisions. Be realistic "
        "attendees: sometimes someone goes long, two people disagree, or a question drifts off the agenda — and "
        "you respond to how well they steer it. Never take over the meeting."
    ),
    Role.PARTICIPANT: (
        "The lead attendee chairs this meeting: states the purpose, goes through the agenda, and brings the user in. "
        "The user is a participant. Give them real chances to contribute, react to what they say, and push back where "
        "your stance differs. Do not do their thinking for them; if they stay quiet, the chair asks them directly."
    ),
    Role.STAKEHOLDER: (
        "The user is the client or stakeholder the team reports to. The lead attendee presents status and "
        "proposals briefly; the team answers the user's questions, defends its plan where it has reasons, and "
        "negotiates trade-offs. Treat the user's priorities as important, but do not agree to everything."
    ),
}


def build_instruction(plan: Plan, *, group: bool, in_room: bool, resumed: bool) -> str:
    people = plan.people(group)
    lead, others = people[0], people[1:]
    where = "in person, around a table" if in_room else "on a video call, cameras on"
    lines = [
        f"This is a realistic work meeting, {where}: \"{plan.title}\". "
        f"{plan.you.replace('You are', 'The user is', 1)} You play the other people in the meeting, never the "
        "user and never a coach.",
        "",
        f"The organisation: {plan.about}",
        *[f"- {p.name} ({p.role}): {p.persona}" for p in people],
        "",
        f"What everyone knows (background and agenda): {plan.situation}",
        "",
        "What each of you privately wants, worries about and will push (never read it out; let it come out "
        "naturally):",
        *[f"- {p.first_name}: {plan.stances[p.key]}" for p in people],
        "",
        "How to play it:",
        f"- {_ROLE_PLAY[plan.role]}",
        "- Be real colleagues with your own stakes: react to what the user actually says. Engage with clear, "
        "specific contributions; push back, ask for facts or drift when they are vague or ramble.",
        "- Speak like people in a meeting: short turns, one to three sentences, plain everyday words, no lists, no "
        "markdown. One question at a time, never two in a turn; then wait for the answer.",
        "- Everything you say is spoken aloud as dialogue: never say stage directions, notes, or anything in "
        "brackets.",
        "- Let the user finish their point: never cut in while they are presenting or explaining. React once they "
        "have finished.",
        "- Only what the brief and the user say is fact. Invent small realistic details if asked, and stay "
        "consistent.",
        "- When the meeting is wrapped up (actions agreed, thanks, goodbye), say a short goodbye and call "
        "end_interview.",
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
            f"- {names} speak only through give_floor: call it with their first name and their exact words, first "
            "person, spoken to the room.",
            "- One voice per turn: either you speak, or you say a brief line and their name and call give_floor "
            f"once for one colleague (\"Good point. {others[0].first_name}, you had a view on this?\") — then stop. "
            "When the user brings someone in by name, that person answers through give_floor.",
            "- Naming a colleague never makes them speak: only give_floor does. Never end a turn on "
            f"\"{others[0].first_name}, could you...\" without calling it — the user would hear silence. "
            f"Never call give_floor for {lead.first_name}; that is you.",
        ]
    if resumed:
        lines += ["", "The connection dropped for a moment. Carry on exactly where you were; do not start again."]
    else:
        lines += ["", f"How it starts: {plan.opening}"]
    return "\n".join(lines)


class MeetingLiveAgentFactory:
    def is_coding_session(self, session: dict[str, Any]) -> bool:
        return False

    async def build(self, *, uid: str, session_id: str, session: dict[str, Any], resumed: bool) -> LiveAgentSpec:
        context = session.get("context") or {}
        plan, group, in_room = plan_of(context), is_group(context), in_person(context)
        people = plan.people(group)
        lead = people[0]
        if plan.role is Role.LEADER:
            # The user called the meeting: one short hello, and then it is theirs to open.
            opening = (f"[Everyone has joined. As {lead.first_name}, say only a short hello (\"Hi, we're all here.\") "
                       "and stop: the user runs this meeting and will open it.]")
        else:
            arrived = "has just sat down at the table" if in_room else "has just joined the call"
            opening = (f"[The user {arrived}. As {lead.first_name}, open the meeting as the brief says, in two "
                       "sentences at most, then stop and let them talk.]")
        return LiveAgentSpec(
            system_instruction=build_instruction(plan, group=group, in_room=in_room, resumed=resumed),
            opening_message=opening,
            voice_name=lead.voice,
            tools=("end_interview", "give_floor") if group else ("end_interview",),
            panel=tuple(PanelMember(p.name, p.role, p.voice, questions=COLLEAGUE_QUESTIONS) for p in people[1:]),
            panel_brief="A work meeting; the user is one of the attendees." if group else "",
            lead_name=lead.name,
            # A meeting ends when the user closes it.
            may_end_early=True,
            # Colleague lines are replies: voiced at once. Replies come after 1.2 s of silence — 1.4 s when the
            # user runs the meeting, since they present at length and a breath between sentences is not the end.
            # (At 0.9 s Kevin and the lead cut into the user's sentences, 2026-10-01.)
            fast_panel_voices=True,
            silence_duration_ms=1400 if plan.role is Role.LEADER else 1200,
        )
