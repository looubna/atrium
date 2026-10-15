"""The Practice Center's rules: which skills each drill trains, what a round measures,
which results count as personal bests, and the three challenge levels per drill.

This is the single source of truth. The app shows what the progress endpoint sends,
so adding a drill, a skill or a level happens here.

Every number is labelled by its source. `measured` values come from the audio and word
timings (or the on-device camera); `ai` values are a model's rating and are shown as such.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Literal

Values = Mapping[str, float | None]
Source = Literal["measured", "ai"]
Better = Literal["higher", "lower"]

SKILLS: dict[str, str] = {
    "spontaneity": "Spontaneity",
    "structure": "Structure",
    "clarity": "Clarity",
    "composure": "Composure",
    "pace": "Pace",
    "voice": "Voice",
    "presence": "Presence",
    "conciseness": "Conciseness",
    "storytelling": "Storytelling",
}


@dataclass(frozen=True)
class MetricDef:
    key: str
    label: str
    unit: str
    better: Better
    source: Source = "measured"
    #: Range a gauge spans, and the value that counts as good (for drawing only).
    scale: tuple[float, float] = (0, 100)
    goal: float | None = None
    #: A comfortable range instead of a one-sided goal (speaking rate).
    band: tuple[float, float] | None = None


@dataclass(frozen=True)
class Challenge:
    level: int
    label: str
    check: Callable[[Values], bool]
    #: Rounds in a row that must pass: higher levels ask for consistency, not one lucky round.
    repeat: int = 1


@dataclass(frozen=True)
class DrillDef:
    id: str
    title: str
    skills: tuple[str, ...]
    #: Shown after a round, in this order.
    metrics: tuple[MetricDef, ...]
    #: Metric keys that count as personal bests.
    bests: tuple[str, ...]
    challenges: tuple[Challenge, ...]
    #: What the AI coach rates for this drill (keys of `AI_RATINGS`), and what it looks for.
    ai_ratings: tuple[str, ...] = ()
    rubric: str = ""
    #: Speech needed for a round to count toward bests, challenges and the streak.
    min_speech_ms: int = 20_000
    #: The coach also copies the story's hook and reveal lines, which are then timed (story.py).
    quotes: bool = False


def _get(values: Values, key: str) -> float | None:
    value = values.get(key)
    return None if value is None else float(value)


def need(**bounds: tuple[float | None, float | None]) -> Callable[[Values], bool]:
    """Every named value within its (min, max); a missing value fails."""

    def check(values: Values) -> bool:
        for key, (low, high) in bounds.items():
            value = _get(values, key)
            if value is None or (low is not None and value < low) or (high is not None and value > high):
                return False
        return True

    return check


# Metrics, shared across drills.
FILLERS = MetricDef("fillers", "Filler words", "", "lower", scale=(0, 10), goal=2)
WPM = MetricDef("wpm", "Speaking rate", "wpm", "higher", scale=(80, 220), band=(130, 160))
SPEAKING = MetricDef("speakingSeconds", "Speaking time", "s", "higher", scale=(0, 120), goal=45)
RESPONSE = MetricDef("responseSeconds", "Time to first word", "s", "lower", scale=(0, 20), goal=10)
CLEAN_PAUSE = MetricDef("cleanPauseSeconds", "Longest clean pause", "s", "higher", scale=(0, 4), goal=1.5)
PACE_GAP = MetricDef("paceGap", "Distance from 130-160 wpm", "wpm", "lower", scale=(0, 60), goal=0)
PACE_SPREAD = MetricDef("paceSpread", "Pace variation", "wpm", "lower", scale=(0, 40), goal=15)
READING = MetricDef("readingSeconds", "Reading time", "s", "lower", scale=(0, 120))
DICTION = MetricDef("dictionAccuracy", "Words recognised", "%", "higher", scale=(50, 100), goal=92)
PITCH = MetricDef("pitchSemitones", "Pitch movement", "semitones", "higher", scale=(0, 6), goal=3)
END_DROP = MetricDef("endDropDb", "Drop at sentence ends", "dB", "lower", scale=(0, 12), goal=4)
EYE = MetricDef("eyeContactPct", "Looking at the lens", "%", "higher", goal=65)
WORDS_USED = MetricDef("wordsUsed", "Story words used", "of 3", "higher", scale=(0, 3), goal=3)
BALANCE = MetricDef("sideBalance", "Balance between sides", "%", "higher", goal=75)
STRUCTURE = MetricDef("structure", "Structure", "/5", "higher", "ai", scale=(0, 5), goal=4)
CLARITY = MetricDef("clarity", "Clarity", "/5", "higher", "ai", scale=(0, 5), goal=4)
CONCISENESS = MetricDef("conciseness", "Conciseness", "/5", "higher", "ai", scale=(0, 5), goal=4)
DETAIL = MetricDef("detail", "Vivid detail", "/5", "higher", "ai", scale=(0, 5), goal=4)
FACTS = MetricDef("factsRecalled", "Facts recalled", "%", "higher", "ai", goal=70)
STEPS = MetricDef("stepsCovered", "Framework steps covered", "%", "higher", "ai", goal=100)
BOTH = MetricDef("bothSides", "Both sides argued", "", "higher", "ai", scale=(0, 1), goal=1)
# The Story Course (Park → Storytelling): counted from the words (story.py) or rated by the coach.
NARRATIVE_INDEX = MetricDef("narrativeIndex", "Narrative Index (buts per and)", "", "higher", scale=(0, 60), goal=20)
STAGING_EARLY = MetricDef("stagingEarly", "Scene set up front", "x", "higher", scale=(0, 2), goal=1.2)
HOOK_SECONDS = MetricDef("hookSeconds", "Question opened at", "s", "lower", scale=(0, 30), goal=10)
REVEAL_AT = MetricDef("revealAt", "Answer revealed at", "%", "higher", goal=70)
TENSION_PEAK = MetricDef("tensionPeakAt", "Tension peaks at", "%", "higher", goal=60)
PAUSE_REVEAL = MetricDef("pauseBeforeReveal", "Pause before the reveal", "s", "higher", scale=(0, 3), goal=0.8)
IMPROVEMENT = MetricDef("improvement", "Better than last telling", "pts", "higher", scale=(-2, 2), goal=0.5)
SPINE = MetricDef("spine", "Story spine", "/5", "higher", "ai", scale=(0, 5), goal=4)
ORIENTATION = MetricDef("orientation", "Scene and character", "/5", "higher", "ai", scale=(0, 5), goal=4)
HOOK = MetricDef("hook", "Curiosity hook", "/5", "higher", "ai", scale=(0, 5), goal=4)
TENSION = MetricDef("tension", "Rising tension", "/5", "higher", "ai", scale=(0, 5), goal=4)
MEANING = MetricDef("meaning", "Meaning", "/5", "higher", "ai", scale=(0, 5), goal=4)
DIALOGUE = MetricDef("dialogue", "Dialogue used", "", "higher", "ai", scale=(0, 1), goal=1)
CALLBACK = MetricDef("callback", "Ending calls back", "", "higher", "ai", scale=(0, 1), goal=1)
STORY = MetricDef("story", "Story overall", "/5", "higher", "ai", scale=(0, 5), goal=4)

#: What the AI coach may rate, with the question it answers.
AI_RATINGS: dict[str, str] = {
    "structure": "1-5: does the answer have a clear shape (point, support, conclusion)?",
    "clarity": "1-5: would a listener understand it on first hearing, without jargon?",
    "conciseness": "1-5: does it say what is needed without padding or rambling?",
    "detail": "1-5: could someone who cannot see the scene picture it (layout, people, mood)?",
    "factsRecalled": "0-100: share of the passage's key facts (who, what, where, when, why, outcome) retold correctly",
    "stepsCovered": "0-100: share of the framework's steps the answer clearly covered, in order",
    "bothSides": "0 or 1: did the speaker argue both for and against, each with a real argument?",
    "spine": "1-5: does the story move on And-But-Therefore (a situation, BUT a problem, THEREFORE what happened), "
    "not And-And-And?",
    "orientation": "1-5: in the first seconds, do we know who, where, when, and what the main character wants?",
    "hook": "1-5: does it open a question or mystery early that makes the listener need to know how it ends?",
    "tension": "1-5: does an obstacle escalate, with stakes rising towards a climax, rather than events of "
    "equal weight?",
    "meaning": "1-5: after the resolution, does the speaker say what it meant (what changed, what they learned)?",
    "dialogue": "0 or 1: does the story include at least one line of what someone said, in their words?",
    "callback": "0 or 1: does the ending return to the opening (its image, question or words)?",
    "story": "1-5: overall, would a listener want to hear this story to the end and remember it tomorrow?",
}


def ch(level: int, label: str, repeat: int = 1, **bounds: tuple[float | None, float | None]) -> Challenge:
    return Challenge(level, label, need(**bounds), repeat)


# Challenges combine the skill with the quality of the answer, and the higher levels
# must be passed on consecutive rounds. None of them comes from simply finishing a round.
DRILLS: dict[str, DrillDef] = {
    d.id: d
    for d in [
        DrillDef(
            "think-on-your-feet",
            "Think on Your Feet",
            ("spontaneity", "composure", "structure"),
            (RESPONSE, FILLERS, STRUCTURE, WPM),
            ("responseSeconds", "fillers", "structure"),
            (
                ch(
                    1,
                    "Start within 12 s, structure 4/5+, at most 2 fillers, 30 s+ of speech",
                    responseSeconds=(None, 12),
                    structure=(4, None),
                    fillers=(None, 2),
                    speakingSeconds=(30, None),
                ),
                ch(
                    2,
                    "Start within 8 s, structure 4/5+, at most 1 filler, 40 s+ · 2 rounds in a row",
                    2,
                    responseSeconds=(None, 8),
                    structure=(4, None),
                    fillers=(None, 1),
                    speakingSeconds=(40, None),
                ),
                ch(
                    3,
                    "Start within 5 s, structure 5/5, no fillers, 45 s+ · 3 rounds in a row",
                    3,
                    responseSeconds=(None, 5),
                    structure=(5, None),
                    fillers=(None, 0),
                    speakingSeconds=(45, None),
                ),
            ),
            ("structure", "clarity"),
            "A strong answer leads with a one-sentence answer, backs it with a reason and an example, "
            "and comes back to the answer at the end.",
            min_speech_ms=10_000,
        ),
        DrillDef(
            "pause-dont-fill",
            "Pause, Don't Fill",
            ("composure", "voice", "spontaneity"),
            (FILLERS, CLEAN_PAUSE, SPEAKING, CLARITY),
            ("fillers", "cleanPauseSeconds"),
            (
                ch(
                    1,
                    "45 s+, at most 2 fillers, at least one deliberate 1 s pause",
                    speakingSeconds=(45, None),
                    fillers=(None, 2),
                    cleanPauseSeconds=(1, None),
                ),
                ch(
                    2,
                    "50 s+, at most 1 filler, a deliberate pause, clarity 4/5+ · 2 rounds in a row",
                    2,
                    speakingSeconds=(50, None),
                    fillers=(None, 1),
                    cleanPauseSeconds=(1, None),
                    clarity=(4, None),
                ),
                ch(
                    3,
                    "55 s+, no fillers, a deliberate pause, clarity 4/5+ · 3 rounds in a row",
                    3,
                    speakingSeconds=(55, None),
                    fillers=(None, 0),
                    cleanPauseSeconds=(1, None),
                    clarity=(4, None),
                ),
            ),
            ("clarity",),
            "The speaker answers an interview question, replacing fillers with silent pauses while still "
            "answering clearly.",
        ),
        DrillDef(
            "pace-control",
            "Pace Control",
            ("pace", "voice"),
            (READING, WPM, PACE_GAP, PACE_SPREAD),
            ("paceGap", "paceSpread"),
            (
                ch(1, "130-160 wpm, pace varying by 20 wpm or less", paceGap=(None, 0), paceSpread=(None, 20)),
                ch(
                    2,
                    "130-160 wpm, varying by 12 wpm or less · 2 rounds in a row",
                    2,
                    paceGap=(None, 0),
                    paceSpread=(None, 12),
                ),
                ch(
                    3,
                    "140-150 wpm, varying by 8 wpm or less · 3 rounds in a row",
                    3,
                    wpm=(140, 150),
                    paceSpread=(None, 8),
                ),
            ),
            (),
            "The speaker reads a passage aloud at a comfortable, steady interview pace.",
        ),
        DrillDef(
            "clear-diction",
            "Clear Diction",
            ("clarity", "voice"),
            (DICTION, WPM),
            ("dictionAccuracy",),
            (
                ch(
                    1,
                    "92% of the passage's words recognised, at 110 wpm or faster",
                    dictionAccuracy=(92, None),
                    wpm=(110, None),
                ),
                ch(
                    2,
                    "96% recognised, at 120 wpm or faster · 2 rounds in a row",
                    2,
                    dictionAccuracy=(96, None),
                    wpm=(120, None),
                ),
                ch(
                    3,
                    "98% recognised, at 130 wpm or faster · 3 rounds in a row",
                    3,
                    dictionAccuracy=(98, None),
                    wpm=(130, None),
                ),
            ),
            (),
            "The speaker reads a passage twice, over-articulated then natural; clear speech is recognised "
            "word for word.",
        ),
        DrillDef(
            "emphasis-and-melody",
            "Emphasis & Melody",
            ("voice", "presence"),
            (PITCH, WPM, FILLERS),
            ("pitchSemitones",),
            (
                ch(
                    1,
                    "Pitch moving by 3 semitones or more, at most 1 filler",
                    pitchSemitones=(3, None),
                    fillers=(None, 1),
                ),
                ch(
                    2,
                    "3.5 semitones or more, 110-170 wpm · 2 rounds in a row",
                    2,
                    pitchSemitones=(3.5, None),
                    wpm=(110, 170),
                    fillers=(None, 1),
                ),
                ch(
                    3,
                    "4 semitones or more, 120-160 wpm, no fillers · 3 rounds in a row",
                    3,
                    pitchSemitones=(4, None),
                    wpm=(120, 160),
                    fillers=(None, 0),
                ),
            ),
            (),
            "The speaker stresses the highlighted key words with pitch, pace and pauses, never on one note.",
        ),
        DrillDef(
            "project-to-the-end",
            "Project to the End",
            ("voice", "presence"),
            (END_DROP, SPEAKING, FILLERS),
            ("endDropDb",),
            (
                ch(1, "Sentence ends at most 4 dB quieter, 40 s+", endDropDb=(None, 4), speakingSeconds=(40, None)),
                ch(
                    2,
                    "At most 3 dB quieter, 45 s+, at most 1 filler · 2 rounds in a row",
                    2,
                    endDropDb=(None, 3),
                    speakingSeconds=(45, None),
                    fillers=(None, 1),
                ),
                ch(
                    3,
                    "At most 2 dB quieter, 50 s+, no fillers · 3 rounds in a row",
                    3,
                    endDropDb=(None, 2),
                    speakingSeconds=(50, None),
                    fillers=(None, 0),
                ),
            ),
            (),
            "The speaker keeps the voice strong through the last word of every sentence.",
        ),
        DrillDef(
            "speak-to-the-lens",
            "Speak to the Lens",
            ("presence", "composure"),
            (EYE, FILLERS, STRUCTURE),
            ("eyeContactPct",),
            (
                ch(
                    1,
                    "Look at the lens 65% of the time, structure 3/5+, 40 s+",
                    eyeContactPct=(65, None),
                    structure=(3, None),
                    speakingSeconds=(40, None),
                ),
                ch(
                    2,
                    "75% at the lens, structure 4/5+ · 2 rounds in a row",
                    2,
                    eyeContactPct=(75, None),
                    structure=(4, None),
                    speakingSeconds=(40, None),
                ),
                ch(
                    3,
                    "85% at the lens, structure 4/5+, at most 1 filler · 3 rounds in a row",
                    3,
                    eyeContactPct=(85, None),
                    structure=(4, None),
                    fillers=(None, 1),
                    speakingSeconds=(45, None),
                ),
            ),
            ("structure",),
            "The speaker answers an interview question to camera, clearly and warmly.",
        ),
        DrillDef(
            "recall-and-retell",
            "Recall & Retell",
            ("structure", "clarity"),
            (FACTS, FILLERS, SPEAKING),
            ("factsRecalled",),
            (
                ch(
                    1,
                    "Retell 70% of the key facts, in order (structure 3/5+)",
                    factsRecalled=(70, None),
                    structure=(3, None),
                ),
                ch(
                    2,
                    "85% of the facts, at most 2 fillers · 2 rounds in a row",
                    2,
                    factsRecalled=(85, None),
                    structure=(3, None),
                    fillers=(None, 2),
                ),
                ch(
                    3,
                    "95% of the facts, structure 4/5+, at most 1 filler · 3 rounds in a row",
                    3,
                    factsRecalled=(95, None),
                    structure=(4, None),
                    fillers=(None, 1),
                ),
            ),
            ("factsRecalled", "structure"),
            "The speaker retells the passage from memory, in order and in their own words.",
        ),
        DrillDef(
            "random-word-story",
            "Random Word Story",
            ("spontaneity", "structure"),
            (WORDS_USED, SPEAKING, FILLERS, STRUCTURE),
            ("fillers", "structure"),
            (
                ch(
                    1,
                    "All 3 words in a 60 s+ story with a clear arc (structure 4/5+), at most 2 fillers",
                    wordsUsed=(3, None),
                    speakingSeconds=(60, None),
                    structure=(4, None),
                    fillers=(None, 2),
                ),
                ch(
                    2,
                    "All 3 words, 75 s+, structure 4/5+, at most 1 filler · 2 rounds in a row",
                    2,
                    wordsUsed=(3, None),
                    speakingSeconds=(75, None),
                    structure=(4, None),
                    fillers=(None, 1),
                ),
                ch(
                    3,
                    "All 3 words, 85 s+, structure 5/5, no fillers · 3 rounds in a row",
                    3,
                    wordsUsed=(3, None),
                    speakingSeconds=(85, None),
                    structure=(5, None),
                    fillers=(None, 0),
                ),
            ),
            ("structure",),
            "The story should have a beginning, a turn and an ending, and use all three words naturally.",
        ),
        DrillDef(
            "framework-challenge",
            "Framework Challenge",
            ("structure", "conciseness"),
            (STEPS, STRUCTURE, FILLERS),
            ("stepsCovered", "fillers"),
            (
                ch(
                    1,
                    "Every step covered, structure 4/5+, at most 2 fillers",
                    stepsCovered=(100, None),
                    structure=(4, None),
                    fillers=(None, 2),
                ),
                ch(
                    2,
                    "Every step, structure 4/5+, at most 1 filler, 60 s+ · 2 rounds in a row",
                    2,
                    stepsCovered=(100, None),
                    structure=(4, None),
                    fillers=(None, 1),
                    speakingSeconds=(60, None),
                ),
                ch(
                    3,
                    "Every step, structure 5/5, no fillers · 3 rounds in a row",
                    3,
                    stepsCovered=(100, None),
                    structure=(5, None),
                    fillers=(None, 0),
                ),
            ),
            ("stepsCovered", "structure"),
            "The answer follows the given framework step by step, signposting each step.",
        ),
        DrillDef(
            "explain-it-simply",
            "Explain it Simply",
            ("clarity", "structure", "conciseness"),
            (CLARITY, CONCISENESS, WPM, FILLERS),
            ("clarity", "conciseness"),
            (
                ch(1, "Clarity 4/5+ and conciseness 4/5+", clarity=(4, None), conciseness=(4, None)),
                ch(
                    2,
                    "Clarity 5/5, conciseness 4/5+, at most 1 filler · 2 rounds in a row",
                    2,
                    clarity=(5, None),
                    conciseness=(4, None),
                    fillers=(None, 1),
                ),
                ch(
                    3,
                    "Clarity 5/5, conciseness 5/5, no fillers · 3 rounds in a row",
                    3,
                    clarity=(5, None),
                    conciseness=(5, None),
                    fillers=(None, 0),
                ),
            ),
            ("clarity", "conciseness", "structure"),
            "The explanation suits the named listener: no unexplained jargon, one everyday comparison, "
            "and why it matters to them.",
        ),
        DrillDef(
            "take-both-sides",
            "Take Both Sides",
            ("structure", "spontaneity", "composure"),
            (BOTH, BALANCE, STRUCTURE, FILLERS),
            ("sideBalance", "structure"),
            (
                ch(
                    1,
                    "Both sides argued, balance 70%+, structure 4/5+",
                    bothSides=(1, None),
                    sideBalance=(70, None),
                    structure=(4, None),
                ),
                ch(
                    2,
                    "Both sides, balance 80%+, structure 4/5+, at most 2 fillers · 2 rounds in a row",
                    2,
                    bothSides=(1, None),
                    sideBalance=(80, None),
                    structure=(4, None),
                    fillers=(None, 2),
                ),
                ch(
                    3,
                    "Both sides, balance 90%+, structure 5/5, at most 1 filler · 3 rounds in a row",
                    3,
                    bothSides=(1, None),
                    sideBalance=(90, None),
                    structure=(5, None),
                    fillers=(None, 1),
                ),
            ),
            ("bothSides", "structure"),
            "The speaker argues for the statement in the first half and against it in the second, each "
            "side with its strongest argument and an example.",
            min_speech_ms=40_000,
        ),
        DrillDef(
            "describe-the-image",
            "Describe the Image",
            ("clarity", "structure"),
            (DETAIL, STRUCTURE, FILLERS),
            ("detail", "structure"),
            (
                ch(
                    1,
                    "Vivid detail 4/5+, structure 4/5+, 45 s+",
                    detail=(4, None),
                    structure=(4, None),
                    speakingSeconds=(45, None),
                ),
                ch(
                    2,
                    "Detail 5/5, structure 4/5+, at most 2 fillers · 2 rounds in a row",
                    2,
                    detail=(5, None),
                    structure=(4, None),
                    fillers=(None, 2),
                    speakingSeconds=(45, None),
                ),
                ch(
                    3,
                    "Detail 5/5, structure 5/5, no fillers, 60 s+ · 3 rounds in a row",
                    3,
                    detail=(5, None),
                    structure=(5, None),
                    fillers=(None, 0),
                    speakingSeconds=(60, None),
                ),
            ),
            ("detail", "structure"),
            "The description goes from the big picture to details, guides the listener through space and "
            "says what people are doing and how it feels.",
        ),
    ]
}



def _story(
    id_: str,
    title: str,
    metrics: tuple[MetricDef, ...],
    bests: tuple[str, ...],
    challenges: tuple[Challenge, ...],
    ratings: tuple[str, ...],
    rubric: str,
    *,
    quotes: bool = False,
    min_speech_ms: int = 30_000,
) -> DrillDef:
    # Every story round also gets an overall rating: it is what "Tell It Again" improves on.
    return DrillDef(
        id_, title, ("storytelling",), metrics, bests, challenges, (*ratings, "story"), rubric, min_speech_ms, quotes
    )


#: The Story Course, in order: each step trains one evidence-based technique (lessons in src/data/drills.ts).
STORY_COURSE: tuple[DrillDef, ...] = (
    _story(
        "story-spine",
        "The Spine: And, But, Therefore",
        (NARRATIVE_INDEX, SPINE, SPEAKING, FILLERS),
        ("narrativeIndex", "spine"),
        (
            ch(1, "Spine 4/5+, Narrative Index 15+", spine=(4, None), narrativeIndex=(15, None)),
            ch(2, "Spine 4/5+, Narrative Index 20+, at most 2 fillers · 2 rounds in a row", 2,
               spine=(4, None), narrativeIndex=(20, None), fillers=(None, 2)),
            ch(3, "Spine 5/5, Narrative Index 25+, at most 1 filler · 3 rounds in a row", 3,
               spine=(5, None), narrativeIndex=(25, None), fillers=(None, 1)),
        ),
        ("spine",),
        "The whole story in about 30 seconds on Randy Olson's And-But-Therefore: a situation AND its context, BUT a "
        "problem or turn, THEREFORE what happened because of it. Not a list of events joined by 'and'.",
        min_speech_ms=20_000,
    ),
    _story(
        "story-orientation",
        "Set the Scene",
        (ORIENTATION, STAGING_EARLY, DETAIL, FILLERS),
        ("orientation", "stagingEarly"),
        (
            ch(1, "Scene and character 4/5+, scene set up front 1.1x+",
               orientation=(4, None), stagingEarly=(1.1, None)),
            ch(2, "Scene and character 4/5+, 1.2x+, vivid detail 4/5+ · 2 rounds in a row", 2,
               orientation=(4, None), stagingEarly=(1.2, None), detail=(4, None)),
            ch(3, "Scene and character 5/5, 1.3x+, at most 1 filler · 3 rounds in a row", 3,
               orientation=(5, None), stagingEarly=(1.3, None), fillers=(None, 1)),
        ),
        ("orientation", "detail"),
        "Labov's orientation: within the first 15 seconds the listener knows who, where and when, and what the main "
        "character wants, so they have someone to care about before anything happens.",
    ),
    _story(
        "story-curiosity",
        "The Curiosity Gap",
        (HOOK, HOOK_SECONDS, REVEAL_AT, FILLERS),
        ("hook", "hookSeconds"),
        (
            ch(1, "Hook 4/5+, question opened within 10 s, answered after 60% of the story",
               hook=(4, None), hookSeconds=(None, 10), revealAt=(60, None)),
            ch(2, "Hook 4/5+, within 8 s, answered after 70% · 2 rounds in a row", 2,
               hook=(4, None), hookSeconds=(None, 8), revealAt=(70, None)),
            ch(3, "Hook 5/5, within 6 s, answered after 75%, at most 1 filler · 3 rounds in a row", 3,
               hook=(5, None), hookSeconds=(None, 6), revealAt=(75, None), fillers=(None, 1)),
        ),
        ("hook",),
        "An information gap (Loewenstein): open a question in the first seconds that the listener needs answered, "
        "and hold the answer back until late in the story, so curiosity keeps them listening.",
        quotes=True,
    ),
    _story(
        "story-tension",
        "Rising Tension",
        (TENSION, TENSION_PEAK, STRUCTURE, FILLERS),
        ("tension",),
        (
            ch(1, "Rising tension 4/5+, tension peaking in the second half",
               tension=(4, None), tensionPeakAt=(50, None)),
            ch(2, "Rising tension 4/5+, peak at 70%+, structure 4/5+ · 2 rounds in a row", 2,
               tension=(4, None), tensionPeakAt=(70, None), structure=(4, None)),
            ch(3, "Rising tension 5/5, peak at 70%+, at most 1 filler · 3 rounds in a row", 3,
               tension=(5, None), tensionPeakAt=(70, None), fillers=(None, 1)),
        ),
        ("tension", "structure"),
        "Freytag's dramatic arc: a clear obstacle, then complications that raise the stakes step by step to a "
        "climax, not events of equal weight. Rising tension is what holds attention before the resolution.",
    ),
    _story(
        "story-vivid",
        "Make It Vivid",
        (DETAIL, DIALOGUE, STRUCTURE, FILLERS),
        ("detail",),
        (
            ch(1, "Vivid detail 4/5+ and one line of dialogue", detail=(4, None), dialogue=(1, None)),
            ch(2, "Detail 4/5+, dialogue, at most 2 fillers · 2 rounds in a row", 2,
               detail=(4, None), dialogue=(1, None), fillers=(None, 2)),
            ch(3, "Detail 5/5, dialogue, structure 4/5+ · 3 rounds in a row", 3,
               detail=(5, None), dialogue=(1, None), structure=(4, None)),
        ),
        ("detail", "dialogue", "structure"),
        "Narrative transportation (Green & Brock): concrete names, numbers, sounds, smells and at least one line of "
        "real dialogue, so the listener sees the scene instead of hearing a summary.",
    ),
    _story(
        "story-meaning",
        "Resolution and Meaning",
        (MEANING, CALLBACK, STRUCTURE, FILLERS),
        ("meaning",),
        (
            ch(1, "Meaning 4/5+, ending calls back to the opening", meaning=(4, None), callback=(1, None)),
            ch(2, "Meaning 4/5+, callback, structure 4/5+ · 2 rounds in a row", 2,
               meaning=(4, None), callback=(1, None), structure=(4, None)),
            ch(3, "Meaning 5/5, callback, at most 1 filler · 3 rounds in a row", 3,
               meaning=(5, None), callback=(1, None), fillers=(None, 1)),
        ),
        ("meaning", "callback", "structure"),
        "Labov's evaluation and coda: after how it ended, say in one sentence what it meant (what changed, what you "
        "learned), and close by returning to the opening image or question.",
        quotes=True,
    ),
    _story(
        "story-delivery",
        "Deliver the Reveal",
        (PAUSE_REVEAL, PACE_GAP, PITCH, FILLERS),
        ("pauseBeforeReveal", "fillers"),
        (
            ch(1, "A pause of 0.6 s+ before the reveal, at most 3 fillers, pace within 25 wpm of 130-160",
               pauseBeforeReveal=(0.6, None), fillers=(None, 3), paceGap=(None, 25)),
            ch(2, "Pause 0.8 s+, at most 2 fillers, within 15 wpm, pitch movement 2.5+ · 2 rounds in a row", 2,
               pauseBeforeReveal=(0.8, None), fillers=(None, 2), paceGap=(None, 15), pitchSemitones=(2.5, None)),
            ch(3, "Pause 1 s+, no fillers, within 10 wpm, pitch movement 3+ · 3 rounds in a row", 3,
               pauseBeforeReveal=(1.0, None), fillers=(None, 0), paceGap=(None, 10), pitchSemitones=(3, None)),
        ),
        (),
        "Delivery that keeps listener and speaker in sync (Stephens, Silbert & Hasson): a clear pause just before "
        "the reveal, a comfortable pace, a lively voice and no fillers.",
        quotes=True,
    ),
    _story(
        "story-retell",
        "Tell It Again",
        (IMPROVEMENT, STORY, HOOK, TENSION),
        ("improvement", "story"),
        (
            ch(1, "Half a point better overall than your last telling", improvement=(0.5, None)),
            ch(2, "A full point better, hook 4/5+ · 2 rounds in a row", 2, improvement=(1, None), hook=(4, None)),
            ch(3, "Story 5/5 overall, hook and tension 4/5+ · 3 rounds in a row", 3,
               story=(5, None), hook=(4, None), tension=(4, None)),
        ),
        ("hook", "tension", "meaning", "detail"),
        "Revision is how storytellers improve: the same story told again, using the last feedback, with a stronger "
        "hook, rising tension, vivid detail and a clear meaning.",
    ),
    _story(
        "story-signature",
        "Your Signature Story",
        (STORY, HOOK, TENSION, MEANING, DETAIL, HOOK_SECONDS, REVEAL_AT, PAUSE_REVEAL, FILLERS),
        ("story", "hook", "tension", "meaning"),
        (
            ch(1, "Hook, tension, meaning and detail all 4/5+, 90 s+",
               hook=(4, None), tension=(4, None), meaning=(4, None), detail=(4, None), speakingSeconds=(90, None)),
            ch(2, "All four 4/5+, question within 10 s, answered after 70%, at most 3 fillers · 2 rounds in a row", 2,
               hook=(4, None), tension=(4, None), meaning=(4, None), detail=(4, None),
               hookSeconds=(None, 10), revealAt=(70, None), fillers=(None, 3)),
            ch(3, "Story 5/5, all four 4/5+, a 0.8 s+ pause before the reveal · 3 rounds in a row", 3,
               story=(5, None), hook=(4, None), tension=(4, None), meaning=(4, None), detail=(4, None),
               pauseBeforeReveal=(0.8, None)),
        ),
        ("hook", "tension", "meaning", "detail"),
        "A 2-3 minute personal story using everything: an early question, a character who wants something, rising "
        "tension, vivid detail and dialogue, a late reveal after a pause, and one sentence of meaning.",
        quotes=True,
        min_speech_ms=60_000,
    ),
)
DRILLS.update({d.id: d for d in STORY_COURSE})


def is_story(drill_id: str) -> bool:
    return drill_id.startswith("story-")


MAX_LEVEL = 3


@dataclass(frozen=True)
class Achievement:
    id: str
    title: str
    description: str


ACHIEVEMENTS: tuple[Achievement, ...] = (
    Achievement("quick-thinker", "Quick Thinker", "Complete Think on Your Feet level 2"),
    Achievement("think-under-pressure", "Think Under Pressure", "Complete Think on Your Feet level 3"),
    Achievement("master-of-the-pause", "Master of the Pause", "Complete Pause, Don't Fill level 3"),
    Achievement("clear-speaker", "Clear Speaker", "Complete Clear Diction level 3 and Explain it Simply level 2"),
    Achievement("master-storyteller", "Master Storyteller", "Complete Your Signature Story level 3"),
    Achievement(
        "structured-mind",
        "Structured Mind",
        "Complete Framework Challenge level 2, with structure 4/5+ in 10 rounds across 3 drills",
    ),
)

#: Bumped when challenge or achievement rules change: progress earned under older rules is reset.
RULES_VERSION = 2


def challenge_for(drill: DrillDef, level: int) -> Challenge:
    return drill.challenges[min(max(level, 1), MAX_LEVEL) - 1]


def metric(drill: DrillDef, key: str) -> MetricDef:
    return next(m for m in drill.metrics if m.key == key)
