"""Cloud Storage object names, always built from the authenticated uid.

Clients never send object names. Every path is derived here from the uid in the
verified token and server-validated IDs, so a request cannot address another
user's object.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from enum import StrEnum

from app.platform.firestore.paths import require_id

_EXT = re.compile(r"[a-z0-9]{2,5}")


class Track(StrEnum):
    CANDIDATE = "cand"
    INTERVIEWER = "ivr"


@dataclass(frozen=True, slots=True)
class StoragePaths:
    uid: str

    def __post_init__(self) -> None:
        if not self.uid or "/" in self.uid or ".." in self.uid or len(self.uid) > 128:
            raise ValueError("invalid uid")

    def user_prefix(self) -> str:
        return f"users/{self.uid}/"

    def resume_prefix(self, resume_id: str) -> str:
        return f"{self.user_prefix()}resumes/{require_id(resume_id)}/"

    def resume_original(self, resume_id: str, ext: str) -> str:
        if not _EXT.fullmatch(ext):
            raise ValueError("invalid extension")
        return f"{self.resume_prefix(resume_id)}original.{ext}"

    def resume_text(self, resume_id: str) -> str:
        return f"{self.resume_prefix(resume_id)}extracted.txt"

    def course_prefix(self, course_id: str) -> str:
        return f"{self.user_prefix()}courses/{require_id(course_id)}/"

    def material_prefix(self, course_id: str, material_id: str) -> str:
        return f"{self.course_prefix(course_id)}materials/{require_id(material_id)}/"

    def material_original(self, course_id: str, material_id: str, ext: str) -> str:
        if not _EXT.fullmatch(ext):
            raise ValueError("invalid extension")
        return f"{self.material_prefix(course_id, material_id)}original.{ext}"

    def material_text(self, course_id: str, material_id: str) -> str:
        return f"{self.material_prefix(course_id, material_id)}extracted.txt"

    def debate_prefix(self, debate_id: str) -> str:
        return f"{self.user_prefix()}debates/{require_id(debate_id)}/"

    def debate_material_prefix(self, debate_id: str, material_id: str) -> str:
        return f"{self.debate_prefix(debate_id)}materials/{require_id(material_id)}/"

    def debate_material_original(self, debate_id: str, material_id: str, ext: str) -> str:
        if not _EXT.fullmatch(ext):
            raise ValueError("invalid extension")
        return f"{self.debate_material_prefix(debate_id, material_id)}original.{ext}"

    def debate_material_text(self, debate_id: str, material_id: str) -> str:
        return f"{self.debate_material_prefix(debate_id, material_id)}extracted.txt"

    def session_prefix(self, session_id: str) -> str:
        return f"{self.user_prefix()}sessions/{require_id(session_id)}/"

    def live_segment(self, session_id: str, track: Track, index: int) -> str:
        if index < 0 or index > 9999:
            raise ValueError("segment index out of range")
        return f"{self.session_prefix(session_id)}live/{track.value}-{index:04d}.trk"

    def live_prefix(self, session_id: str, track: Track) -> str:
        return f"{self.session_prefix(session_id)}live/{track.value}-"

    def session_audio(self, session_id: str) -> str:
        return f"{self.session_prefix(session_id)}audio.m4a"

    def session_video(self, session_id: str, upload_id: str, ext: str) -> str:
        if ext not in ("mp4", "webm"):
            raise ValueError("invalid video extension")
        return f"{self.session_prefix(session_id)}video-{require_id(upload_id)}.{ext}"

    def example_audio(self, session_id: str, run_id: str, event_id: str, voice: str, ext: str) -> str:
        if voice not in ("warm", "deep") or ext not in ("mp3", "wav"):
            raise ValueError("invalid example audio")
        return f"{self.session_prefix(session_id)}examples/{require_id(run_id)}-{require_id(event_id)}-{voice}.{ext}"

    def face_metrics(self, session_id: str) -> str:
        return f"{self.session_prefix(session_id)}face-metrics.json"

    def transcript(self, session_id: str) -> str:
        return f"{self.session_prefix(session_id)}transcript.json"

    def evaluation(self, session_id: str, run_id: str) -> str:
        return f"{self.session_prefix(session_id)}evaluations/{require_id(run_id)}.json"


def processing_prefix(job_id: str) -> str:
    return f"jobs/{require_id(job_id)}/"
