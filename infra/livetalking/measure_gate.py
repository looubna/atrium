"""Does the face stop speaking during a pause in the interviewer's own audio?

Asks the server, not the pixels: /is_speaking returns the same flag process_frames sets from
the audio frame type, so this verifies the silence gate end to end with no video analysis.

  speech 2s | silence 3s | speech 2s

With the gate on, speaking must drop to False during the middle. With it off it stays True the
whole way, which is the face mouthing to an empty room.
"""

import asyncio
import sys
import time

import aiohttp
import numpy as np
import soundfile as sf
from aiortc import RTCPeerConnection, RTCSessionDescription

URL = "http://localhost:8010"
AVATAR = "evelyn_calm"
SRC = "../../scratch/avatar-bakeoff/audio/interviewer.wav"


def pcm() -> bytes:
    audio, _ = sf.read(SRC, dtype="int16")
    w = int(24000 * 2.0)
    energy = np.convolve(np.abs(audio.astype(np.float32)), np.ones(w), mode="valid")
    speech = audio[int(np.argmax(energy)) :][:w]
    hush = np.zeros(int(24000 * 3.0), dtype=np.int16)
    return np.concatenate([speech, hush, speech]).astype("<i2").tobytes()


async def main() -> None:
    pc = RTCPeerConnection()
    pc.addTransceiver("video", direction="recvonly")
    pc.addTransceiver("audio", direction="recvonly")
    frames = []

    @pc.on("track")
    def on_track(track):
        async def drain():
            while True:
                try:
                    await track.recv()
                except Exception:
                    return
                frames.append(1)
        asyncio.ensure_future(drain())

    await pc.setLocalDescription(await pc.createOffer())
    while pc.iceGatheringState != "complete":
        await asyncio.sleep(0.05)

    async with aiohttp.ClientSession() as http:
        body = {"sdp": pc.localDescription.sdp, "type": "offer", "token": AVATAR}
        async with http.post(f"{URL}/atrium/offer", json=body) as r:
            answer = await r.json()
        await pc.setRemoteDescription(RTCSessionDescription(sdp=answer["sdp"], type=answer["type"]))
        sid = answer["sessionid"]

        ws_url = URL.replace("http", "ws", 1)
        async with http.ws_connect(f"{ws_url}/atrium/audio", params={"sessionid": sid, "token": AVATAR}) as ws:
            while not frames:
                await asyncio.sleep(0.05)
            await asyncio.sleep(1.0)
            await ws.send_bytes(pcm())
            t0 = time.monotonic()
            timeline = []
            while time.monotonic() - t0 < 10.0:
                async with http.post(f"{URL}/is_speaking", json={"sessionid": sid}) as r:
                    body = await r.json()
                timeline.append((round(time.monotonic() - t0, 1), bool(body.get("data"))))
                await asyncio.sleep(0.1)

    await pc.close()

    # Collapse to runs so the shape is readable.
    runs, last, start = [], None, 0.0
    for t, sp in timeline:
        if sp != last:
            if last is not None:
                runs.append((start, t, last))
            last, start = sp, t
    runs.append((start, timeline[-1][0], last))
    print("expected: speaking, then a quiet stretch of about 3s, then speaking again")
    for a, b, sp in runs:
        print(f"  {a:5.1f}s - {b:5.1f}s  {'SPEAKING' if sp else 'quiet'}  ({b - a:.1f}s)")
    # Only the pause in the middle counts. The quiet after about 7s is the queue running dry
    # once the whole probe has played, which happens gate or no gate.
    middle = [b - a for a, b, sp in runs if not sp and 0.5 < a < 5.0]
    longest = max(middle) if middle else 0.0
    print(f"\nrest during the pause: {longest:.1f}s")
    print("PASS — the lip-sync stops during the pause" if longest >= 0.8 else "FAIL — it lip-synced the silence")
    print("NB this only proves the lip-sync stopped. Whether the picture stops moving depends on")
    print("the base clip's own mouth — see 'The base clips talk' in the README.")


asyncio.run(main())
