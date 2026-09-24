from __future__ import annotations

from app.modules.interview.livetalking import face_for

FACES = "william=william, gabriel=william ,pablo=william"


def test_a_person_plays_the_recording_mapped_to_them() -> None:
    assert face_for("william", FACES, "evelyn") == "william"
    # One recorded professor stands in for another until he is recorded himself.
    assert face_for("gabriel", FACES, "evelyn") == "william"


def test_anyone_else_gets_the_stand_in() -> None:
    assert face_for("mia", FACES, "evelyn") == "evelyn"


def test_without_a_stand_in_a_person_plays_their_own_recording() -> None:
    assert face_for("cara", "", "") == "cara"
    assert face_for("cara", "broken,=x,y=", " ") == "cara"
