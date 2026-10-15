from __future__ import annotations

import pytest

from app.platform.agents.live_gateway import says_goodbye


@pytest.mark.parametrize("text", [
    "Okay, my bus is here. See you around!",
    "Nice talking to you. Have a great day, Luna.",
    "Goodbye!",
    "Bye now.",
    "Take care.",
    "See you next time!",
    "Alright, talk soon.",
])
def test_a_turn_ending_on_a_goodbye_ends_the_talk(text: str) -> None:
    assert says_goodbye(text)


@pytest.mark.parametrize("text", [
    "Before we say goodbye, one more question?",
    "Take care of the report and send it Monday.",
    "I said goodbye to my old job last year, and it felt good.",
    "Thanks, that was great. What else?",
    "",
])
def test_a_goodbye_mentioned_in_passing_ends_nothing(text: str) -> None:
    assert not says_goodbye(text)


def test_every_room_has_ground_rules_and_all_but_the_language_center_are_english_only() -> None:
    from app.platform.agents.live import LiveAgentSpec
    from app.platform.agents.live_adk import ENGLISH_ONLY_RULE, GUARDRAILS, instruction_for

    room = LiveAgentSpec(system_instruction="You are Tom at the bus stop.", opening_message="")
    assert instruction_for(room).endswith(GUARDRAILS + ENGLISH_ONLY_RULE)
    tutor = LiveAgentSpec(system_instruction="You teach Spanish.", opening_message="", english_only=False)
    assert instruction_for(tutor) == "You teach Spanish." + GUARDRAILS
