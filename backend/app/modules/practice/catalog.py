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

#: What the AI coach may rate, with the question it answers.
AI_RATINGS: dict[str, str] = {
    "structure": "1-5: does the answer have a clear shape (point, support, conclusion)?",
    "clarity": "1-5: would a listener understand it on first hearing, without jargon?",
    "conciseness": "1-5: does it say what is needed without padding or rambling?",
    "detail": "1-5: could someone who cannot see the scene picture it (layout, people, mood)?",
    "factsRecalled": "0-100: share of the passage's key facts (who, what, where, when, why, outcome) retold correctly",
    "stepsCovered": "0-100: share of the framework's steps the answer clearly covered, in order",
    "bothSides": "0 or 1: did the speaker argue both for and against, each with a real argument?",
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
