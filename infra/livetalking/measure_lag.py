#!/usr/bin/env python
###############################################################################
#  How far the lips run from the voice, in milliseconds.
#
#  Connects to /atrium/offer as a headless candidate, pushes a probe of speech
#  bursts separated by silence, and compares the audio it hears with the mouth
#  movement it sees. A negative answer means the video is early (lips before
#  voice); positive means the video is late (voice before lips, and the mouth
#  keeps moving after the voice stops).
#
#  The answer feeds atrium.py's ATRIUM_TRIM_MS, a signed offset on the video
#  timeline: positive holds the picture back. The script prints the value to set.
#
#  Run it with LiveTalking's venv, which already has aiortc, and with the
#  silence gate off — the gate rests the mouth during the probe's own gaps,
#  which leaves too little movement to correlate against:
#
#      ATRIUM_SILENCE_HOLD=100000 .venv/bin/python app.py --transport webrtc \
#          --model wav2lip --avatar_id evelyn_calm
#      ~/LiveTalking/.venv/bin/python measure_lag.py --avatar evelyn_calm --takes 4
#
#  Measure against a calm base clip (closed mouth, little head movement) or the
#  recording's own motion swamps the mouth signal. --mouth-box r0,r1,c0,c1 pins
#  the region when a take is too busy for it to be found automatically.
###############################################################################

from __future__ import annotations

import argparse
import asyncio
import base64
import hashlib
import hmac
import json
import os
import time
from dataclasses import dataclass, field

import aiohttp
import av
import numpy as np
import soundfile as sf
from aiortc import RTCPeerConnection, RTCSessionDescription

#: The probe is analysed on this grid, fine enough to resolve a 40 ms video frame.
GRID_MS = 5.0
#: Lag search window. Wider than any plausible error, narrower than the burst spacing,
#: so the correlation peak cannot land on the wrong burst.
MAX_LAG_MS = 1400.0
#: Pixels whose brightness varies most across the take are the mouth being repainted.
MOUTH_PERCENTILE = 98.0
#: Where each burst starts, in ms from the first. No difference between two of these equals
#: another, so sliding the probe over itself never lines up more than one pair — the alignment
#: at zero matches all four and stands well clear of every other. Evenly spaced bursts instead
#: match at every multiple of the spacing, and the search then locks onto a neighbour. Bursts
#: are long (--burst-ms) because the mouth is a faint signal: too short and no take survives.
ONSETS_MS = [0, 800, 2600, 6200]
#: A shift smaller than this counts as the same peak, not a rival, when judging the margin.
GUARD_MS = 200.0
#: The winning peak must stand this much clear of the best rival outside the guard band.
MIN_MARGIN = 1.25
#: Takes must agree within this to be believed.
AGREE_MS = 150.0


def sign(secret: bytes, avatar: str, ttl_s: int = 900) -> str:
    """The token atrium.py verifies. With no secret the avatar id alone is accepted."""
    if not secret:
        return avatar
    expiry = str(int(time.time()) + ttl_s)
    mac = hmac.new(secret, f"{avatar}.{expiry}".encode(), hashlib.sha256).digest()
    return f"{avatar}.{expiry}.{base64.urlsafe_b64encode(mac).rstrip(b'=').decode()}"


def probe(source: str, bursts: int, burst_ms: int, lead_ms: int, trail_ms: int) -> bytes:
    """Speech bursts at ONSETS_MS, as the 24 kHz mono PCM16 /atrium/audio wants.

    The silence between them is sent as real samples rather than left out, so the server's
    queue never empties: the mouth stays under the model's control for the whole take instead
    of cutting to the notes clip, whose moving hands would pollute the mouth signal.
    """
    audio, rate = sf.read(source, dtype="int16")
    if audio.ndim > 1:
        audio = audio[:, 0]
    if rate != 24000:
        raise SystemExit(f"{source} is {rate} Hz; /atrium/audio wants 24 kHz mono")

    # The loudest stretch of the recording, so every burst is clearly voiced.
    window = int(24000 * burst_ms / 1000)
    energy = np.convolve(np.abs(audio.astype(np.float32)), np.ones(window), mode="valid")
    clip = audio[int(np.argmax(energy)) :][:window]

    onsets = ONSETS_MS[:bursts]
    span = onsets[-1] + burst_ms
    track = np.zeros(int(24000 * (lead_ms + span + trail_ms) / 1000), dtype=np.int16)
    for onset in onsets:
        at = int(24000 * (lead_ms + onset) / 1000)
        track[at : at + len(clip)] = clip
    return track.astype("<i2").tobytes()


