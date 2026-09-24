#!/usr/bin/env python
###############################################################################
#  Whose mouth moves, on a face with several people in it (the in-person panel).
#
#  Streams one phrase per speaker (switching with {"type": "speaker"}), records what
#  comes back, matches every frame to the base frame it was painted on, and measures
#  each person's mouth against that base frame: only the painted mouth differs, so for
#  each phrase exactly one person should light up.
#
#      python room_probe.py --url http://localhost:8010 --token <signed panel_room token> \
#          --frames /opt/LiveTalking/data/avatars/panel_room/full_imgs --audio probe.wav \
#          --box 0=640,322,70,40 --box 1=178,318,70,40 --box 2=1088,352,70,40
###############################################################################

from __future__ import annotations

import argparse
import asyncio
import glob
import subprocess

import cv2
import numpy as np


async def run(args) -> None:
    import aiohttp
    from aiortc import RTCPeerConnection, RTCSessionDescription

    pc = RTCPeerConnection()
    pc.addTransceiver("video", direction="recvonly")
    pc.addTransceiver("audio", direction="recvonly")
    frames: list[tuple[float, np.ndarray]] = []
    stop = asyncio.Event()
    loop = asyncio.get_event_loop()

    async def drain(track) -> None:
        while not stop.is_set():
            try:
                frame = await asyncio.wait_for(track.recv(), timeout=5.0)
            except Exception:
                return
            if track.kind == "video":
                frames.append((loop.time(), frame.to_ndarray(format="bgr24")))

    pc.on("track", lambda track: asyncio.ensure_future(drain(track)))
    await pc.setLocalDescription(await pc.createOffer())
    while pc.iceGatheringState != "complete":
        await asyncio.sleep(0.05)
    pcm = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", args.audio, "-ac", "1", "-ar", "24000", "-f", "s16le",
                          "-t", str(args.phrase_s), "-"], capture_output=True, check=True).stdout
    marks: list[tuple[float, int]] = []
    async with aiohttp.ClientSession() as http:
        async with http.post(f"{args.url}/atrium/offer",
                             json={"sdp": pc.localDescription.sdp, "type": "offer", "token": args.token}) as r:
            answer = await r.json()
        await pc.setRemoteDescription(RTCSessionDescription(sdp=answer["sdp"], type=answer["type"]))
        ws_url = args.url.replace("http", "ws", 1)
        async with http.ws_connect(f"{ws_url}/atrium/audio",
                                   params={"sessionid": answer["sessionid"], "token": args.token}) as ws:
            while not frames:
                await asyncio.sleep(0.05)
            await asyncio.sleep(1.5)
            for speaker in (0, 1, 2):
                await ws.send_str(f'{{"type": "speaker", "index": {speaker}}}')
                marks.append((loop.time(), speaker))
                await ws.send_bytes(pcm)
                await asyncio.sleep(args.phrase_s + 1.5)
            await asyncio.sleep(1.5)
    stop.set()
    await pc.close()

    base = [cv2.imread(p) for p in sorted(glob.glob(f"{args.frames}/*.png"))]
    small = [cv2.resize(b, (160, 90)).astype(np.float32) for b in base]
    boxes = {int(k): tuple(int(v) for v in rest.split(",")) for k, rest in (b.split("=") for b in args.box)}
    rows = []
    for t, f in frames:
        s = cv2.resize(f, (160, 90)).astype(np.float32)
        i = int(np.argmin([np.abs(s - b).mean() for b in small]))
        rows.append((t, {k: float(np.abs(f[y:y + h, x:x + w].astype(np.float32)
                                         - base[i][y:y + h, x:x + w].astype(np.float32)).mean())
                         for k, (x, y, w, h) in boxes.items()}))
    for n, (start, speaker) in enumerate(marks):
        end = marks[n + 1][0] if n + 1 < len(marks) else start + args.phrase_s + 3
        seg = [d for t, d in rows if start + 0.8 <= t < end]
        means = {k: round(float(np.mean([d[k] for d in seg])), 2) for k in boxes}
        loudest = max(means, key=means.get)
        if args.dump:
            picks = [f for t, f in frames if start + 0.8 <= t < end][::6][:8]
            faces = [(600, 200, 140, 170), (130, 180, 150, 190), (1045, 250, 140, 160)]
            rows_img = [np.hstack([cv2.resize(f[y:y + h, x:x + w], (140, 160)) for f in picks]) for x, y, w, h in faces]
            cv2.imwrite(f"{args.dump}_{speaker}.jpg", np.vstack(rows_img))
        print(f"speaker {speaker} phrase: mouth change per person {means} -> moving: {loudest}"
              f" {'OK' if loudest == speaker else 'WRONG'}")


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--url", default="http://localhost:8010")
    p.add_argument("--token", required=True)
    p.add_argument("--frames", required=True)
    p.add_argument("--audio", required=True)
    p.add_argument("--phrase-s", dest="phrase_s", type=float, default=3.0)
    p.add_argument("--dump", default="", help="save face strips per phrase as <dump>_<speaker>.jpg")
    p.add_argument("--box", action="append", required=True, help="speaker=x,y,w,h of their mouth")
    asyncio.run(run(p.parse_args()))


if __name__ == "__main__":
    main()
