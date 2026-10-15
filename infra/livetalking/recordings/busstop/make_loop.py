"""Cuts a bus stop person's Veo listening clip into their base loop: only frames with the mouth shut.

    python make_loop.py <name> <scenario-id> <first-last> [<first-last> ...]

Reads `<name>_listen.mp4` (Veo, 24 fps), resamples it to 25 fps, writes `<name>_loop.mp4` at 1280x720 and
copies it into the app as `public/video/busstop/<scenario-id>.{mp4,jpg}` (BusStopTalk's backdrop, and the
frames a lip-synced face will be painted on). Same recipe as cafe/make_loop.py: Veo makes a person
facing the camera talk for a few seconds even when told not to, so only the spans with the lips shut are
kept (checked by eye on half-second strips). A span written backwards (`57-0`) plays in reverse;
forward then back loops with no jump. A join that is not continuous is crossfaded over FADE frames.
Needs numpy (the backend venv).
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
PUBLIC = HERE.parents[3] / "public" / "video" / "busstop"
FADE = 8
W, H = 1280, 720


def main(name: str, scenario: str, *spans: str) -> None:
    src = HERE / f"{name}_listen.mp4"
    raw = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", str(src), "-vf", f"fps=25,scale={W}:{H}:flags=lanczos",
                          "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], capture_output=True, check=True).stdout
    frames = np.frombuffer(raw, np.uint8).reshape(-1, H, W, 3)
    n = len(frames)
    ranges = [(int(s.split("-")[0]), int(s.split("-")[1])) for s in spans]
    order = [list(range(a, min(b, n - 1) + 1)) if a <= b else list(range(min(a, n - 1), b - 1, -1)) for a, b in ranges]
    ramp = ((np.arange(FADE) + 1) / (FADE + 1))[:, None, None, None]
    seq, last = frames[order[0]].astype(np.float32), order[0][-1]
    for idx in order[1:]:
        piece = frames[idx].astype(np.float32)
        if abs(idx[0] - last) <= 1:
            seq = np.concatenate([seq, piece])
        else:
            seq = np.concatenate([seq[:-FADE], seq[-FADE:] * (1 - ramp) + piece[:FADE] * ramp, piece[FADE:]])
        last = idx[-1]
    if abs(order[0][0] - last) > 1:
        seq[-FADE:] = seq[-FADE:] * (1 - ramp) + seq[0] * ramp
    loop = HERE / f"{name}_loop.mp4"
    subprocess.run(
        ["ffmpeg", "-loglevel", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", "25",
         "-i", "-", "-c:v", "libx264", "-crf", "12", "-pix_fmt", "yuv420p", str(loop)],
        input=seq.round().clip(0, 255).astype(np.uint8).tobytes(), check=True)
    PUBLIC.mkdir(parents=True, exist_ok=True)
    ff = ["ffmpeg", "-loglevel", "error", "-y", "-i", str(loop)]
    subprocess.run([*ff, "-c:v", "libx264", "-crf", "22", "-preset", "slow", "-pix_fmt", "yuv420p", "-movflags",
                    "+faststart", "-an", str(PUBLIC / f"{scenario}.mp4")], check=True)
    subprocess.run([*ff, "-frames:v", "1", "-q:v", "3", str(PUBLIC / f"{scenario}.jpg")], check=True)
    print(name, f"{len(seq)} frames from a {n}-frame clip")


if __name__ == "__main__":
    main(*sys.argv[1:])
