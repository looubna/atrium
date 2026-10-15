"""The face server (infra/livetalking/atrium.py) runs on the GPU machines, outside this app, and has no
tests of its own: a name error in it once crashed every face right after connecting (2026-10-08). This
catches that class of mistake before a deploy, and keeps the copies that get deployed identical."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

INFRA = Path(__file__).resolve().parents[3] / "infra"
SOURCE = INFRA / "livetalking" / "atrium.py"
COPIES = (INFRA / "livetalking" / "cloudrun" / "patch" / "atrium.py", INFRA / "move" / "face-metadata" / "atrium-py")


def test_the_face_server_has_no_undefined_names_or_syntax_errors() -> None:
    result = subprocess.run(  # noqa: S603 - fixed arguments, our own file
        [sys.executable, "-m", "ruff", "check", "--no-cache", "--select", "F", "--isolated", str(SOURCE)],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stdout + result.stderr


def test_every_deployed_copy_matches_the_source() -> None:
    for copy in COPIES:
        assert copy.read_text() == SOURCE.read_text(), f"{copy} is out of date: cp {SOURCE} {copy}"