@dataclass
class Take:
    """What the headless candidate heard and saw, on one arrival clock."""

    audio: list[tuple[float, np.ndarray]] = field(default_factory=list)  # (arrival_s, mono s16)
    video: list[tuple[float, np.ndarray]] = field(default_factory=list)  # (arrival_s, gray frame)


async def record(pc: RTCPeerConnection, take: Take, stop: asyncio.Event) -> None:
    """Drain both tracks, stamping every frame with the moment it arrived.

    Arrival time, not the frame's own timestamp: the two streams carry independent RTP
    timestamp bases, and reconciling them needs exactly the alignment being measured.
    The server paces both tracks in real time, so over localhost arrival *is* presentation.
    """
    resampler = av.AudioResampler(format="s16", layout="mono", rate=48000)
    tracks: list[asyncio.Task] = []

    async def drain(track) -> None:
        while not stop.is_set():
            try:
                frame = await asyncio.wait_for(track.recv(), timeout=5.0)
            except (asyncio.TimeoutError, Exception):
                return
            now = time.monotonic()
            if track.kind == "audio":
                for piece in resampler.resample(frame):
                    take.audio.append((now, piece.to_ndarray().reshape(-1)))
            else:
                take.video.append((now, frame.to_ndarray(format="gray")))

    @pc.on("track")
    def on_track(track):  # noqa: ANN001
        tracks.append(asyncio.ensure_future(drain(track)))

    await stop.wait()
    for task in tracks:
        task.cancel()


