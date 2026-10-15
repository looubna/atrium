"""Every user-owned document path is built from the authenticated uid.

Handlers never concatenate IDs into paths themselves. IDs from requests are
validated against a strict pattern (no slashes, dots or traversal), and a
document belonging to another user is simply absent from `UserPaths(uid)`'s
namespace, so a guessed ID resolves to "not found" rather than someone else's
data.
"""

from __future__ import annotations

import hashlib
import re
import uuid
from dataclasses import dataclass

from app.core.errors import BadRequest, NotFound

_ID = re.compile(r"[A-Za-z0-9_-]{8,64}")
_COMPETENCY_ID = re.compile(r"[a-z][a-z0-9_]*(\.[a-z0-9_]+){1,3}")
_PERIOD = re.compile(r"(m-\d{4}-\d{2}|d-\d{4}-\d{2}-\d{2}|all)")


def new_id() -> str:
    return uuid.uuid4().hex


def is_valid_id(value: str) -> bool:
    return bool(_ID.fullmatch(value))


def require_id(value: str) -> str:
    """For IDs in paths/bodies that must reference an existing resource: invalid means not found."""
    if not is_valid_id(value):
        raise NotFound()
    return value


def client_uuid(value: str) -> str:
    """Client-generated IDs for create-if-absent idempotency must be UUIDv4."""
    try:
        parsed = uuid.UUID(value)
    except (ValueError, AttributeError, TypeError):
        raise BadRequest("id must be a UUID") from None
    if parsed.version != 4:
        raise BadRequest("id must be a version 4 UUID")
    return parsed.hex


def require_competency_id(value: str) -> str:
    if not _COMPETENCY_ID.fullmatch(value):
        raise NotFound()
    return value


def uid_hash(uid: str, salt: str) -> str:
    """Pseudonymous identifier for analytics and tombstones."""
    return hashlib.sha256(f"{salt}:{uid}".encode()).hexdigest()


@dataclass(frozen=True, slots=True)
class UserPaths:
    uid: str

    def __post_init__(self) -> None:
        # Firebase uids are up to 128 chars; they never contain slashes.
        if not self.uid or "/" in self.uid or len(self.uid) > 128:
            raise ValueError("invalid uid")

    def user(self) -> str:
        return f"users/{self.uid}"

    def consent(self, kind: str) -> str:
        return f"{self.user()}/consents/{kind}"

    def usage(self, period: str) -> str:
        if not _PERIOD.fullmatch(period):
            raise ValueError("invalid usage period")
        return f"{self.user()}/usage/{period}"

    def resumes(self) -> str:
        return f"{self.user()}/resumes"

    def resume(self, resume_id: str) -> str:
        return f"{self.resumes()}/{require_id(resume_id)}"

    def applications(self) -> str:
        return f"{self.user()}/applications"

    def application(self, application_id: str) -> str:
        return f"{self.applications()}/{require_id(application_id)}"

    def blueprints(self, application_id: str) -> str:
        return f"{self.application(application_id)}/blueprints"

    def blueprint(self, application_id: str, blueprint_id: str) -> str:
        return f"{self.blueprints(application_id)}/{require_id(blueprint_id)}"

    def round_guide(self, application_id: str, blueprint_id: str, round_id: str) -> str:
        return f"{self.blueprint(application_id, blueprint_id)}/guides/{require_id(round_id)}"

    def courses(self) -> str:
        return f"{self.user()}/courses"

    def course(self, course_id: str) -> str:
        return f"{self.courses()}/{require_id(course_id)}"

    def materials(self, course_id: str) -> str:
        return f"{self.course(course_id)}/materials"

    def material(self, course_id: str, material_id: str) -> str:
        return f"{self.materials(course_id)}/{require_id(material_id)}"

    def admission_preparations(self) -> str:
        return f"{self.user()}/admissionPreparations"

    def admission_preparation(self, prep_id: str) -> str:
        return f"{self.admission_preparations()}/{require_id(prep_id)}"

    def admission_materials(self, prep_id: str) -> str:
        return f"{self.admission_preparation(prep_id)}/materials"

    def admission_material(self, prep_id: str, material_id: str) -> str:
        return f"{self.admission_materials(prep_id)}/{require_id(material_id)}"

    def exam_analyses(self, course_id: str) -> str:
        return f"{self.course(course_id)}/analyses"

    def exam_analysis(self, course_id: str, analysis_id: str) -> str:
        return f"{self.exam_analyses(course_id)}/{require_id(analysis_id)}"

    def debates(self) -> str:
        return f"{self.user()}/debates"

    def debate(self, debate_id: str) -> str:
        return f"{self.debates()}/{require_id(debate_id)}"

    def debate_materials(self, debate_id: str) -> str:
        return f"{self.debate(debate_id)}/materials"

    def debate_material(self, debate_id: str, material_id: str) -> str:
        return f"{self.debate_materials(debate_id)}/{require_id(material_id)}"

    def debate_preps(self, debate_id: str) -> str:
        return f"{self.debate(debate_id)}/preparations"

    def debate_prep(self, debate_id: str, prep_id: str) -> str:
        return f"{self.debate_preps(debate_id)}/{require_id(prep_id)}"

    def sessions(self) -> str:
        return f"{self.user()}/sessions"

    def session(self, session_id: str) -> str:
        return f"{self.sessions()}/{require_id(session_id)}"

    def turns(self, session_id: str) -> str:
        return f"{self.session(session_id)}/turns"

    def code_snapshots(self, session_id: str) -> str:
        return f"{self.session(session_id)}/codeSnapshots"

    def evaluations(self, session_id: str) -> str:
        return f"{self.session(session_id)}/evaluations"

    def evaluation(self, session_id: str, run_id: str) -> str:
        return f"{self.evaluations(session_id)}/{require_id(run_id)}"

    def events(self, session_id: str, run_id: str) -> str:
        return f"{self.evaluation(session_id, run_id)}/events"

    def competencies(self) -> str:
        return f"{self.user()}/competencies"

    def competency(self, competency_id: str) -> str:
        return f"{self.competencies()}/{require_competency_id(competency_id)}"

    def competency_history(self) -> str:
        return f"{self.user()}/competencyHistory"

    def body_history(self) -> str:
        return f"{self.user()}/bodyHistory"

    def body_history_entry(self, session_id: str) -> str:
        return f"{self.body_history()}/{require_id(session_id)}"

    def practice_progress(self) -> str:
        return f"{self.user()}/practice/progress"

    def practice_attempts(self) -> str:
        return f"{self.user()}/practiceAttempts"

    def practice_attempt(self, attempt_id: str) -> str:
        return f"{self.practice_attempts()}/{require_id(attempt_id)}"


# Server-only top-level collections (denied to clients by the security rules).
def live_session_path(session_id: str) -> str:
    return f"liveSessions/{require_id(session_id)}"


def job_path(job_id: str) -> str:
    return f"jobs/{job_id}"


RUNTIME_CONFIG_PATH = "config/runtime"


def deletion_path(hashed_uid: str) -> str:
    return f"deletions/{hashed_uid}"


def rate_limit_path(key: str) -> str:
    return f"rateLimits/{key}"
