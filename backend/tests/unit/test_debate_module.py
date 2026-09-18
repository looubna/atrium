"""The debate module's intelligence, tested where it is decided.

The point of these tests is not coverage of the plumbing — it is that the opponent
behaves like an opponent: it answers what was put to it, does not ask the same thing
twice, returns to what was dropped, concedes without collapsing, notices contradictions,
and gets harder when the difficulty does.
"""

from __future__ import annotations

import pytest

from app.modules.debate.agents import analyzer
from app.modules.debate.agents.debater import DebatePlan, build_instruction, director_note
from app.modules.debate.agents.evaluator import debate_state_of, format_of
from app.modules.debate.argument import (
    Argument,
    Challenge,
    ChallengeTarget,
    Concession,
    Contradiction,
    DebateAction,
    Evidence,
    Phase,
    Side,
    Support,
    content_words,
    is_repeat,
    similarity,
)
from app.modules.debate.argument_map import build as build_map
from app.modules.debate.argument_map import patterns
from app.modules.debate.catalogs import (
    DEBATE_COMPETENCIES,
    DebateFormat,
    Difficulty,
    Focus,
    Position,
    PositionMode,
    assign_positions,
    competencies_for_format,
    parse_focus,
    parse_format,
)
from app.modules.debate.debaters import debater_for
from app.modules.debate.orchestrator import CLOSING_WINDOW_S, TUNING, decide
from app.modules.debate.retry import competency_name, harder, suggested_focus
from app.modules.debate.sources import LexicalRetriever, MaterialRecord, build_retriever, material_block
from app.modules.debate.state import PRESS_LIMIT, DebateState
from app.modules.debate.topics import needs_research, normalise_motion

TWENTY_MINUTES = 20 * 60_000


def _claim(
    state: DebateState,
    text: str,
    *,
    support: Support = Support.ASSERTED,
    assumptions: list[str] | None = None,
    evidence: list[Evidence] | None = None,
    reasons: list[str] | None = None,
) -> Argument:
    return state.add_argument(
        Argument(
            id=state.next_id("a"),
            side=Side.USER,
            claim=text,
            support=support,
            assumptions=assumptions or [],
            evidence=evidence or [],
            reasons=reasons or [],
            turn=state.turn,
        )
    )


def _challenge(
    state: DebateState, against: Argument, target: ChallengeTarget, text: str, *, turn: int | None = None
) -> Challenge:
    return state.add_challenge(
        Challenge(
            id=state.next_id("c"),
            by=Side.AI,
            target=target,
            against=against.id,
            text=text,
            turn=state.turn if turn is None else turn,
        )
    )


# ---------------------------------------------------------------------------
# Telling two objections apart (§25)


def test_a_reworded_objection_is_recognised_as_the_same_one() -> None:
    asked = ["But what about jobs?"]
    assert is_repeat("Could jobs be affected?", asked)
    assert is_repeat("What about the job losses?", asked)
    # A genuinely different objection gets through.
    assert not is_repeat("Who pays for the enforcement of this?", asked)
    assert not is_repeat("Does that hold in every sector?", asked)


def test_the_text_check_cannot_see_synonyms_and_the_structure_is_what_guarantees_it() -> None:
    """A documented limit, not a bug.

    Comparing vocabulary cannot know that "jobs" and "employment" are one subject, so the
    net misses that pair. The guarantee against repetition does not rest on it: the
    orchestrator never attacks the same part of the same argument twice, which is exact and
    is what actually stops the opponent asking about jobs three ways (see
    `test_an_objection_is_never_made_twice_against_the_same_argument`).
    """
    assert not is_repeat("What about employment?", ["But what about jobs?"])

    state = DebateState(turn=4)
    argument = _claim(state, "AI will create more jobs than it destroys", support=Support.UNSUPPORTED)
    _challenge(state, argument, ChallengeTarget.CLAIM, "But what about jobs?")
    # The same target against the same argument is off the table however it would be worded.
    assert ChallengeTarget.CLAIM in state.targets_used_against(argument.id)
    assert all(target is not ChallengeTarget.CLAIM for a, target in state.open_lines_of_attack() if a is argument)


def test_content_words_drop_filler_and_stem_to_a_common_root() -> None:
    assert content_words("Well, I really think the jobs are actually fine") == content_words("jobs fine")
    # "regulation"/"regulating" and "harm"/"harms" collapse, so a rewording scores as one.
    assert similarity("regulation reduces harm", "regulating reduces harms") == 1.0
    # A short word is not eroded into something else.
    assert "gas" in content_words("the gas price")


