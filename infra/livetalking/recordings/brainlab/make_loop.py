"""Cuts the Brain Lab neuroscientist's Veo listening clip (same recipe as park/make_loop.py) into their face's base loop: only frames with the mouth shut.

    python make_loop.py <partner> [--still=<frame>:<y0>-<y1>] <first-last> [<first-last> ...]

Reads `<partner>/listening25.mp4` (Veo's clip at 25 fps), writes `<partner>/loop.mp4` at 1280x720 and
copies it into the app as `public/video/park/<partner>_face.{mp4,jpg}`.

Veo makes a person facing the camera talk for a few seconds even when told not to; a lip-synced
mouth painted over those frames fights the one underneath, and between sentences the base clip's
own mouth goes on "talking". So the loop keeps only the spans measure.py finds with the lips shut.
A span written backwards (`57-0`) plays in reverse; forward then back loops with no jump. A join
that is not continuous in the clip is crossfaded over FADE frames (Veo ends near, not on, its
first frame). Needs the backend venv (numpy).

`--still` holds the background beside the person still, taken from one empty frame: Veo puts passers-by
on the path behind them, and in a forward-then-back loop they walk backwards. Rows y0-y1 (at 1280x720)
are replaced left and right of the person, up to FREEZE_MARGIN px short of their outline, which is
found per row on the empty frame as where the dark clothing starts; the edge is feathered.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
PUBLIC = HERE.parents[3] / "public" / "video" / "brainlab"
FADE = 8
W, H = 1280, 720
FREEZE_MARGIN = 10
FEATHER = 8


def still_mask(plate: np.ndarray, y0: int, y1: int) -> np.ndarray:
    """1 where the background is held still: rows y0-y1, outside the person's outline (with a margin)."""
    grey = plate.mean(axis=2)
    mask = np.zeros((H, W), np.float32)
    for y in range(y0, y1):
        # The person is the longest run of dark pixels in the row (their clothing); railing posts and
        # shadows are dark too, but short.
        dark = np.concatenate([[False], grey[y] < 55, [False]])
        edges = np.flatnonzero(np.diff(dark.astype(np.int8)))
        runs = list(zip(edges[::2], edges[1::2]))
        if not runs:
            continue
        a, b = max(runs, key=lambda r: r[1] - r[0])
        if b - a < W // 20:
            continue
        left, right = a - FREEZE_MARGIN, b + FREEZE_MARGIN
        mask[y, :max(0, left)] = 1
        mask[y, min(W, right):] = 1
    # Feather: a box blur over the mask, done with cumulative sums in both directions.
    k = FEATHER * 2 + 1
    for axis in (0, 1):
        c = np.cumsum(np.pad(mask, [(FEATHER + 1, FEATHER) if a == axis else (0, 0) for a in (0, 1)]), axis=axis)
        size = mask.shape[axis]
        mask = (np.take(c, range(k, k + size), axis=axis) - np.take(c, range(size), axis=axis)) / k
    return mask[..., None]


def main(partner: str, *spans: str) -> None:
    src = HERE / partner / "listening25.mp4"
    raw = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", str(src), "-vf", f"scale={W}:{H}:flags=lanczos",
                          "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], capture_output=True, check=True).stdout
    frames = np.frombuffer(raw, np.uint8).reshape(-1, H, W, 3)
    n = len(frames)
    if spans and spans[0].startswith("--still="):
        at, rows = spans[0].removeprefix("--still=").split(":")
        plate = frames[int(at)].astype(np.float32)
        mask = still_mask(plate, *(int(v) for v in rows.split("-")))
        frames = np.stack([(f * (1 - mask) + plate * mask).round().astype(np.uint8) for f in frames])
        spans = spans[1:]
    ranges = [(int(s.split("-")[0]), int(s.split("-")[1])) for s in spans]
    order = [list(range(a, b + 1)) if a <= b else list(range(a, b - 1, -1)) for a, b in ranges]
    ramp = ((np.arange(FADE) + 1) / (FADE + 1))[:, None, None, None]
    seq, last = frames[order[0]].astype(np.float32), order[0][-1]
    for idx in order[1:]:
        piece = frames[idx].astype(np.float32)
        if abs(idx[0] - last) <= 1:
            seq = np.concatenate([seq, piece])
        else:
            seq = np.concatenate([seq[:-FADE], seq[-FADE:] * (1 - ramp) + piece[:FADE] * ramp, piece[FADE:]])
        last = idx[-1]
    # The wrap: unless the loop ends next to where it starts, its last frames dissolve into its first.
    if abs(order[0][0] - last) > 1:
        seq[-FADE:] = seq[-FADE:] * (1 - ramp) + seq[0] * ramp
    loop = HERE / partner / "loop.mp4"
    subprocess.run(
        ["ffmpeg", "-loglevel", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", "25",
         "-i", "-", "-c:v", "libx264", "-crf", "12", "-pix_fmt", "yuv420p", str(loop)],
        input=seq.round().clip(0, 255).astype(np.uint8).tobytes(), check=True)
    ff = ["ffmpeg", "-loglevel", "error", "-y", "-i", str(loop)]
    subprocess.run([*ff, "-c:v", "libx264", "-crf", "20", "-preset", "slow", "-pix_fmt", "yuv420p", "-movflags",
                    "+faststart", "-an", str(PUBLIC / f"{partner}_face.mp4")], check=True)
    subprocess.run([*ff, "-frames:v", "1", "-q:v", "3", str(PUBLIC / f"{partner}_face.jpg")], check=True)
    print(partner, f"{len(seq)} frames from a {n}-frame clip")


if __name__ == "__main__":
    main(*sys.argv[1:])
