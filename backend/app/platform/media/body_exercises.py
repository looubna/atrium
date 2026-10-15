"""One research-based exercise for each body-language check (`app/platform/media/body.py`).

Fixed text, picked by code, never written by a model: a finding always comes with the same
exercise, and the exercise says what its evidence does and does not cover.

Most exercises follow habit reversal: awareness training (learn to notice the habit, here by
watching the flagged moments of your own recording) and a competing response (a position that
cannot happen at the same time as the habit, held briefly when you notice the urge). It is well
established for physical nervous habits (Azrin & Nunn, 1973) and has been tested in public speaking
on verbal habits such as fillers (Mancuso & Miltenberger, 2016; Spieler & Miltenberger, 2017).
Applying it to posture, sway or repeated gestures is an extension of that evidence, and the
exercises say so. The gaze and gesture exercises rest on studies of gaze and gesture themselves.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Source:
    citation: str
    url: str


@dataclass(frozen=True)
class Exercise:
    id: str
    title: str
    steps: tuple[str, ...]
    why: str
    #: What the research behind the exercise does and does not show, in one or two plain sentences.
    evidence: str
    sources: tuple[Source, ...]

    def to_dict(self) -> dict[str, object]:
        return {
            "id": self.id, "title": self.title, "steps": list(self.steps), "why": self.why,
            "evidence": self.evidence, "sources": [{"citation": s.citation, "url": s.url} for s in self.sources],
        }


AZRIN_NUNN = Source(
    "Azrin & Nunn (1973). Habit reversal: a method of eliminating nervous habits and tics. "
    "Behaviour Research and Therapy, 11, 619-628.",
    "https://doi.org/10.1016/0005-7967(73)90119-8",
)
MANCUSO_MILTENBERGER = Source(
    "Mancuso & Miltenberger (2016). Using habit reversal to decrease filled pauses in public speaking. "
    "Journal of Applied Behavior Analysis, 49(1), 188-192.",
    "https://doi.org/10.1002/jaba.267",
)
SPIELER_MILTENBERGER = Source(
    "Spieler & Miltenberger (2017). Using awareness training to decrease nervous habits during public "
    "speaking. Journal of Applied Behavior Analysis, 50(1), 38-47.",
    "https://doi.org/10.1002/jaba.362",
)
HOSTETTER = Source(
    "Hostetter (2011). When do gestures communicate? A meta-analysis. Psychological Bulletin, 137(2), 297-315.",
    "https://doi.org/10.1037/a0022128",
)
RAUSCHER = Source(
    "Rauscher, Krauss & Chen (1996). Gesture, speech, and lexical access. Psychological Science, 7(4), 226-231.",
    "https://doi.org/10.1111/j.1467-9280.1996.tb00364.x",
)
GLENBERG = Source(
    "Glenberg, Schroeder & Robertson (1998). Averting the gaze disengages the environment and facilitates "
    "remembering. Memory & Cognition, 26(4), 651-658.",
    "https://doi.org/10.3758/BF03211385",
)
DOHERTY_SNEDDON = Source(
    "Doherty-Sneddon & Phelps (2005). Gaze aversion: a response to cognitive or social difficulty? "
    "Memory & Cognition, 33(4), 727-733.",
    "https://doi.org/10.3758/BF03195338",
)
BOHANNON = Source(
    "Bohannon, Herbert, Pelz & Rantanen (2013). Eye contact and video-mediated communication: a review. "
    "Displays, 34(2), 177-185.",
    "https://doi.org/10.1016/j.displa.2012.10.009",
)

HABIT_REVERSAL_EVIDENCE = (
    "Habit reversal (noticing the habit, then switching to a position it can't happen in) reliably reduces "
    "physical nervous habits, and has reduced speaking habits like fillers in small studies of students. "
    "It has not yet been tested on this exact movement in speakers."
)
HABIT_REVERSAL = (AZRIN_NUNN, MANCUSO_MILTENBERGER, SPIELER_MILTENBERGER)

EXERCISES: dict[str, Exercise] = {
    exercise.id: exercise
    for exercise in (
        Exercise(
            id="level-shoulders",
            title="Notice the tilt, then square your base",
            steps=(
                "Watch each marked moment of your recording and note what you were doing as the tilt began "
                "(leaning on one arm, shifting your weight, reaching for notes).",
                "Choose your counter-position: both feet flat, weight even on both sides of the chair, forearms "
                "resting evenly. You can't lean onto one side while holding it.",
                "Practise one answer: whenever you feel yourself start to lean, move into the counter-position "
                "and hold it for about a minute.",
                "Record one more answer and check the marked moments again.",
            ),
            why="A tilt held for a long stretch shows clearly on camera. Noticing when it starts is what lets "
            "you change it.",
            evidence=HABIT_REVERSAL_EVIDENCE,
            sources=HABIT_REVERSAL,
        ),
        Exercise(
            id="square-to-camera",
            title="Notice the turn, then face the lens",
            steps=(
                "Watch the marked moments and note what drew you sideways (a second screen, notes, a window).",
                "Move whatever drew you sideways next to the camera, and turn your chair so your chest faces the "
                "lens.",
                "Practise one answer: each time you notice yourself turning, bring your shoulders back square "
                "to the camera.",
                "Record one more answer and compare the marked moments.",
            ),
            why="On a video call the camera stands in for the other person's eyes. Facing it is facing them.",
            evidence=HABIT_REVERSAL_EVIDENCE + " Research on video calls shows that where the camera sits shapes "
            "the eye contact the other person sees.",
            sources=(*HABIT_REVERSAL, BOHANNON),
        ),
        Exercise(
            id="notes-at-eye-level",
            title="Notice when your head drops, then raise what you read",
            steps=(
                "Watch the marked moments: were you reading notes, looking at the desk, or sinking into the chair?",
                "If it was notes, put them right next to the camera. If you were sinking, sit back with your "
                "head above your shoulders.",
                "Practise one answer: when you feel your chin drop, lift your eyes to the lens before you go on.",
                "Record one more answer and check the marked moments again.",
            ),
            why="Reading from the desk keeps the head low for long stretches. Notes next to the camera remove "
            "the reason.",
            evidence=HABIT_REVERSAL_EVIDENCE,
            sources=HABIT_REVERSAL,
        ),
        Exercise(
            id="gesture-on-key-points",
            title="Swap the repeated move for gestures that show something",
            steps=(
                "Watch the marked moments and spot the movement you repeat (the same chop, the same circle).",
                "Keep gesturing: don't hold your hands still. Do pick two or three key points in your answer and "
                "plan a gesture for each one that shows the idea (a size, a direction, a sequence).",
                "Between key points, rest your hands in your lap or on the desk.",
                "Record one answer and check whether the repeated movement has turned into gestures that show "
                "something.",
            ),
            why="Gestures help listeners most when they add something your words don't say, such as an "
            "action, a shape or a direction. The same motion on every sentence adds nothing. Holding your hands "
            "still on purpose can make speech about space and movement less fluent.",
            evidence="A meta-analysis found gestures moderately help listeners understand, most of all when they "
            "show actions or add information beyond the words. When speakers were prevented from gesturing, "
            "their speech about spatial content became less fluent.",
            sources=(HOSTETTER, RAUSCHER),
        ),
        Exercise(
            id="still-while-listening",
            title="Quiet hands while you listen",
            steps=(
                "Watch the marked moments, when your hands moved while the other person was talking, and note "
                "what they were doing.",
                "Choose your listening position: hands resting together on the desk or in your lap.",
                "Practise one exchange: while the other person speaks, keep your hands in that position and "
                "show you're following with a nod. Let your hands move again when you start to answer.",
            ),
            why="Movement while someone else is talking pulls the eye away from them. While you speak, gestures "
            "support what you say.",
            evidence=HABIT_REVERSAL_EVIDENCE,
            sources=HABIT_REVERSAL,
        ),
        Exercise(
            id="lens-on-the-point",
            title="Look away to think, look back to deliver",
            steps=(
                "Looking away while you work out an answer is normal and helps you think, so let your eyes go "
                "while you gather the answer.",
                "As you start the main point, bring your eyes back to the lens. On a video call that's what reads "
                "as eye contact, not the face on the screen.",
                "Finish your last sentence looking at the lens, then pause.",
                "Watch the marked moments: did you look away while thinking (fine), or while explaining "
                "(the habit to change)?",
            ),
            why="Looking away is a normal way to think. Long stretches looking away while you explain are what "
            "the other person notices.",
            evidence="Looking away while thinking helped adults answer hard questions, and children looked away "
            "most when questions were hardest. On a video call the camera sits above the screen, so looking "
            "at the screen doesn't look like eye contact to the other person.",
            sources=(GLENBERG, DOHERTY_SNEDDON, BOHANNON),
        ),
        Exercise(
            id="anchor-your-stance",
            title="Notice the sway, then plant your feet",
            steps=(
                "Watch the marked moments and feel where the sway comes from (shifting your weight from foot to "
                "foot, or rocking in the chair).",
                "Choose your counter-position: feet hip-width apart with your weight even on both. Seated, both "
                "feet flat and your back against the chair. You can't rock side to side while holding it.",
                "Practise one answer: whenever you notice the first shift, settle back into the counter-position "
                "and hold it for about a minute.",
                "Move only on purpose: one step toward a new point, then plant your feet again.",
            ),
            why="A steady side-to-side rhythm shows easily on camera and pulls attention from your words. "
            "Deliberate moves don't.",
            evidence=HABIT_REVERSAL_EVIDENCE,
            sources=HABIT_REVERSAL,
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