def test_state_will_not_record_an_objection_it_already_made() -> None:
    state = DebateState()
    argument = _claim(state, "AI will create more jobs than it destroys")
    _challenge(state, argument, ChallengeTarget.EVIDENCE, "What makes you confident about the jobs figures?")
    assert state.already_challenged("What makes you confident on the jobs figure?")
    assert not state.already_challenged("Does the timing of the transition matter?")


# ---------------------------------------------------------------------------
# Positions (§6)


@pytest.mark.parametrize("asked", [Position.FOR, Position.AGAINST])
def test_the_user_gets_the_side_they_chose_and_the_opponent_takes_the_other(asked: Position) -> None:
    user, ai = assign_positions(PositionMode.USER, asked)
    assert user is asked
    assert ai is asked.opposite


def test_an_assigned_or_random_position_ignores_what_the_user_asked_for() -> None:
    import random

    user, ai = assign_positions(PositionMode.ASSIGNED, Position.FOR, rng=random.Random(1))
    assert ai is user.opposite
    sides = {assign_positions(PositionMode.RANDOM, None, rng=random.Random(seed))[0] for seed in range(20)}
    # Over twenty tosses both sides come up, so it is a coin toss and not a fixed answer.
    assert sides == {Position.FOR, Position.AGAINST}


# ---------------------------------------------------------------------------
# The orchestrator: the opponent's behaviour


def test_the_debate_opens_by_stating_a_position() -> None:
    move = decide(
        DebateState(), difficulty=Difficulty.INTERMEDIATE, fmt=DebateFormat.FREE, time_remaining_ms=TWENTY_MINUTES
    )
    assert move.action is DebateAction.OPEN
    assert move.phase is Phase.OPENING


def test_an_objection_put_to_the_opponent_is_answered_before_anything_else() -> None:
    """An opponent that ignores what you said to it is not debating you."""
    state = DebateState(turn=5)
    mine = _claim(state, "Regulation slows innovation")
    state.add_challenge(
        Challenge(id="c9", by=Side.USER, target=ChallengeTarget.EVIDENCE, against=mine.id,
                  text="Where is the evidence that regulation slowed anything?", turn=5)
    )
    # There is also an open line of attack available; answering still comes first.
    move = decide(
        state, difficulty=Difficulty.ADVANCED, fmt=DebateFormat.FREE, time_remaining_ms=TWENTY_MINUTES
    )
    assert move.action is DebateAction.REBUT
    assert move.press is not None and move.press.id == "c9"


def test_a_strong_point_is_granted_before_the_disagreement_continues() -> None:
    state = DebateState(turn=6)
    _claim(state, "The transition costs fall on people who cannot retrain")
    move = decide(
        state, difficulty=Difficulty.INTERMEDIATE, fmt=DebateFormat.FREE,
        time_remaining_ms=TWENTY_MINUTES, last_turn_was_strong=True,
    )
    assert move.action is DebateAction.CONCEDE
    # And it says why it still disagrees, rather than simply agreeing.
    assert any("does not settle" in note for note in move.notes)


def test_the_opponent_does_not_concede_twice_in_a_row() -> None:
    state = DebateState(turn=7, conceded_on_turns=[6])
    _claim(state, "The transition costs fall on people who cannot retrain")
    move = decide(
        state, difficulty=Difficulty.INTERMEDIATE, fmt=DebateFormat.FREE,
        time_remaining_ms=TWENTY_MINUTES, last_turn_was_strong=True,
    )
    assert move.action is not DebateAction.CONCEDE


def test_an_evaded_objection_is_pressed_but_not_forever() -> None:
    state = DebateState(turn=4)
    argument = _claim(state, "AI will create more jobs than it destroys")
    challenge = _challenge(state, argument, ChallengeTarget.EVIDENCE, "Why will the new jobs compensate?")
    move = decide(
        state, difficulty=Difficulty.INTERMEDIATE, fmt=DebateFormat.FREE,
        time_remaining_ms=TWENTY_MINUTES, last_evaded_challenge=challenge,
    )
    assert move.action is DebateAction.PRESS

    challenge.pressed = PRESS_LIMIT
    move = decide(
        state, difficulty=Difficulty.INTERMEDIATE, fmt=DebateFormat.FREE,
        time_remaining_ms=TWENTY_MINUTES, last_evaded_challenge=challenge,
    )
    assert move.action is not DebateAction.PRESS


