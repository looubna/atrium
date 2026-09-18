from __future__ import annotations

from app.platform.transcripts.metrics import competency_measurements, compute_delivery_metrics
from app.platform.transcripts.model import (
    Segment,
    Word,
    assemble_transcript,
    build_candidate_segments,
    drop_echo,
    normalize,
)


def words(text: str, start_ms: int, step_ms: int = 300) -> list[Word]:
    return [
        Word(text=w, start_ms=start_ms + i * step_ms, end_ms=start_ms + i * step_ms + step_ms - 50, confidence=0.9)
        for i, w in enumerate(text.split())
    ]


def test_normalize_for_quote_matching() -> None:
    assert normalize("  We cut latency — by 40%! ") == "we cut latency by 40"


def test_segments_split_on_long_pauses_and_sentence_ends() -> None:
    ws = [*words("I led the migration.", 0), *words("It took six weeks", 1900), *words("and saved money", 8000)]
    segments = build_candidate_segments(ws)
    assert [s.text for s in segments] == ["I led the migration.", "It took six weeks", "and saved money"]
    assert segments[0].start_ms == 0 and segments[0].end_ms == 1150


def test_segments_are_capped_in_length() -> None:
    long_run = words(" ".join(["word"] * 120), 0, step_ms=300)  # 36 s without pauses
    segments = build_candidate_segments(long_run)
    assert len(segments) == 2
    assert all(s.end_ms - s.start_ms <= 25_300 for s in segments)


def test_echo_words_inside_interviewer_playback_are_removed() -> None:
    interviewer = [Segment(id="", speaker="interviewer", start_ms=1000, end_ms=3000, text="Tell me about a conflict")]
    candidate = [
        Word(text="conflict", start_ms=2000, end_ms=2300),  # echo of the interviewer
        Word(text="sure", start_ms=2500, end_ms=2700),  # candidate talking over, not echo
        Word(text="conflict", start_ms=6000, end_ms=6300),  # candidate's own word later
    ]
    kept = drop_echo(candidate, interviewer)
    assert [(w.text, w.start_ms) for w in kept] == [("sure", 2500), ("conflict", 6000)]


def test_assembled_transcript_orders_and_numbers_segments() -> None:
    interviewer = [Segment(id="", speaker="interviewer", start_ms=0, end_ms=2000, text="Why this role?")]
    transcript = assemble_transcript(words("Because I love building products", 2500), interviewer, duration_ms=5000)
    assert [(s.id, s.speaker) for s in transcript.segments] == [("s0001", "interviewer"), ("s0002", "candidate")]
    assert transcript.segment_map()["s0002"].words[0].text == "Because"


def test_delivery_metrics() -> None:
    fast = Segment(
        id="s0001", speaker="candidate", start_ms=0, end_ms=10_000, text="",
        words=words(" ".join(f"word{i}" for i in range(40)), 0, step_ms=250),
    )
    fillers = Segment(
        id="s0002", speaker="candidate", start_ms=12_000, end_ms=16_000, text="",
        words=[
            *words("um so you know the the plan", 12_000),
            Word(text="worked", start_ms=16_000, end_ms=16_300),
        ],
    )
    fillers.words[-1] = Word(text="worked", start_ms=15_000, end_ms=15_300)
    paused = Segment(
        id="s0003", speaker="candidate", start_ms=20_000, end_ms=24_000, text="",
        words=[Word(text="well", start_ms=20_000, end_ms=20_300), Word(text="yes", start_ms=23_500, end_ms=24_000)],
    )
    m = compute_delivery_metrics([fast, fillers, paused])
    assert m.word_count == 40 + 8 + 2
    assert [p.segment_id for p in m.fast_segments] == ["s0001"]
    assert m.fast_segments[0].wpm == 240
    assert {f.detail for f in m.fillers} == {"um", "you know"}
    assert [r.detail for r in m.repetitions] == ["the the"]
    assert [(p.start_ms, p.end_ms) for p in m.long_pauses] == [(20_300, 23_500)]
    summary = m.summary()
    assert summary["fillerCount"] == 2 and summary["fastSegments"] == [{"segmentId": "s0001", "wpm": 240}]
    assert m.mean_confidence is not None


def test_metrics_with_no_speech() -> None:
    m = compute_delivery_metrics([])
    assert m.wpm == 0 and m.filler_count == 0 and m.mean_confidence is None
    assert competency_measurements(m) == {}


def test_measurements_explain_delivery_scores_against_targets() -> None:
    # 60 words in 20 seconds: 180 words per minute, with two fillers and a repeated word.
    text = "um so " + " ".join(f"word{i}" for i in range(54)) + " the the you know"
    segment = Segment(id="s0001", speaker="candidate", start_ms=0, end_ms=20_000, text="",
                      words=words(text, 0, step_ms=333))
    measured = competency_measurements(compute_delivery_metrics([segment]))

    pace = measured["comm.pace"]
    assert pace["value"] == 180 and pace["target"] == "130-160" and pace["verdict"] == "Too fast"
    fillers = measured["comm.filler_words"]
    assert fillers["value"] == 6.0 and fillers["verdict"] == "Frequent"
    assert "“um” x1" in str(fillers["details"])
    assert measured["comm.repetition"]["value"] == 1
    assert measured["comm.fluency"]["verdict"] == "Rare"
