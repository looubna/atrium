"""Each round speaks with the voice of the interviewer the app shows for it."""

from __future__ import annotations

from app.modules.interview.catalogs import RoundType
from app.modules.interview.interviewers import (
    DEFAULT_VOICE,
    INTERVIEWERS,
    VOICES,
    interviewer_for,
    voice_for,
)

# Mirrors FEMALE_VOICES / MALE_VOICES in src/data/interviewers.ts.
FEMALE_VOICES = {"Leda", "Gacrux", "Erinome", "Kore", "Aoede", "Achernar", "Zephyr", "Vindemiatrix"}
MALE_VOICES = {"Charon", "Iapetus", "Puck", "Alnilam", "Sadaltager", "Schedar", "Orus", "Rasalgethi"}

# The face each round shows, from src/data/interviewers.ts.
FACE_GENDER = {
    RoundType.SCREENING: "female",
    RoundType.BEHAVIORAL: "female",
    RoundType.TECHNICAL: "male",
    RoundType.CODING: "male",
    RoundType.SYSTEM_DESIGN: "male",
    RoundType.CASE: "female",
    RoundType.HIRING_MANAGER: "male",
    RoundType.PRESENTATION: "male",
    RoundType.TAKE_HOME_REVIEW: "male",
    RoundType.OTHER: "female",
}


def test_every_round_type_has_an_interviewer_and_a_voice() -> None:
    assert set(VOICES) == set(RoundType)
    assert set(INTERVIEWERS) == set(RoundType)
    for round_type, person in INTERVIEWERS.items():
        assert person.name and person.role, round_type
        assert person.voice, round_type


def test_a_loop_meets_a_different_person_at_each_stage() -> None:
    loop = [RoundType.SCREENING, RoundType.TECHNICAL, RoundType.SYSTEM_DESIGN, RoundType.HIRING_MANAGER]
    assert len({INTERVIEWERS[r].name for r in loop}) == len(loop)
    # Voice is all the candidate has to tell them apart, so it must differ too.
    assert len({INTERVIEWERS[r].voice for r in loop}) == len(loop)


def test_interviewer_lookup_accepts_stored_strings_and_unknown_values() -> None:
    assert interviewer_for("hiring_manager").name == "Richard Hale"
    assert interviewer_for("not_a_round") is interviewer_for(None)


def test_voice_never_contradicts_the_face() -> None:
    for round_type, gender in FACE_GENDER.items():
        expected = FEMALE_VOICES if gender == "female" else MALE_VOICES
        assert VOICES[round_type] in expected, f"{round_type}: {VOICES[round_type]} does not read {gender}"


def test_a_loop_does_not_reuse_one_voice_throughout() -> None:
    loop = [RoundType.SCREENING, RoundType.TECHNICAL, RoundType.SYSTEM_DESIGN, RoundType.HIRING_MANAGER]
    assert len({VOICES[r] for r in loop}) == len(loop)


def test_unknown_round_falls_back_instead_of_going_silent() -> None:
    assert voice_for(RoundType.SCREENING) == "Leda"
    assert DEFAULT_VOICE in FEMALE_VOICES | MALE_VOICES