def test_a_contradiction_is_put_to_the_user_once_and_only_at_the_levels_that_track_them() -> None:
    def state_with_contradiction() -> DebateState:
        state = DebateState(turn=8, consecutive_challenges=0)
        _claim(state, "Regulation protects consumers", support=Support.SUPPORTED)
        state.add_argument(
            Argument(id="a2", side=Side.AI, claim="Consumers can weigh AI risks themselves", turn=7)
        )
        state.add_contradiction(
            Contradiction(
                id="x1", side=Side.USER,
                earlier="Regulation is necessary because consumers cannot assess AI risks",
                later="Consumers can independently evaluate AI risks",
                why="Both cannot be true of the same consumers",
            )
        )
        return state

    advanced = decide(
        state_with_contradiction(), difficulty=Difficulty.ADVANCED, fmt=DebateFormat.FREE,
        time_remaining_ms=TWENTY_MINUTES,
    )
    assert advanced.action is DebateAction.CHALLENGE
    assert advanced.target is ChallengeTarget.CONSISTENCY
    assert advanced.contradiction is not None

    beginner = decide(
        state_with_contradiction(), difficulty=Difficulty.BEGINNER, fmt=DebateFormat.FREE,
        time_remaining_ms=TWENTY_MINUTES,
    )
    assert beginner.target is not ChallengeTarget.CONSISTENCY

    # Raised once: after that it is not raised again.
    raised = state_with_contradiction()
    raised.contradictions[0].raised = True
    again = decide(
        raised, difficulty=Difficulty.ADVANCED, fmt=DebateFormat.FREE, time_remaining_ms=TWENTY_MINUTES
    )
    assert again.target is not ChallengeTarget.CONSISTENCY


def test_the_opponent_advances_its_own_case_instead_of_only_interrogating() -> None:
    state = DebateState(turn=6, consecutive_challenges=TUNING[Difficulty.INTERMEDIATE].max_consecutive_challenges)
    state.add_argument(Argument(id="a9", side=Side.AI, claim="An earlier point of its own", turn=2))
    _claim(state, "Regulation is necessary")
    move = decide(
        state, difficulty=Difficulty.INTERMEDIATE, fmt=DebateFormat.FREE, time_remaining_ms=TWENTY_MINUTES
    )
    assert move.action is DebateAction.ARGUE


def test_a_socratic_opponent_never_switches_to_asserting_its_own_case() -> None:
    state = DebateState(turn=6, consecutive_challenges=9)
    _claim(state, "Regulation is necessary", assumptions=["That the rules would be enforced"])
    move = decide(
        state, difficulty=Difficulty.ADVANCED, fmt=DebateFormat.SOCRATIC, time_remaining_ms=TWENTY_MINUTES
    )
    assert move.action is not DebateAction.ARGUE


def test_an_abandoned_objection_is_brought_back_later() -> None:
    state = DebateState(turn=10, consecutive_challenges=0)
    state.add_argument(Argument(id="a9", side=Side.AI, claim="Its own point", turn=2))
    argument = _claim(state, "AI will create more jobs", support=Support.SUPPORTED,
                      evidence=[Evidence(text="A named study", specific=True)])
    dropped = _challenge(state, argument, ChallengeTarget.CAUSALITY, "What rules out the other explanation?", turn=3)
    # Nothing else is open on this argument, and the objection is six turns old.
    for target in (ChallengeTarget.REASONING, ChallengeTarget.COUNTEREXAMPLE, ChallengeTarget.TRADEOFF,
                   ChallengeTarget.SCOPE, ChallengeTarget.DEFINITION, ChallengeTarget.ASSUMPTION):
        _challenge(state, argument, target, f"already asked about {target.value}")
    move = decide(
        state, difficulty=Difficulty.ADVANCED, fmt=DebateFormat.FREE, time_remaining_ms=TWENTY_MINUTES
    )
    assert move.action is DebateAction.PRESS
    assert move.press is not None and move.press.id == dropped.id


def test_the_last_ninety_seconds_close_the_debate_instead_of_opening_new_ground() -> None:
    state = DebateState(turn=14)
    _claim(state, "Regulation is necessary")
    move = decide(
        state, difficulty=Difficulty.ADVANCED, fmt=DebateFormat.FREE,
        time_remaining_ms=(CLOSING_WINDOW_S - 10) * 1000,
    )
    assert move.action is DebateAction.CLOSE
    assert any("end_interview" in note for note in move.notes)


