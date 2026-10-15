"""One practice exercise for each body-language check (`app/platform/media/body.py`).

Fixed text, picked by code, never written by a model: a finding always comes with the same,
reviewed exercise. The wording is a draft for review before any of it is shown to users.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Exercise:
    id: str
    title: str
    steps: tuple[str, ...]
    why: str


EXERCISES: dict[str, Exercise] = {
    exercise.id: exercise
    for exercise in (
        Exercise(
            id="level-shoulders",
            title="Level shoulders, both feet down",
            steps=(
                "Sit with both feet flat and your weight even on both sides of the chair.",
                "Let both shoulders drop, then check the camera preview: the line between them should be level.",
                "Answer one question while keeping that line level; look at the preview again at the end.",
            ),
            why="A tilt held for a long stretch is visible on camera; an even base makes it easier to stay level "
            "without thinking about it.",
        ),
        Exercise(
            id="square-to-camera",
            title="Square up to the camera",
            steps=(
                "Turn your chair so your chest and the camera face each other.",
                "Put the camera at eye level, about an arm's length away.",
                "Answer one question; if you turn to think, turn back as you start the main point.",
            ),
            why="On a call, the camera is the other person: facing it keeps you facing them.",
        ),
        Exercise(
            id="notes-at-eye-level",
            title="Notes up, head up",
            steps=(
                "Put any notes or a second screen right next to the camera, not on the desk.",
                "Sit back against the chair so your head sits above your shoulders.",
                "Answer one question and glance at the notes only between sentences.",
            ),
            why="Looking down at the desk lowers the head for long stretches; notes at camera height avoid it.",
        ),
        Exercise(
            id="gesture-on-key-points",
            title="Gesture on the key points",
            steps=(
                "Pick the two or three words that carry your answer.",
                "Rest your hands between points, in your lap or on the desk.",
                "Make one gesture that shows the idea (a size, a direction, a sequence) on each key word, then rest.",
            ),
            why="Gestures that show something help listeners understand; the same movement on every sentence "
            "stops carrying meaning.",
        ),
        Exercise(
            id="still-while-listening",
            title="Still hands while you listen",
            steps=(
                "While the other person speaks, rest your hands together on the desk or in your lap.",
                "Show that you are following with a nod instead.",
                "Let your hands move again once you start to answer.",
            ),
            why="Movement while someone else is talking draws the eye away from them; while you speak, "
            "gestures support what you say.",
        ),
        Exercise(
            id="lens-on-the-point",
            title="Eyes on the lens for the point",
            steps=(
                "Looking away to think is normal: let your eyes go while you gather the answer.",
                "As you start the main point, bring your eyes back to the lens.",
                "Finish your last sentence looking at the lens, then pause.",
            ),
            why="Glancing away while thinking is common and helps concentration; long stretches looking away while "
            "explaining are what the other person notices.",
        ),
        Exercise(
            id="anchor-your-stance",
            title="Anchor your stance",
            steps=(
                "Stand or sit with your weight even on both feet, hip-width apart.",
                "Say one sentence and stay still on purpose; notice the urge to shift and let it pass.",
                "Move only when you mean to: a step toward a new point, then plant your feet again.",
            ),
            why="A steady side-to-side rhythm is easy to see on camera and pulls attention from your words; "
            "deliberate moves do not.",
        ),
    )
}

#: The exercise for each check.
EXERCISE_FOR_CHECK: dict[str, str] = {
    "posture_tilt": "level-shoulders",
    "turned_away": "square-to-camera",
    "head_lower": "notes-at-eye-level",
    "repeated_gesture": "gesture-on-key-points",
    "gesture_timing": "still-while-listening",
    "look_away": "lens-on-the-point",
    "sway": "anchor-your-stance",
}
