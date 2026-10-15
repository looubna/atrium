"""What a told story measures like, from its words and their timings (the Story Course in the Park).

Everything here is counted, not judged; the AI coach rates only what has no honest count.

- Narrative Index (Randy Olson): contrast words per "and", x100. Stories that move on "but" and
  "therefore" hold attention; stories strung together with "and… and… and" read as a list.
- The narrative arc (after Boyd, Blackburn & Pennebaker, Science Advances 2020, ~60,000 narratives):
  *staging* words (articles, prepositions) set the scene early and fall away; *plot progression*
  words (pronouns, auxiliary verbs, time adverbs) rise; *cognitive tension* words (think, because,
  but, maybe…) peak near the climax. Their word lists are LIWC's and proprietary; these are short
  open lists of the same closed-class words, so the curves show the shape, not LIWC's numbers.
- Where the hook and the reveal fall in time, from the lines the coach quotes (see analysis.py).
"""

from __future__ import annotations

import re

from app.platform.transcripts.model import Word

#: A story shorter than this has no arc worth drawing.
MIN_ARC_WORDS = 50
ARC_PARTS = 5

CONTRAST = frozenset({"but", "however", "yet", "although", "though", "therefore", "so"})
STAGING = frozenset(
    "a an the in on at into onto under over behind between through across near from to of with by around "
    "inside outside above below beside toward towards along past".split()
)
PROGRESSION = frozenset(
    "i me my we us our you your he him his she her they them their it its "
    "am is are was were be been being have has had do does did will would can could should shall may might "
    "must going gonna then now suddenly finally just still already again soon later never always".split()
)
TENSION = frozenset(
    "think thought know knew realize realized realise realised understand understood because cause why "
    "maybe perhaps if but though although however wonder wondered believe believed decide decided figure "
    "guess sure unsure question reason mean meant wrong afraid worried whether".split()
)


def _tokens(words: list[Word]) -> list[str]:
    return [re.sub(r"[^\w']", "", w.text.lower()) for w in words]


def narrative_index(words: list[Word]) -> float | None:
    """Olson's index: contrast and consequence words ("but", "therefore", "so"…) per "and", x100."""
    tokens = _tokens(words)
    if len(tokens) < 20:
        return None
    ands = tokens.count("and")
    turns = sum(1 for t in tokens if t in CONTRAST)
    return round(100 * turns / max(ands, 1))


def arc_profile(words: list[Word]) -> dict[str, list[float]] | None:
    """The three arc curves over five equal parts of the story, each relative to its own average (1 = average)."""
    tokens = _tokens(words)
    if len(tokens) < MIN_ARC_WORDS:
        return None
    size = len(tokens) / ARC_PARTS
    parts = [tokens[round(i * size):round((i + 1) * size)] for i in range(ARC_PARTS)]

    def curve(vocabulary: frozenset[str]) -> list[float]:
        rates = [sum(1 for t in part if t in vocabulary) / max(len(part), 1) for part in parts]
        mean = sum(rates) / len(rates)
        return [round(r / mean, 2) if mean else 0.0 for r in rates]

    return {"staging": curve(STAGING), "progression": curve(PROGRESSION), "tension": curve(TENSION)}


def staging_early(arc: dict[str, list[float]] | None) -> float | None:
    """How front-loaded the scene-setting is: the first fifth's staging rate against the average (x)."""
    return None if arc is None else arc["staging"][0]


def tension_peak_at(arc: dict[str, list[float]] | None) -> float | None:
    """Where tension words peak, as the middle of that fifth of the story (10, 30, 50, 70 or 90 %)."""
    if arc is None or not any(arc["tension"]):
        return None
    peak = max(range(ARC_PARTS), key=lambda i: arc["tension"][i])
    return float(round((peak + 0.5) * 100 / ARC_PARTS))


def find_quote(words: list[Word], quote: str) -> int | None:
    """Index of the word where `quote` starts in the spoken words, or None. Matches its first words."""
    wanted = [t for t in re.sub(r"[^\w\s']", " ", quote.lower()).split() if t]
    if not wanted or not words:
        return None
    tokens = _tokens(words)
    for length in (min(4, len(wanted)), min(2, len(wanted))):
        head = wanted[:length]
        for i in range(len(tokens) - length + 1):
            if tokens[i:i + length] == head:
                return i
    return None


def hook_seconds(words: list[Word], quote: str) -> float | None:
    """Seconds from the first word to the line that opens the story's question."""
    at = find_quote(words, quote)
    return None if at is None else round((words[at].start_ms - words[0].start_ms) / 1000, 1)


def reveal_at(words: list[Word], quote: str) -> float | None:
    """Where the answer is revealed, as a share of the story's speaking time (%)."""
    at = find_quote(words, quote)
    if at is None:
        return None
    span = words[-1].end_ms - words[0].start_ms
    return None if span <= 0 else float(round(100 * (words[at].start_ms - words[0].start_ms) / span))


def pause_before_reveal(words: list[Word], quote: str) -> float | None:
    """The silence just before the reveal (s): the beat that lets the listener lean in."""
    at = find_quote(words, quote)
    if not at:
        return None
    return round(max(0, words[at].start_ms - words[at - 1].end_ms) / 1000, 1)
