#!/usr/bin/env python
###############################################################################
#  How well the lips follow the voice, against a face that cannot move.
#
#  measure_lag.py reads mouth motion off a live base clip, and a real person's
#  head, blinks and hair swamp it. This one is meant for a probe avatar made from
#  ONE still frame repeated: nothing in the picture changes except the mouth the
#  model paints, so "how different is this frame from the still" is how open the
#  mouth is, with no other signal in it.
#
#      live:    python lip_probe.py live --url http://localhost:8011 --avatar nw_probe \
#                   --audio probe.wav --still still.png --box 400,480,580,700
#      offline: python lip_probe.py file --video speech.mp4 --still still.png --box ...
#
#  `file` scores a finished render (MuseTalk's own realtime_inference output, frame
#  i at i/25 s against its own audio track) — the model's native timing, which is
#  the reference the live path should match. Both print the lag of the mouth
#  behind the voice (positive = late), how well they correlate, and how long the
#  mouth stays open after each phrase ends.
###############################################################################

from __future__ import annotations

import argparse
import asyncio
import subprocess
import time

import numpy as np

FPS = 25
HOP = 1 / FPS


def openness(frames: np.ndarray, still: np.ndarray, box: tuple[int, int, int, int]) -> np.ndarray:
    r0, r1, c0, c1 = box
    return np.abs(frames[:, r0:r1, c0:c1] - still[r0:r1, c0:c1]).mean(axis=(1, 2, 3))


def loudness(samples: np.ndarray, rate: int, n: int, offset_s: float = 0.0) -> np.ndarray:
    """RMS of the audio in each video frame's 40 ms."""
    out = np.zeros(n)
    x = samples.astype(np.float64) / 32768.0
    for i in range(n):
        a = int((i * HOP - offset_s) * rate)
        b = a + int(HOP * rate)
        if b > 0 and a < len(x):
            seg = x[max(a, 0):b]
            out[i] = np.sqrt(np.mean(seg**2)) if len(seg) else 0.0
    return out


def report(label: str, loud: np.ndarray, mouth: np.ndarray) -> None:
    voiced = loud > 0.15 * loud.max()
    m = (mouth - np.percentile(mouth, 10)) / (np.percentile(mouth, 98) - np.percentile(mouth, 10) + 1e-9)

    def corr(lag: int) -> float:
        a, b = (voiced[: len(m) - lag], m[lag:]) if lag >= 0 else (voiced[-lag:], m[: len(m) + lag])
        return float(np.corrcoef(a.astype(float), b)[0, 1])

    lags = range(-15, 16)
    scores = [corr(k) for k in lags]
    best = int(np.argmax(scores))
    print(f"{label}: mouth lag {list(lags)[best] * 40:+d} ms (corr {scores[best]:.2f}; at 0 ms {corr(0):.2f})")

    # Phrase ends: voiced runs longer than 400 ms followed by 400 ms of quiet.
    ends = [i for i in range(1, len(voiced) - 10) if voiced[i - 1] and not voiced[i : i + 10].any()]
    for e in ends:
        after = m[e : e + 40]
        closed = np.nonzero(after < 0.25)[0]
        tail = closed[0] * 40 if len(closed) else 1600
        print(f"   phrase ends {e * HOP:5.2f}s -> mouth closed after {tail:4d} ms")


def load_still(path: str, width: int, height: int) -> np.ndarray:
    raw = subprocess.run(
        ["ffmpeg", "-loglevel", "error", "-i", path, "-vf", f"scale={width}:{height}", "-f", "rawvideo",
         "-pix_fmt", "rgb24", "-"], capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.uint8).reshape(height, width, 3).astype(np.float32)


def score_file(args) -> None:
    probe = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v", "-show_entries", "stream=width,height",
                            "-of", "csv=p=0", args.video], capture_output=True, text=True, check=True).stdout
    w, h = (int(v) for v in probe.strip().split(",")[:2])
    raw = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", args.video, "-vf", f"fps={FPS}", "-f", "rawvideo",
                          "-pix_fmt", "rgb24", "-"], capture_output=True, check=True).stdout
    frames = np.frombuffer(raw, np.uint8).reshape(-1, h, w, 3).astype(np.float32)
    pcm = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", args.video, "-vn", "-ac", "1", "-ar", "16000",
                          "-f", "s16le", "-"], capture_output=True, check=True).stdout
    audio = np.frombuffer(pcm, np.int16)
    box = tuple(int(v) for v in args.box.split(","))
    report("file", loudness(audio, 16000, len(frames)), openness(frames, load_still(args.still, w, h), box))


