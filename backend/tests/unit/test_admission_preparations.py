from __future__ import annotations

from app.modules.admission.catalogs import OpportunityKind
from app.modules.admission.preparations import (
    Stage,
    StageState,
    Status,
    from_document,
    mark_stage,
    new_stages,
    status_for,
    to_document,
)


def test_a_new_preparation_shows_the_whole_checklist_before_any_work_starts() -> None:
    """§10: the candidate watches the work happen; a spinner would say nothing."""
    document = to_document(name="Global Korea Scholarship", kind=OpportunityKind.BOTH, cycle="2026", program="")

    assert [entry["stage"] for entry in document["stages"]] == [str(s) for s in Stage]
    assert {entry["state"] for entry in document["stages"]} == {str(StageState.PENDING)}
    assert document["status"] == str(Status.PREPARING)


def test_marking_a_stage_leaves_the_caller_s_list_alone() -> None:
    stages = new_stages()
    updated = mark_stage(stages, Stage.RESEARCH, StageState.DONE, note="Found 6 sources")

    assert stages[0]["state"] == str(StageState.PENDING)
    assert updated[0]["state"] == str(StageState.DONE)
    assert updated[0]["note"] == "Found 6 sources"


def test_a_preparation_is_still_preparing_while_anything_is_outstanding() -> None:
    stages = mark_stage(new_stages(), Stage.RESEARCH, StageState.DONE)

    assert status_for(stages) is Status.PREPARING


def test_a_failed_stage_does_not_hold_the_candidate_back() -> None:
    """Research that found nothing still leaves someone who can practise."""
    stages = new_stages()
    stages = mark_stage(stages, Stage.RESEARCH, StageState.FAILED, note="No sources retrieved")
    stages = mark_stage(stages, Stage.MATERIALS, StageState.SKIPPED)
    stages = mark_stage(stages, Stage.PREPARATION, StageState.SKIPPED, note="Nothing was found to prepare from")

    assert status_for(stages) is Status.READY


def test_everything_failing_is_reported_as_failed() -> None:
    stages = new_stages()
    for stage in Stage:
        stages = mark_stage(stages, stage, StageState.FAILED)

    assert status_for(stages) is Status.FAILED


def test_a_document_round_trips_into_the_view_the_app_reads() -> None:
    document = to_document(
        name="Chevening", kind=OpportunityKind.SCHOLARSHIP, cycle="2026", program="MSc Public Policy"
    )
    document["stages"] = mark_stage(document["stages"], Stage.RESEARCH, StageState.DONE, note="6 sources")
    document["status"] = str(status_for(document["stages"]))

    view = from_document("prep-1", document)

    assert view.id == "prep-1"
    assert view.kind is OpportunityKind.SCHOLARSHIP
    assert view.program == "MSc Public Policy"
    assert view.status is Status.PREPARING
    assert view.stages[0].state is StageState.DONE
    assert view.stages[0].note == "6 sources"
    assert view.stages[0].label == "Researching the opportunity"


def test_an_unrecognised_state_reads_as_pending_rather_than_crashing() -> None:
    """Documents outlive code: a stage written by a newer build must not break an older one."""
    view = from_document("prep-2", {"name": "GKS", "stages": [{"stage": "research", "state": "quantum"}]})

    assert view.stages[0].state is StageState.PENDING
    assert view.status is Status.PREPARING


def test_the_checklist_only_lists_work_that_something_runs() -> None:
    """A line nothing can tick never completes, and the preparation would never be ready.

    Every stage here has a job that moves it: research, the analyzer, and the engine that
    joins them.
    """
    stages = new_stages()
    for stage in Stage:
        stages = mark_stage(stages, stage, StageState.DONE)

    assert status_for(stages) is Status.READY
