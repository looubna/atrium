import json

from app.platform.ai.stream_json import completed_array_objects, completed_string

FULL = json.dumps(
    {
        "processSummary": 'Likely interview process: a "screen", then {two} rounds',
        "companySummary": "Makes payments software.",
        "rounds": [
            {"order": 1, "title": "Recruiter screen", "notes": "braces } and ] inside strings", "rounds": []},
            {"order": 2, "title": "Coding", "questionFamilies": [{"name": "Arrays"}]},
            {"order": 3, "title": "Hiring manager"},
        ],
        "sources": [],
    },
    indent=1,
)


def test_complete_text_yields_everything() -> None:
    assert completed_string(FULL, "processSummary") == 'Likely interview process: a "screen", then {two} rounds'
    assert [r["order"] for r in completed_array_objects(FULL, "rounds")] == [1, 2, 3]


def test_every_prefix_yields_only_finished_parts_in_order() -> None:
    seen_counts = []
    for cut in range(len(FULL) + 1):
        prefix = FULL[:cut]
        rounds = completed_array_objects(prefix, "rounds")
        assert [r["order"] for r in rounds] == list(range(1, len(rounds) + 1))
        seen_counts.append(len(rounds))
        summary = completed_string(prefix, "processSummary")
        assert summary is None or summary.endswith("rounds")
    assert seen_counts == sorted(seen_counts)
    assert seen_counts[-1] == 3


def test_round_is_returned_only_once_its_closing_brace_arrives() -> None:
    first_end = FULL.index('"Coding"')
    prefix = FULL[:first_end]
    assert [r["title"] for r in completed_array_objects(prefix, "rounds")] == ["Recruiter screen"]


def test_nested_keys_with_the_same_name_are_ignored() -> None:
    nested_only = '{"sources": [{"rounds": [{"order": 9}]}], "rounds": ['
    assert completed_array_objects(nested_only, "rounds") == []
    # Finished objects count even while the array itself is still being written.
    assert completed_array_objects(nested_only + '{"order": 1}', "rounds") == [{"order": 1}]
    assert completed_array_objects(nested_only + '{"order": 1}]}', "rounds") == [{"order": 1}]


def test_missing_or_wrong_type_values() -> None:
    assert completed_string('{"processSummary": 12}', "processSummary") is None
    assert completed_array_objects('{"rounds": "none"}', "rounds") == []
    assert completed_array_objects("", "rounds") == []
    assert completed_string('{"processSummary": "unfinished', "processSummary") is None
