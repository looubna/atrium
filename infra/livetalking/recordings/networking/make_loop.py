"""Cuts a guest's Veo listening clip into a seamless forward loop, and copies it into the app.

    python make_loop.py <guest id> [first last]   # reads <id>/listening.mp4, writes <id>/loop.mp4

`first last` (frame numbers at 25 fps) limits where the loop may end, to leave out a stretch of the
take where the guest mouths words.

Veo is asked to end on its first frame but only gets close, so the loop ends on whichever frame
in the last third looks most like frame 0: playing straight on from there to frame 0 is then no
bigger a step than any other frame to the next. Needs the backend venv (numpy).
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
PUBLIC = HERE.parents[3] / "public" / "video" / "networking" / "close"


def run(*args: str) -> bytes:
    return subprocess.run(["ffmpeg", "-loglevel", "error", "-y", *args], capture_output=True, check=True).stdout


def main(guest: str, span: tuple[int, int] | None = None) -> None:
    folder = HERE / guest
    fps25 = folder / "listening25.mp4"
    run("-i", str(folder / "listening.mp4"), "-vf", "fps=25", "-an", "-c:v", "libx264", "-crf", "14",
        "-pix_fmt", "yuv420p", str(fps25))
    raw = run("-i", str(fps25), "-vf", "scale=320:180,format=gray", "-f", "rawvideo", "-")
    frames = np.frombuffer(raw, np.uint8).reshape(-1, 180, 320).astype(float)
    steps = np.abs(np.diff(frames, axis=0)).mean(axis=(1, 2))
    tail = range(*span) if span else range(len(frames) * 2 // 3, len(frames))
    end = min(tail, key=lambda k: np.abs(frames[0] - frames[k]).mean())
    jump = np.abs(frames[0] - frames[end]).mean()
    print(f"{guest}: loop of {end} frames, seam {jump:.2f} vs typical step {np.median(steps):.2f}")
    loop = folder / "loop.mp4"
    run("-i", str(fps25), "-vf", f"select=lt(n\\,{end}),setpts=N/25/TB", "-r", "25", "-an", "-c:v", "libx264",
        "-crf", "14", "-pix_fmt", "yuv420p", str(loop))
    run("-i", str(loop), "-c:v", "libx264", "-crf", "20", "-preset", "slow", "-pix_fmt", "yuv420p",
        "-movflags", "+faststart", "-an", str(PUBLIC / f"{guest}_face.mp4"))
    run("-i", str(loop), "-frames:v", "1", "-q:v", "3", str(PUBLIC / f"{guest}_face.jpg"))


if __name__ == "__main__":
    main(sys.argv[1], (int(sys.argv[2]), int(sys.argv[3])) if len(sys.argv) > 3 else None)
