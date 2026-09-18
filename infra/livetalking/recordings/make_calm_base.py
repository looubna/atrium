"""Builds a base clip where the interviewer's mouth stays closed, out of clips she is talking in.

    python make_calm_base.py evelyn

Lip-sync repaints the mouth from the interviewer's speech, so the base recording should show a
closed mouth: whatever it does with its own mouth is what you see during pauses. Rather than
film a new clip, this finds the stretches where she happens to be looking up with her mouth shut
— by comparing each frame's mouth against the still photo the clips were generated from — and
joins the longest of them with short dissolves.

The result wants to be a few seconds long: LiveTalking plays a base clip forwards and backwards,
so a one-second clip visibly repeats every two seconds.
"""

from __future__ import annotations

import sys
from pathlib import Path

import av
import cv2
import numpy as np

#: Where her mouth sits in these 1280x720 recordings.
MOUTH = (slice(205, 265), slice(630, 730))
#: Frames of dissolve between stretches, so a join reads as a soft cut.
FADE = 6
#: A stretch must be at least this long to be worth using.
MIN_RUN = 20


def frames_of(path: Path) -> list[np.ndarray]:
    container = av.open(str(path))
    return [f.to_ndarray(format="bgr24") for f in container.decode(video=0)]


def closed_runs(frames: list[np.ndarray], reference: np.ndarray, tolerance: float = 20.0):
    """Stretches where the mouth looks like the reference: shut, and facing the camera."""
    score = [float(np.abs(cv2.cvtColor(f, cv2.COLOR_BGR2GRAY)[MOUTH].astype(np.float32) - reference).mean())
             for f in frames]
    runs, start = [], None
    for i, value in enumerate(score):
        if value <= tolerance and start is None:
            start = i
        elif value > tolerance and start is not None:
            runs.append((start, i))
            start = None
    if start is not None:
        runs.append((start, len(score)))
    return [r for r in runs if r[1] - r[0] >= MIN_RUN]


def main(face: str) -> None:
    here = Path(__file__).parent / face
    still = cv2.resize(cv2.imread(str(here / f"{face}.png"), cv2.IMREAD_GRAYSCALE), (1280, 720))
    reference = still[MOUTH].astype(np.float32)

    chosen: list[list[np.ndarray]] = []
    for clip in ("talking.mp4", "notes.mp4"):
        frames = frames_of(here / clip)
        for start, end in closed_runs(frames, reference):
            chosen.append(frames[start:end])
    chosen.sort(key=len, reverse=True)
    if not chosen:
        raise SystemExit("no stretch with a closed mouth: film one instead")

    out: list[np.ndarray] = []
    for piece in chosen:
        if not out:
            out.extend(piece)
            continue
        tail = out[-FADE:]
        del out[-FADE:]
        for k in range(FADE):
            weight = k / FADE
            out.append(cv2.addWeighted(tail[k], 1 - weight, piece[k], weight, 0))
        out.extend(piece[FADE:])

    height, width = out[0].shape[:2]
    target = here / "calm_long.mp4"
    writer = cv2.VideoWriter(str(target), cv2.VideoWriter_fourcc(*"mp4v"), 25, (width, height))
    for frame in out:
        writer.write(frame)
    writer.release()
    print(f"{target}: {len(out)} frames = {len(out) / 25:.1f}s from {len(chosen)} stretches")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "evelyn")