def envelope(take: Take, forced_box: str | None = None) -> tuple[np.ndarray, np.ndarray, np.ndarray, float | None]:
    """Audio loudness and mouth motion, both resampled onto one 5 ms grid."""
    if len(take.audio) < 10 or len(take.video) < 10:
        raise SystemExit("the take is too short to measure — did the face connect?")

    start = min(take.audio[0][0], take.video[0][0])
    end = max(take.audio[-1][0], take.video[-1][0])
    grid = np.arange(0.0, end - start, GRID_MS / 1000.0)

    # Audio: each frame's loudness, held over the span it covers.
    times = np.array([t - start for t, _ in take.audio])
    loud = np.array([float(np.sqrt(np.mean((a.astype(np.float32) / 32768.0) ** 2))) for _, a in take.audio])
    heard = np.interp(grid, times, loud)

    # Video: the mouth is whatever moves *while the voice is speaking*. Picking the region
    # over the whole take instead would land on the notes clip's hands, which move far more
    # than a mouth and only start once the queue empties — that reads as a tail that is not
    # there. The base clip is calm by construction, so during speech the mouth is the mover.
    frames = np.stack([f.astype(np.float32) for _, f in take.video])
    video_at = np.array([t - start for t, _ in take.video])
    loud = np.nonzero(heard > 0.25 * heard.max())[0]
    if len(loud) == 0:
        raise SystemExit("no speech came back from the face server")
    # Asymmetric on purpose: the video may run ahead of the voice by up to MAX_LAG_MS, but the
    # moment the audio stops the avatar may cut to the notes clip, whose moving hands would be
    # picked as "the mouth" if the window reached past it.
    speaking = (video_at >= grid[loud[0]] - MAX_LAG_MS / 1000.0) & (video_at <= grid[loud[-1]] + 0.1)

    h, w = frames.shape[1:]
    if forced_box:
        r0, r1, c0, c1 = (int(v) for v in forced_box.split(","))
        box = (slice(r0, r1), slice(c0, c1))
    else:
        spread = frames[speaking].std(axis=0)
        hot = spread >= np.percentile(spread, MOUTH_PERCENTILE)
        rows, cols = np.nonzero(hot)
        r, c = int(np.median(rows)), int(np.median(cols))
        if r > h * 2 // 3:
            print(f"  warning: the moving region sits at row {r}/{h}, low enough to be hands, not a mouth")
            print("  pass --mouth-box r0,r1,c0,c1 to pin it on the mouth instead")
        box = (slice(max(0, r - h // 12), r + h // 12), slice(max(0, c - w // 12), c + w // 12))
    print(f"  mouth box: rows {box[0].start}-{box[0].stop}, cols {box[1].start}-{box[1].stop} of {h}x{w}")

    # Mouth motion against the rest of the frame. Lip-sync repaints the mouth alone, so the
    # difference isolates it; anything that moves the whole picture — the cut to the notes
    # clip when the queue empties, a head turn in the base loop — lifts both and cancels.
    step = np.abs(np.diff(frames, axis=0))
    inside = step[(slice(None), *box)].mean(axis=(1, 2))
    whole = step.mean(axis=(1, 2))
    motion = np.concatenate([[0.0], np.maximum(inside - whole, 0.0)])
    seen = np.interp(grid, video_at, motion)

    # When the audio queue empties the avatar cuts to the notes clip: one frame where the
    # whole picture jumps, far beyond anything lip-sync does. That is where the take stops
    # being a measurement of the mouth.
    after = np.nonzero(video_at[1:] > grid[loud[-1]])[0]
    cut_at = None
    if len(after) and whole[after].max() > 6.0 * float(np.median(whole) + 1e-9):
        cut_at = float(video_at[1:][after][int(np.argmax(whole[after]))])

    return grid, normalise(heard), normalise(seen), cut_at


def tail_ms(grid: np.ndarray, heard: np.ndarray, seen: np.ndarray, cut_at: float | None) -> float:
    """How long the mouth keeps moving after the voice stops. Positive = a silent-mouthing tail.

    This is the symptom as a candidate experiences it: the interviewer finishes, and the face
    carries on talking to an empty room. It should agree with the sign of the measured lag.

    `cut_at` is when the avatar switched to the notes clip. Everything from there on is a
    different recording playing, not the mouth still going, so the window stops short of it.
    """
    window = grid < cut_at if cut_at is not None else np.ones_like(grid, dtype=bool)
    ends = []
    for signal in (heard, seen):
        loud = np.nonzero((signal > 0.25 * signal.max()) & window)[0]
        ends.append(grid[loud[-1]] if len(loud) else 0.0)
    return float((ends[1] - ends[0]) * 1000.0)


def normalise(signal: np.ndarray) -> np.ndarray:
    """Scale to roughly +/-1, ignoring one-frame outliers.

    Switching between the notes clip and the avatar's own frames changes the whole picture in
    a single frame, many times harder than any mouth moves. Dividing by the true maximum would
    scale that one spike to 1 and flatten the speech into the noise, so the scale comes from a
    high percentile instead and the spike is clipped.
    """
    signal = signal - signal.mean()
    peak = float(np.percentile(np.abs(signal), 98.0))
    return np.clip(signal / peak, -1.0, 1.0) if peak > 0 else signal


def lag_ms(grid: np.ndarray, heard: np.ndarray, seen: np.ndarray) -> tuple[float, float]:
    """Where the mouth sits against the voice, by cross-correlation. Negative = video early.

    The bursts make a spiky envelope, so the peak is sharp and needs no threshold picking.
    """
    span = int(MAX_LAG_MS / GRID_MS)
    lags = np.arange(-span, span + 1)
    scores = np.array([float(np.dot(np.roll(seen, -int(k)), heard)) for k in lags])
    best = int(np.argmax(scores))
    # The peak against its best rival outside the guard band, both measured from the floor of
    # the curve. A genuine alignment beats every alias; a near-tie means the take cannot tell
    # them apart and is worth nothing, which is the failure this catches.
    floor = float(np.median(scores))
    rivals = scores[np.abs(lags - lags[best]) > GUARD_MS / GRID_MS]
    rival = float(rivals.max()) if rivals.size else floor
    margin = (scores[best] - floor) / max(rival - floor, 1e-9)
    return float(lags[best] * GRID_MS), float(margin)


async def take_one(args, token: str) -> tuple[float, float, float]:
    pc = RTCPeerConnection()
    pc.addTransceiver("video", direction="recvonly")
    pc.addTransceiver("audio", direction="recvonly")
    take, stop = Take(), asyncio.Event()
    recorder = asyncio.ensure_future(record(pc, take, stop))

    await pc.setLocalDescription(await pc.createOffer())
    while pc.iceGatheringState != "complete":  # the server answers once, without trickle
        await asyncio.sleep(0.05)

    async with aiohttp.ClientSession() as http:
        body = {"sdp": pc.localDescription.sdp, "type": "offer", "token": token}
        async with http.post(f"{args.url}/atrium/offer", json=body) as response:
            if response.status != 200:
                raise SystemExit(f"the face server refused the session: {response.status} {await response.text()}")
            answer = await response.json()
        await pc.setRemoteDescription(RTCSessionDescription(sdp=answer["sdp"], type=answer["type"]))

        ws_url = args.url.replace("http", "ws", 1)
        query = {"sessionid": answer["sessionid"], "token": token}
        async with http.ws_connect(f"{ws_url}/atrium/audio", params=query) as ws:
            while not take.video:  # let the face arrive before the probe starts
                await asyncio.sleep(0.05)
            await asyncio.sleep(1.0)
            take.audio.clear()
            take.video.clear()
            # All at once, the way LiveTalkingRenderer.pushAudio hands a turn over.
            await ws.send_bytes(probe(args.source, args.bursts, args.burst_ms, args.lead_ms, args.trail_ms))
            span = ONSETS_MS[: args.bursts][-1] + args.burst_ms
            await asyncio.sleep((args.lead_ms + span + args.trail_ms) / 1000 + 2.0)

    stop.set()
    await recorder
    await pc.close()
    grid, heard, seen, cut_at = envelope(take, args.mouth_box)
    lag, margin = lag_ms(grid, heard, seen)
    if args.dump:
        np.savez(args.dump, grid=grid, heard=heard, seen=seen, cut_at=cut_at if cut_at else -1)
        print(f'  dumped envelopes to {args.dump}')
    return lag, margin, tail_ms(grid, heard, seen, cut_at)


async def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://localhost:8010")
    parser.add_argument("--avatar", default="evelyn_calm")
    parser.add_argument("--secret", default="", help="ATRIUM_SECRET, if the server requires tokens")
    parser.add_argument("--takes", type=int, default=3, help="sessions to measure; the spread is the noise floor")
    parser.add_argument("--bursts", type=int, default=len(ONSETS_MS), choices=range(2, len(ONSETS_MS) + 1))
    parser.add_argument("--burst-ms", dest="burst_ms", type=int, default=600)
    parser.add_argument("--lead-ms", dest="lead_ms", type=int, default=1500)
    parser.add_argument("--dump", default=None, help="save the two envelopes as .npz for inspection")
    parser.add_argument("--mouth-box", dest="mouth_box", default=None,
                        help="r0,r1,c0,c1 of the mouth, when the take is too busy to find it")
    parser.add_argument("--trail-ms", dest="trail_ms", type=int, default=1500,
                        help="silence after the last burst; 0 makes the probe stop dead, as a real turn does")
    parser.add_argument(
        "--source",
        default="../../scratch/avatar-bakeoff/audio/interviewer.wav",
        help="24 kHz mono speech to cut the bursts from",
    )
    args = parser.parse_args()

    token = sign(args.secret.encode(), args.avatar)
    results, tails = [], []
    for take in range(args.takes):
        lag, margin, tail = await take_one(args, token)
        # Two ways a take is worthless, and both used to pass silently as a number: the peak ran
        # into the edge of the search window, or it barely beat an alias. Reporting the median of
        # those is how this tool once recommended a trim that would have wrecked the sync.
        if abs(lag) >= MAX_LAG_MS - GRID_MS:
            print(f"take {take + 1}: discarded — the peak hit the {MAX_LAG_MS:.0f} ms search limit")
            continue
        if margin < MIN_MARGIN:
            print(f"take {take + 1}: discarded — peak only {margin:.2f}x its best alias, too close to call")
            continue
        print(f"take {take + 1}: lag {lag:+.0f} ms, mouth outlasts voice by {tail:+.0f} ms  ({margin:.2f}x clear of any alias)")
        results.append(lag)
        tails.append(tail)

    if len(results) < 2:
        raise SystemExit(
            "inconclusive: fewer than two takes produced a peak worth believing.\n"
            "Check the silence gate is off (ATRIUM_SILENCE_HOLD=100000), the avatar has a calm\n"
            "base clip, and --mouth-box is on the mouth. Do not change the trim on this."
        )
    spread = max(results) - min(results)
    if spread > AGREE_MS:
        raise SystemExit(
            f"inconclusive: takes disagree by {spread:.0f} ms ({[round(r) for r in results]}).\n"
            "They should agree to within a frame or two. Do not change the trim on this."
        )

    median = float(np.median(results))
    print(f"\n{len(results)} takes agree to within {spread:.0f} ms")
    print(f"tail: {float(np.median(tails)):+.0f} ms of mouth movement after the voice stops")
    print(f"lag: {median:+.0f} ms   ({'video late — voice before lips' if median > 0 else 'video early — lips before voice'})")
    if abs(median) < 60:
        print("within the +/-60 ms band the README calls aligned; leave the trim alone.")
        return
    trim = float(os.environ.get("ATRIUM_TRIM_MS", "625"))
    print(f"set ATRIUM_TRIM_MS={trim - median:.0f} (it is {trim:.0f} now; positive holds the picture back)")


if __name__ == "__main__":
    asyncio.run(main())