def test_an_objection_is_never_made_twice_against_the_same_argument() -> None:
    state = DebateState(turn=4)
    state.add_argument(Argument(id="a9", side=Side.AI, claim="Its own point", turn=1))
    argument = _claim(state, "Every firm will simply move offshore", support=Support.UNSUPPORTED)
    first = decide(
        state, difficulty=Difficulty.ADVANCED, fmt=DebateFormat.FREE, time_remaining_ms=TWENTY_MINUTES
    )
    assert first.action is DebateAction.CHALLENGE and first.target is ChallengeTarget.CLAIM
    _challenge(state, argument, first.target, "What supports the claim that they would all move?")
    state.consecutive_challenges = 0
    second = decide(
        state, difficulty=Difficulty.ADVANCED, fmt=DebateFormat.FREE, time_remaining_ms=TWENTY_MINUTES
    )
    assert second.target is not ChallengeTarget.CLAIM


def test_difficulty_changes_behaviour_not_only_wording() -> None:
    beginner, advanced = TUNING[Difficulty.BEGINNER], TUNING[Difficulty.ADVANCED]
    assert beginner.challenges_per_turn < advanced.challenges_per_turn
    assert not beginner.tracks_contradictions and advanced.tracks_contradictions
    assert not beginner.attacks_implicit_assumptions and advanced.attacks_implicit_assumptions
    assert beginner.clarifies_every and not advanced.clarifies_every


def test_only_the_hardest_level_names_an_assumption_the_user_never_stated() -> None:
    def state_for() -> DebateState:
        state = DebateState(turn=5, consecutive_challenges=0)
        state.add_argument(Argument(id="a9", side=Side.AI, claim="Its own point", turn=1))
        # Supported, with specific evidence and no stated assumption: the assumption is implicit.
        return state

    advanced_state = state_for()
    _claim(advanced_state, "Historically technology has created new industries", support=Support.SUPPORTED,
           evidence=[Evidence(text="The industrial revolution", specific=True)])
    advanced = decide(
        advanced_state, difficulty=Difficulty.ADVANCED, fmt=DebateFormat.FREE, time_remaining_ms=TWENTY_MINUTES
    )
    assert advanced.target is ChallengeTarget.ASSUMPTION

    intermediate_state = state_for()
    _claim(intermediate_state, "Historically technology has created new industries", support=Support.SUPPORTED,
           evidence=[Evidence(text="The industrial revolution", specific=True)])
    intermediate = decide(
        intermediate_state, difficulty=Difficulty.INTERMEDIATE, fmt=DebateFormat.FREE,
        time_remaining_ms=TWENTY_MINUTES,
    )
    assert intermediate.target is not ChallengeTarget.ASSUMPTION


def test_an_objection_that_would_not_apply_is_never_made() -> None:
    """Asking for evidence that was already given is the irrelevant objection §21 rules out."""
    state = DebateState(turn=4)
    argument = _claim(
        state, "Pipe flow becomes turbulent above a Reynolds number of about two thousand",
        support=Support.SUPPORTED, evidence=[Evidence(text="Reynolds' 1883 experiment", specific=True)],
    )
    assert not state._applies(argument, ChallengeTarget.EVIDENCE)
    assert not state._applies(argument, ChallengeTarget.CLAIM)
    # And a scope objection only where the claim actually overreaches.
    broad = _claim(state, "Every regulation always slows innovation", support=Support.UNSUPPORTED)
    assert state._applies(broad, ChallengeTarget.SCOPE)
    assert not state._applies(argument, ChallengeTarget.SCOPE)


def test_a_focus_reorders_the_objections_without_inventing_one() -> None:
    def state_for() -> DebateState:
        state = DebateState(turn=5, consecutive_challenges=0)
        state.add_argument(Argument(id="a9", side=Side.AI, claim="Its own point", turn=1))
        _claim(
            state, "Automation reduces employment because it replaces routine work",
            support=Support.SUPPORTED, assumptions=["That displaced workers do not move into new roles"],
            evidence=[Evidence(text="A vague reference to studies", specific=False)],
            reasons=["Routine work is the largest share of jobs"],
        )
        return state

    evidence_first = decide(
        state_for(), difficulty=Difficulty.ADVANCED, fmt=DebateFormat.FREE,
        time_remaining_ms=TWENTY_MINUTES, focus=Focus.EVIDENCE,
    )
    assert evidence_first.target is ChallengeTarget.EVIDENCE

    thinking_first = decide(
        state_for(), difficulty=Difficulty.ADVANCED, fmt=DebateFormat.FREE,
        time_remaining_ms=TWENTY_MINUTES, focus=Focus.CRITICAL_THINKING,
    )
    assert thinking_first.target in (ChallengeTarget.ASSUMPTION, ChallengeTarget.CAUSALITY)


# ---------------------------------------------------------------------------
# The note the opponent is actually sent