async def score_live(args) -> None:
    import aiohttp
    import av
    from aiortc import RTCPeerConnection, RTCSessionDescription

    pc = RTCPeerConnection()
    pc.addTransceiver("video", direction="recvonly")
    pc.addTransceiver("audio", direction="recvonly")
    video: list[tuple[float, np.ndarray]] = []
    audio: list[tuple[float, np.ndarray]] = []
    stop = asyncio.Event()
    resampler = av.AudioResampler(format="s16", layout="mono", rate=16000)

    async def drain(track) -> None:
        while not stop.is_set():
            try:
                frame = await asyncio.wait_for(track.recv(), timeout=5.0)
            except Exception:
                return
            now = time.monotonic()
            if track.kind == "video":
                video.append((now, frame.to_ndarray(format="rgb24")))
            else:
                for piece in resampler.resample(frame):
                    audio.append((now, piece.to_ndarray().reshape(-1)))

    tasks: list[asyncio.Task] = []
    pc.on("track", lambda track: tasks.append(asyncio.ensure_future(drain(track))))
    await pc.setLocalDescription(await pc.createOffer())
    while pc.iceGatheringState != "complete":
        await asyncio.sleep(0.05)
    pcm = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", args.audio, "-ac", "1", "-ar", "24000", "-f", "s16le",
                          "-"], capture_output=True, check=True).stdout
    async with aiohttp.ClientSession() as http:
        body = {"sdp": pc.localDescription.sdp, "type": "offer", "token": args.token or args.avatar}
        async with http.post(f"{args.url}/atrium/offer", json=body) as r:
            answer = await r.json()
        await pc.setRemoteDescription(RTCSessionDescription(sdp=answer["sdp"], type=answer["type"]))
        ws_url = args.url.replace("http", "ws", 1)
        async with http.ws_connect(f"{ws_url}/atrium/audio",
                                   params={"sessionid": answer["sessionid"], "token": args.token or args.avatar}) as ws:
            while not video:
                await asyncio.sleep(0.05)
            await asyncio.sleep(1.5)
            video.clear()
            audio.clear()
            if args.pace:
                # As Gemini delivers it: 40 ms pieces, `pace` times faster than they are spoken.
                piece = 2 * 24000 * 40 // 1000
                for i in range(0, len(pcm), piece):
                    await ws.send_bytes(pcm[i:i + piece])
                    await asyncio.sleep(0.040 / args.pace)
            else:
                await ws.send_bytes(pcm)  # the whole turn at once
            await asyncio.sleep(len(pcm) / 2 / 24000 + 3.0)
    stop.set()
    for t in tasks:
        t.cancel()
    await pc.close()

    # Both tracks on one arrival clock, then onto a 25 fps grid. Over localhost arrival is presentation.
    t0 = min(video[0][0], audio[0][0])
    n = int((max(video[-1][0], audio[-1][0]) - t0) / HOP)
    vt = np.array([t - t0 for t, _ in video])
    frames = np.stack([f for _, f in video]).astype(np.float32)
    h, w = frames.shape[1:3]
    box = tuple(int(v) for v in args.box.split(","))
    raw_open = openness(frames, load_still(args.still, w, h), box)
    mouth = np.interp(np.arange(n) * HOP, vt, raw_open)
    # Audio: each packet ends when it arrives.
    samples = np.concatenate([a for _, a in audio])
    first = audio[0][0] - t0 - len(audio[0][1]) / 16000
    report(f"live {args.tag}", loudness(samples, 16000, n, offset_s=first), mouth)
    if args.save:
        r0, r1, c0, c1 = box
        idx = np.clip(np.searchsorted(vt, np.arange(n) * HOP), 0, len(frames) - 1)
        crops = frames[idx][:, r0 - 40:r1 + 20, c0 - 30:c1 + 30].astype(np.uint8)
        np.savez_compressed(args.save, mouth=mouth, loud=loudness(samples, 16000, n, offset_s=first), crops=crops)


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("mode", choices=["live", "file"])
    p.add_argument("--url", default="http://localhost:8011")
    p.add_argument("--avatar", default="nw_probe")
    p.add_argument("--audio")
    p.add_argument("--video")
    p.add_argument("--still", required=True)
    p.add_argument("--box", required=True, help="mouth box r0,r1,c0,c1 in the stream's pixels")
    p.add_argument("--tag", default="")
    p.add_argument("--token", default="", help="signed token, when the server has ATRIUM_SECRET set")
    p.add_argument("--save")
    p.add_argument("--pace", type=float, default=0.0, help="stream the audio at this multiple of real time")
    args = p.parse_args()
    score_file(args) if args.mode == "file" else asyncio.run(score_live(args))


if __name__ == "__main__":
    main()
