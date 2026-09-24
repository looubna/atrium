"""The panel conductor's pieces: when an answer is over, and what the lead is told."""

from __future__ import annotations

import pytest

from app.modules.interview.interviewers import PANEL_IN_PERSON
from app.platform.agents import panel
from app.platform.agents.live import PanelMember
from app.platform.agents.panel import (
    AnswerListener,
    Exchange,
    catch_up_note,
    frame_rms,
    questions_in,
    write_panel_line,
)

(MARCUS,) = PANEL_IN_PERSON.askers
# A second speaker, so the panel machinery is still exercised with more than one colleague.
# It supports any number; the interview itself seats one who asks and one who only takes notes.
SECOND = PanelMember("Nadia Okafor", "Product Lead", "Aoede",
                     "Hi, I'm Nadia.", "how the candidate works with product")


def tone(amplitude: int) -> bytes:
    return amplitude.to_bytes(2, "little", signed=True) * 1600


def test_frame_level() -> None:
    assert frame_rms(tone(3000)) == pytest.approx(3000, rel=0.01)
    assert frame_rms(tone(0)) == 0
    assert frame_rms(b"") == 0


def test_an_answer_ends_after_speech_then_silence() -> None:
    listener = AnswerListener(from_ms=0)
    at = 0
    for _ in range(15):  # 1.5 s of speech
        assert not listener.feed(at, tone(2500))
        at += 100
    for _ in range(21):  # a thinking pause is not the end
        assert not listener.feed(at, tone(0))
        at += 100
    assert listener.feed(at, tone(0))
    assert listener.outcome == "answered" and listener.speech_ms == 1500
    assert len(listener.pcm) == 37 * 3200


def test_a_brief_noise_is_not_an_answer_and_silence_times_out() -> None:
    listener = AnswerListener(from_ms=0)
    listener.feed(0, tone(2500))  # a cough
    at = 100
    while not listener.feed(at, tone(0)):
        at += 100
        assert at < 200_000
    assert listener.outcome == "long"  # never enough speech to count as answered, never silent either
    silent = AnswerListener(from_ms=0)
    at = 0
    while not silent.feed(at, tone(0)):
        at += 100
    assert silent.outcome == "silent" and at >= panel.NO_ANSWER_MS - 100


def test_frames_before_the_question_ended_are_held_then_ignored() -> None:
    listener = AnswerListener()
    for i in range(10):  # still playing: the mic picks up a little speech
        assert not listener.feed(i * 100, tone(2500))
    for i in range(10, 40):  # the answer starts right after, before the server knew playback ended
        listener.feed(i * 100, tone(2500) if i < 30 else tone(0))
    assert not listener.begin(1_000)
    assert listener.speech_ms == 2_000 and listener.started_ms == 1_000
    at = 4_000
    while not listener.feed(at, tone(0)):
        at += 100
    assert listener.outcome == "answered" and at == 5_100


def test_the_writer_is_told_the_job_and_the_colleague_focus() -> None:
    content = panel.panel_content("Case interview: X, for Nurse at Clinic.", "Evelyn Ross", SECOND, [], [])
    assert "for Nurse at Clinic" in content and SECOND.focus in content
    assert "never assume a field" in panel.panel_instruction()


async def test_panel_lines_are_new_and_hand_over_by_name(monkeypatch: pytest.MonkeyPatch) -> None:
    line = await write_panel_line("alice", "Behavioral interview", "Evelyn Ross", MARCUS, [], [])
    assert MARCUS.first_name in line.handover and line.question

    async def repeat(**_: object) -> panel.PanelLineDraft:
        return panel.PanelLineDraft(handover="Thanks.", question="What would you change?")

    monkeypatch.setattr(panel.gateway, "generate", repeat)
    fixed = await write_panel_line("alice", "b", "Evelyn Ross", SECOND, [], [])
    assert fixed.handover == "Thanks. Nadia, over to you."
    with pytest.raises(ValueError):
        await write_panel_line("alice", "b", "Evelyn Ross", SECOND, [], ["what would you change"])


def test_catch_up_note_tells_the_lead_everything_it_missed() -> None:
    note = catch_up_note("Evelyn", [
        Exchange(MARCUS, "How did you test it?", "With a pilot group."),
        Exchange(SECOND, "How did users react?", ""),
    ])
    assert 'Daniel asked: "How did you test it?" The candidate answered: "With a pilot group."' in note
    assert "(the candidate did not answer)" in note
    assert "not heard" in note and "Do not repeat" in note and "Evelyn" in note


def test_the_lead_is_reminded_of_its_own_questions() -> None:
    said = "Thanks for that. So, could you tell me about a time you led without authority? Take your time."
    assert questions_in(said) == ["So, could you tell me about a time you led without authority?"]
    assert questions_in("Right? Great.") == []
    note = catch_up_note("Evelyn", [Exchange(MARCUS, "How did you test it?", "A pilot.")], questions_in(said))
    assert 'never ask these again): "So, could you tell me about a time you led without authority?"' in note
    assert "already asked" not in catch_up_note("Evelyn", [Exchange(MARCUS, "Q?", "A.")])


def test_a_greeting_is_recognised_by_its_words() -> None:
    """The lead's label is not enough: it calls real questions hellos and hellos questions."""
    assert panel.is_greeting("Hi, I'm Marcus, I lead the team you'd be joining.", "Marcus")
    assert panel.is_greeting("Hello, nice to meet you.", "Marcus")
    assert panel.is_greeting("Good morning.", "Marcus")
    assert panel.is_greeting("My name is Marcus and I'm on the team.", "Marcus")
    assert panel.is_greeting("I'm Marcus, one of the team leads here.", "Marcus")
    # Anything the candidate has to answer is a question, whatever it opens with.
    assert not panel.is_greeting("Hi — could you walk me through that migration?", "Marcus")
    assert not panel.is_greeting("What would you do differently next time?", "Marcus")
    assert not panel.is_greeting("Tell me about a project you owned.", "Marcus")