def _plan(**overrides: object) -> DebatePlan:
    base: dict[str, object] = dict(
        motion="Governments should regulate generative AI",
        topic="Governments should regulate generative AI",
        user_position=Position.FOR,
        ai_position=Position.AGAINST,
        fmt=DebateFormat.FREE,
        difficulty=Difficulty.ADVANCED,
        duration_minutes=20,
    )
    base.update(overrides)
    return DebatePlan(**base)  # type: ignore[arg-type]


def test_the_note_carries_the_move_the_unanswered_objections_and_nothing_spoken() -> None:
    state = DebateState(turn=6)
    state.add_argument(Argument(id="a9", side=Side.AI, claim="Its own point", turn=1))
    argument = _claim(state, "Regulation protects consumers", support=Support.UNSUPPORTED)
    _challenge(state, argument, ChallengeTarget.SCOPE, "Does that hold for every consumer, or only some?")
    move = decide(
        state, difficulty=Difficulty.ADVANCED, fmt=DebateFormat.FREE, time_remaining_ms=TWENTY_MINUTES
    )
    note = director_note(move, state, seconds_left=TWENTY_MINUTES // 1000)

    # Fenced as a note, so the model cannot mistake it for something the user said aloud.
    assert note.startswith("[Debate note")
    assert note.endswith("]")
    assert "not spoken by your opponent" in note
    # It carries what the opponent must not lose, and what it must not repeat.
    assert "Still unanswered by them" in note
    assert "do not repeat or rephrase" in note


def test_the_closing_note_names_what_went_unanswered() -> None:
    state = DebateState(turn=18)
    argument = _claim(state, "Regulation protects consumers")
    _challenge(state, argument, ChallengeTarget.EVIDENCE, "Which consumers, and protected from what exactly?")
    move = decide(
        state, difficulty=Difficulty.ADVANCED, fmt=DebateFormat.FREE,
        time_remaining_ms=30_000,
    )
    note = director_note(move, state, seconds_left=30)
    assert "unanswered" in note
    assert "Which consumers" in note


def test_the_note_only_carries_material_that_bears_on_the_turn() -> None:
    retriever = build_retriever(
        [
            {"text": "The paper reports a twelve per cent fall in manufacturing employment",
             "kind": "evidence", "materialId": "m1", "quote": "twelve per cent", "topic": "jobs"},
            {"text": "It defines proportionate enforcement as risk-weighted auditing",
             "kind": "definition", "materialId": "m1", "quote": "risk-weighted auditing", "topic": "enforcement"},
        ],
        {"m1": "Course reader"},
    )
    state = DebateState(turn=4)
    state.add_argument(Argument(id="a9", side=Side.AI, claim="Its own point", turn=1))
    _claim(state, "Automation destroys manufacturing jobs", support=Support.UNSUPPORTED)
    move = decide(
        state, difficulty=Difficulty.ADVANCED, fmt=DebateFormat.FREE, time_remaining_ms=TWENTY_MINUTES
    )
    note = director_note(
        move, state, retriever=retriever,
        last_user_turn="Automation destroys manufacturing jobs, everyone knows that",
    )
    assert "twelve per cent" in note
    # The unrelated definition stays out, and so does the document itself.
    assert "risk-weighted auditing" not in note
    assert "Course reader" in note


# ---------------------------------------------------------------------------
# The opponent's standing instruction


def test_the_instruction_states_the_sides_and_forbids_inventing_evidence() -> None:
    text = build_instruction(_plan(), debater=debater_for(DebateFormat.FREE), resumed=False)
    assert "You argue AGAINST" in text
    assert "Your opponent argues FOR" in text
    assert "Invent evidence" in text
    assert "Never the person" in text
    # It is an opponent with a position, not an interviewer.
    assert "not an interviewer" in text
    assert "end_interview" in text


def test_facts_reach_the_opponent_with_their_status_attached() -> None:
    plan = _plan(
        key_facts=[
            {"statement": "Three jurisdictions passed rules in 2025", "claimType": "source_based",
             "favours": "neither"},
            {"statement": "Acting early is worth its cost", "claimType": "argument", "favours": "for"},
            {"statement": "This is simply the right thing to do", "claimType": "opinion", "favours": "for"},
        ],
        researched=True,
    )
    text = build_instruction(plan, debater=debater_for(DebateFormat.FREE), resumed=False)
    assert "[SOURCE SAYS] Three jurisdictions" in text
    assert "[ARGUMENT] (helps the for side) Acting early" in text
    assert "[OPINION]" in text


def test_a_resumed_debate_does_not_start_over() -> None:
    text = build_instruction(_plan(), debater=debater_for(DebateFormat.FREE), resumed=True)
    assert "do not restart the debate" in text
    assert "Open the debate" not in text


def test_the_opponent_argues_against_the_strongest_version_of_the_users_case() -> None:
    plan = _plan(
        their_arguments=[{"claim": "The harm falls on people who did not choose the risk", "reason": "No opt-out"}],
    )
    text = build_instruction(plan, debater=debater_for(DebateFormat.FREE), resumed=False)
    assert "rather than a weak one" in text
    assert "did not choose the risk" in text


def test_a_focused_debate_says_so_without_becoming_a_drill() -> None:
    text = build_instruction(
        _plan(focus=Focus.EVIDENCE), debater=debater_for(DebateFormat.FREE), resumed=False
    )
    assert "while still arguing the motion properly" in text
    assert "do not let a vague source pass" in text


def test_devils_advocate_says_openly_what_it_is_doing() -> None:
    plan = _plan(fmt=DebateFormat.DEVILS_ADVOCATE)
    text = build_instruction(plan, debater=debater_for(DebateFormat.DEVILS_ADVOCATE), resumed=False)
    assert "devil's advocate" in text
    assert "argue it in earnest" in text


# ---------------------------------------------------------------------------
# Folding a turn's analysis into the state


def test_a_turn_becomes_structure_and_answers_the_objection_it_was_answering() -> None:
    state = DebateState()
    argument = _claim(state, "AI will create more jobs than it destroys", support=Support.UNSUPPORTED)
    challenge = _challenge(
        state, argument, ChallengeTarget.EVIDENCE, "What makes you confident the new jobs compensate?"
    )
    draft = analyzer.TurnAnalysisDraft(
        claims=[
            analyzer.ClaimDraft(
                claim="Historically technology has created new industries",
                reasons=["Every previous wave created more work than it removed"],
                evidence=[
                    analyzer.EvidenceDraft(
                        text="The industrial revolution", specific=True, attribution="", claimType="fact"
                    )
                ],
                assumptions=["That this transition happens at a comparable pace"],
                conclusion="So this one will too",
                support="supported",
            )
        ],
        answeredChallengeId=challenge.id,
        answerQuality="direct",
        concessions=[],
        definitions=[],
        contradictions=[],
        topic="jobs and automation",
        strength="strong",
    )
    made = analyzer.apply_analysis(draft, state, at_ms=91_000)

    assert state.turn == 1
    assert made[0].support is Support.SUPPORTED
    assert made[0].assumptions == ["That this transition happens at a comparable pace"]
    assert state.challenges[0].answered and state.challenges[0].answer_quality == "direct"
    assert "jobs and automation" in state.topics_covered
    assert analyzer.strength_of(draft) and not analyzer.evaded(draft)


def test_repeating_your_own_argument_strengthens_it_rather_than_making_a_new_one() -> None:
    state = DebateState()
    _claim(state, "Regulation protects consumers from harm", support=Support.UNSUPPORTED)
    draft = analyzer.TurnAnalysisDraft(
        claims=[
            analyzer.ClaimDraft(
                claim="Regulation protects consumers from harm",
                reasons=["The harm is documented"],
                evidence=[analyzer.EvidenceDraft(text="A named regulator's report", specific=True,
                                                 attribution="", claimType="source_based")],
                assumptions=[], conclusion="", support="supported",
            )
        ],
        answeredChallengeId="", answerQuality="", concessions=[], definitions=[], contradictions=[],
        topic="consumer protection", strength="ordinary",
    )
    analyzer.apply_analysis(draft, state, at_ms=1_000)
    assert len(state.side_arguments(Side.USER)) == 1
    assert state.side_arguments(Side.USER)[0].support is Support.SUPPORTED


def test_an_evasion_is_pressed_then_marked_answered_so_the_opponent_moves_on() -> None:
    state = DebateState()
    argument = _claim(state, "Regulation protects consumers")
    challenge = _challenge(state, argument, ChallengeTarget.CLAIM, "What supports that?")
    for _ in range(PRESS_LIMIT):
        state.answer_challenge(challenge.id, quality="evaded")
    assert challenge.answered
    assert challenge.answer_quality == "evaded"


def test_a_contradiction_is_recorded_once_however_it_is_worded() -> None:
    state = DebateState()
    for later in ("Consumers can independently evaluate AI risks", "Consumers can evaluate the AI risks themselves"):
        state.add_contradiction(
            Contradiction(
                id=state.next_id("x"), side=Side.USER,
                earlier="Consumers cannot assess AI risks", later=later, why="Both cannot hold",
            )
        )
    assert len(state.contradictions) == 1


def test_a_point_the_user_gave_up_is_not_attacked_again() -> None:
    state = DebateState()
    argument = _claim(state, "Every firm would move offshore")
    state.add_concession(
        Concession(side=Side.USER, text="Every firm would move offshore", kept_position=False)
    )
    analyzer.apply_conceded_arguments(state)
    assert argument.conceded
    assert all(a is not argument for a, _ in state.open_lines_of_attack())


# ---------------------------------------------------------------------------
# State survives a dropped connection


def test_the_state_round_trips_through_firestore() -> None:
    state = DebateState(turn=9, phase=Phase.DEEP_CHALLENGE, closing_signalled=True)
    argument = _claim(
        state, "Regulation protects consumers", support=Support.SUPPORTED,
        evidence=[Evidence(text="A regulator's report", specific=True, attribution="the FTC")],
        assumptions=["That the rules are enforced"],
    )
    _challenge(state, argument, ChallengeTarget.CAUSALITY, "What rules out the other explanation?")
    state.add_concession(Concession(side=Side.AI, text="The cost is real"))
    state.add_contradiction(
        Contradiction(id="x1", side=Side.USER, earlier="A", later="B", why="both cannot hold")
    )
    state.note_topic("enforcement")
    state.note_ai_point("Its own earlier point")

    restored = DebateState.from_doc(state.to_doc())
    assert restored.to_doc() == state.to_doc()
    assert restored.phase is Phase.DEEP_CHALLENGE
    assert restored.side_arguments(Side.USER)[0].evidence[0].attribution == "the FTC"
    assert restored.already_argued("Its own earlier point")


# ---------------------------------------------------------------------------
# Retrieval over the user's own material (§9)


def test_retrieval_finds_the_relevant_record_and_leaves_the_rest_alone() -> None:
    retriever = build_retriever(
        [
            {"text": "Employment in manufacturing fell twelve per cent", "kind": "evidence",
             "materialId": "m1", "topic": "jobs"},
            {"text": "The Brussels effect exports European rules worldwide", "kind": "claim",
             "materialId": "m2", "topic": "regulation"},
            {"text": "Proportionate means risk-weighted", "kind": "definition", "materialId": "m2",
             "topic": "definitions"},
        ]
    )
    assert [r.material_id for r in retriever.search("what happened to manufacturing employment?")] == ["m1"]
    assert [r.material_id for r in retriever.search("does the Brussels effect really apply here?")] == ["m2"]
    # Nothing relevant means nothing is sent, rather than padding the note.
    assert retriever.search("what is the capital of Peru?") == []


def test_a_rare_term_outweighs_one_every_record_shares() -> None:
    records = [
        MaterialRecord(text="regulation and the Brussels effect", kind="claim", material_id="m1"),
        MaterialRecord(text="regulation and employment levels", kind="claim", material_id="m2"),
        MaterialRecord(text="regulation and enforcement costs", kind="claim", material_id="m3"),
    ]
    retriever = LexicalRetriever(records)
    found = retriever.search("regulation Brussels effect", limit=1)
    assert found[0].material_id == "m1"


def test_a_debate_with_no_material_retrieves_nothing_and_does_not_fail() -> None:
    retriever = build_retriever([])
    assert len(retriever) == 0
    assert retriever.search("anything") == []
    assert material_block([]) == ""


# ---------------------------------------------------------------------------
# The argument map and the patterns (§27, §30)


def test_the_map_marks_what_the_debate_actually_showed() -> None:
    state = DebateState(turn=8)
    unsupported = _claim(state, "Every firm would move offshore", support=Support.UNSUPPORTED)
    _challenge(state, unsupported, ChallengeTarget.CLAIM, "What supports that?")
    supported = _claim(
        state, "Regulation protects consumers", support=Support.SUPPORTED,
        evidence=[Evidence(text="A regulator's report", specific=True)],
        assumptions=["That the rules are enforced"],
    )
    answered = _challenge(state, supported, ChallengeTarget.ASSUMPTION, "Why assume enforcement?")
    response = _claim(state, "Enforcement is funded by the levy")
    state.answer_challenge(answered.id, quality="direct", by_argument=response.id)

    the_map = build_map(state, motion="M", user_position="for", ai_position="against")
    by_id = {node["id"]: node for node in the_map["arguments"]}
    assert "unsupported" in by_id[unsupported.id]["flags"]
    assert "unanswered" in by_id[unsupported.id]["flags"]
    assert "evidence_ok" in by_id[supported.id]["flags"]
    assert "assumption" in by_id[supported.id]["flags"]
    assert by_id[supported.id]["challenges"][0]["response"]["claim"] == "Enforcement is funded by the levy"
    assert len(the_map["unansweredChallenges"]) == 1


def test_patterns_are_counted_from_the_debate_not_guessed() -> None:
    state = DebateState(turn=10)
    for text in ("All firms would leave", "Nobody would comply", "Every consumer benefits"):
        _claim(state, text, support=Support.UNSUPPORTED)
    argument = state.side_arguments(Side.USER)[0]
    challenge = _challenge(state, argument, ChallengeTarget.CLAIM, "What supports that?")
    state.answer_challenge(challenge.id, quality="evaded")
    state.answer_challenge(challenge.id, quality="evaded")
    second = _challenge(state, argument, ChallengeTarget.SCOPE, "Does that hold everywhere?")
    state.answer_challenge(second.id, quality="ignored")

    found = patterns(state)
    assert "claims_without_evidence" in found
    assert "overgeneralisation" in found
    assert "no_specific_examples" in found
    assert "never_conceded_a_point" in found
    assert "answering_a_different_question" in found
    # A pattern the debate did not show is not reported.
    assert "contradictions" not in found


def test_the_suggested_focus_follows_from_the_pattern() -> None:
    assert suggested_focus(["claims_without_evidence"]) is Focus.EVIDENCE
    assert suggested_focus(["ignored_objections"]) is Focus.REBUTTALS
    assert suggested_focus(["unexamined_assumptions"]) is Focus.CRITICAL_THINKING
    assert suggested_focus([]) is Focus.NONE


def test_harder_steps_up_and_stops_at_the_top() -> None:
    assert harder("beginner") is Difficulty.INTERMEDIATE
    assert harder("intermediate") is Difficulty.ADVANCED
    assert harder("advanced") is Difficulty.ADVANCED


# ---------------------------------------------------------------------------
# Topics and research (§7)


@pytest.mark.parametrize(
    "topic",
    [
        "Should governments regulate generative AI?",
        "The minimum wage should be raised",
        "Nuclear power is the fastest route to decarbonisation",
        "Standardised testing should be abolished in universities",
    ],
)
def test_topics_where_current_facts_matter_are_researched(topic: str) -> None:
    assert needs_research(topic)


@pytest.mark.parametrize("topic", ["Do we have free will?", "Beauty is objective", "Consciousness is physical"])
def test_conceptual_topics_are_not_searched_for(topic: str) -> None:
    assert not needs_research(topic)


def test_the_users_own_research_setting_always_wins() -> None:
    assert not needs_research("Should governments regulate generative AI?", asked=False)
    assert needs_research("Do we have free will?", asked=True)


def test_a_typed_topic_is_tidied_and_never_mangled() -> None:
    assert normalise_motion("  Should AI-generated content require   labelling?  ") == (
        "Should AI-generated content require labelling?"
    )
    assert normalise_motion("") == ""


# ---------------------------------------------------------------------------
# Catalogs, and the session-shaped helpers the pipeline uses


def test_every_debate_competency_id_is_namespaced_and_named() -> None:
    for competency_id in DEBATE_COMPETENCIES:
        assert competency_id.startswith("debate.")
        assert competency_name(competency_id) != competency_id
    assert competency_name("comm.clarity") == "Clarity"
    assert competency_name("nonsense.id") == "nonsense.id"


def test_a_socratic_debate_is_not_scored_on_defending_a_case_it_never_made() -> None:
    socratic = {c.id for c in competencies_for_format(DebateFormat.SOCRATIC)}
    free = {c.id for c in competencies_for_format(DebateFormat.FREE)}
    assert "debate.substance.engagement" in free
    assert "debate.substance.engagement" not in socratic


def test_unknown_enum_values_fall_back_rather_than_raising() -> None:
    assert parse_format("nonsense") is DebateFormat.FREE
    assert parse_focus(None) is Focus.NONE


def test_the_evaluator_reads_the_state_the_gateway_stored() -> None:
    state = DebateState(turn=3)
    _claim(state, "Regulation protects consumers")
    session = {
        "context": {"format": DebateFormat.SOCRATIC.value},
        "moduleState": {"debate": state.to_doc()},
    }
    assert format_of(session) is DebateFormat.SOCRATIC
    assert len(debate_state_of(session).side_arguments(Side.USER)) == 1
    # A session with no state at all still yields an empty debate rather than failing.
    assert debate_state_of({}).turn == 0
