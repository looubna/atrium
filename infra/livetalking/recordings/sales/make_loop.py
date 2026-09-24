"""Cuts a sales take into a seamless forward loop from its clean stretches.

    python make_loop.py <dir> <out.mp4> <W>x<H> [crop=w:h:x:y] <first-last> [<first-last> ...]

The stretches (frame numbers at 25 fps, inclusive) are played in order and must run on from one to
the next (a take ends near its first frame, so "114-191 0-60" is continuous); they leave out the
moments where someone mouths a word or gestures. The only cut is the loop's wrap, which is crossfaded
over its last 6 frames into the first. Needs the backend venv (numpy).
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import numpy as np

FADE = 6


def main(folder: str, out: str, size: str, *spans: str) -> None:
    w, h = (int(v) for v in size.split("x"))
    crop = ""
    if spans and spans[0].startswith("crop="):
        crop, spans = spans[0] + ",", spans[1:]
    raw = subprocess.run(
        ["ffmpeg", "-loglevel", "error", "-i", str(Path(folder) / "listening.mp4"),
         "-vf", f"{crop}scale={w}:{h}:flags=lanczos", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
        capture_output=True, check=True).stdout
    frames = np.frombuffer(raw, np.uint8).reshape(-1, h, w, 3)
    order = [i for s in spans for i in range(int(s.split("-")[0]), int(s.split("-")[1]) + 1)]
    seq = frames[order].astype(np.float32)
    for i in range(FADE):
        a = (i + 1) / (FADE + 1)
        seq[len(seq) - FADE + i] = seq[len(seq) - FADE + i] * (1 - a) + seq[0] * a
    subprocess.run(
        ["ffmpeg", "-loglevel", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{w}x{h}", "-r", "25",
         "-i", "-", "-c:v", "libx264", "-crf", "14", "-pix_fmt", "yuv420p", out],
        input=seq.round().clip(0, 255).astype(np.uint8).tobytes(), check=True)
    print(out, len(seq), "frames")


if __name__ == "__main__":
    main(*sys.argv[1:])
