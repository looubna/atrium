"""One candidate's run at one opportunity: the record the app polls while research happens.

This is the seam between the two halves of the module. Research is slow, fallible and shared
between candidates (`cache.py`); a preparation is fast to read, belongs to one person, and is
what the screen is drawn from. Keeping them apart is what lets a second candidate applying to
the same scholarship in the same cycle skip straight to the interview.

The document exists from the moment the candidate names the opportunity, before anything is
known about it, because §10 requires the app to show the work happening rather than a spinner
on a request that takes a minute. `stages` is therefore not a log: it is the checklist on the
screen, and each entry moves from `pending` to `done` (or `skipped`) as the job passes it.

A failed stage is recorded and the preparation continues. Research that found nothing still
leaves a candidate who can practise; refusing to build anything because one search failed
would make the feature less useful than the interview they could have had.
"""

from __future__ import annotations

from datetime import UTC, datetime
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, Field

from app.modules.admission.catalogs import OpportunityKind, parse_kind

COLLECTION = "admissionPreparations"
MAX_NAME = 160
MAX_PROGRAM = 160


class Stage(StrEnum):
    """The checklist the candidate watches (§10). Ordered as the job runs them.

    Only stages something actually runs belong here: a line nothing can tick never completes,
    so the preparation would never be ready and the candidate would watch it for ever.
    """

    RESEARCH = "research"
    MATERIALS = "materials"
    PREPARATION = "preparation"


#: What each stage is called on screen. Written as the work being done, not as a system state:
#: the candidate is watching their own opportunity being read about.
STAGE_LABELS: dict[Stage, str] = {
    Stage.RESEARCH: "Researching the opportunity",
    Stage.MATERIALS: "Reading your application",
    Stage.PREPARATION: "Working out what to prepare",
}


class StageState(StrEnum):
    PENDING = "pending"
    RUNNING = "running"
    DONE = "done"
    #: Nothing to do, and that is fine: no materials uploaded, or research already cached.
    SKIPPED = "skipped"
    FAILED = "failed"


class Status(StrEnum):
    PREPARING = "preparing"
    READY = "ready"
    #: Every stage failed, so there is nothing to show. Distinct from a thin result.
    FAILED = "failed"


class StageView(BaseModel):
    stage: Stage
    label: str
    state: StageState = StageState.PENDING
    #: One line about what happened, shown only when it is worth saying — "no interview
    #: accounts found", not "OK".
    note: str = ""


class PreparationView(BaseModel):
    """What the app reads. Deliberately small: the profiles are fetched separately."""

    id: str
    name: str
    kind: OpportunityKind
    cycle: str
    program: str = ""
    status: Status = Status.PREPARING
    stages: list[StageView] = Field(default_factory=list)
    #: Set once research has a profile, so the dashboard can show what was found.
    opportunityKey: str = ""
    materialCount: int = 0
    createdAt: datetime | None = None
    updatedAt: datetime | None = None

    def is_ready(self) -> bool:
        return self.status is Status.READY


def new_stages() -> list[dict[str, Any]]:
    """The checklist as it looks before any work has been done."""
    return [
        {"stage": str(stage), "label": STAGE_LABELS[stage], "state": str(StageState.PENDING), "note": ""}
        for stage in Stage
    ]


def to_document(
    *, name: str, kind: OpportunityKind, cycle: str, program: str, now: datetime | None = None
) -> dict[str, Any]:
    stamp = now or datetime.now(UTC)
    return {
        "name": " ".join(name.split())[:MAX_NAME],
        "kind": str(kind),
        "cycle": " ".join(cycle.split())[:16],
        "program": " ".join(program.split())[:MAX_PROGRAM],
        "status": str(Status.PREPARING),
        "stages": new_stages(),
        "opportunityKey": "",
        "materialCount": 0,
        "createdAt": stamp,
        "updatedAt": stamp,
    }


def mark_stage(
    stages: list[dict[str, Any]], stage: Stage, state: StageState, *, note: str = ""
) -> list[dict[str, Any]]:
    """The checklist with one line moved on. Unknown stages are added rather than dropped.

    Returns a new list: these are written back with the rest of the document, and mutating
    the caller's copy has bitten this codebase before when a retry re-read a stale object.
    """
    updated: list[dict[str, Any]] = []
    seen = False
    for entry in stages:
        if entry.get("stage") == str(stage):
            seen = True
            updated.append({**entry, "state": str(state), "note": " ".join(str(note).split())[:200]})
        else:
            updated.append(dict(entry))
    if not seen:
        updated.append(
            {
                "stage": str(stage),
                "label": STAGE_LABELS.get(stage, str(stage)),
                "state": str(state),
                "note": " ".join(str(note).split())[:200],
            }
        )
    return updated


def status_for(stages: list[dict[str, Any]]) -> Status:
    """Where the preparation stands, read from the checklist rather than stored twice.

    Ready as soon as nothing is still running: a stage that failed or was skipped has had its
    turn, and the candidate should be let through to whatever was built. Failed only when
    every stage failed, which means nothing was learned from any direction.
    """
    states = [str(entry.get("state", StageState.PENDING)) for entry in stages]
    if not states:
        return Status.PREPARING
    if any(state in {str(StageState.PENDING), str(StageState.RUNNING)} for state in states):
        return Status.PREPARING
    if all(state == str(StageState.FAILED) for state in states):
        return Status.FAILED
    return Status.READY


def from_document(prep_id: str, data: dict[str, Any]) -> PreparationView:
    stages = [
        StageView(
            stage=Stage(entry["stage"]) if entry.get("stage") in set(Stage) else Stage.RESEARCH,
            label=str(entry.get("label", "")),
            state=StageState(entry["state"]) if entry.get("state") in set(StageState) else StageState.PENDING,
            note=str(entry.get("note", "")),
        )
        for entry in data.get("stages", [])
        if isinstance(entry, dict)
    ]
    status_value = data.get("status")
    return PreparationView(
        id=prep_id,
        name=str(data.get("name", "")),
        kind=parse_kind(data.get("kind")),
        cycle=str(data.get("cycle", "")),
        program=str(data.get("program", "")),
        status=Status(status_value) if status_value in set(Status) else Status.PREPARING,
        stages=stages,
        opportunityKey=str(data.get("opportunityKey", "")),
        materialCount=int(data.get("materialCount", 0) or 0),
        createdAt=data.get("createdAt"),
        updatedAt=data.get("updatedAt"),
    )
