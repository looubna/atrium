###############################################################################
#  Atrium bridge: the interview app drives a face with its own voice.
#
#  POST /atrium/offer   WebRTC offer; the avatar comes from a signed token, never from the client.
#  GET  /atrium/audio   WebSocket. Binary messages: 24 kHz mono PCM16 (the interviewer's speech).
#                       Text messages (JSON): {"type": "interrupt"} drops queued speech,
#                       {"type": "state", "state": "listening" | "neutral" | ...} picks the silent clip.
#
#  Silent clips live next to the avatar: data/avatars/<id>/states/<state>/00000000.png ...
#  "listening" is the interviewer writing notes while the candidate answers. While speaking,
#  the avatar's own frames are lip-synced to exactly the audio the candidate hears.
#
#  ATRIUM_SECRET set: tokens are required (HMAC-SHA256 of "<avatar>.<expiry>").
#  ATRIUM_SECRET unset: local testing only, any avatar id is accepted.
###############################################################################

import asyncio
import base64
import glob
import hashlib
import hmac
import json
import os
import queue
import time

import numpy as np
from aiohttp import WSMsgType, web
from scipy.signal import firwin, lfilter

from avatars.audio_features.base_asr import BaseASR
from avatars.base_avatar import AudioFrameData
from server.session_manager import MaxSessionError, session_manager
from utils.image import read_imgs
from utils.logger import logger

SECRET = os.environ.get("ATRIUM_SECRET", "").encode()
#: Frames of audio (20 ms each) to let go of at start-up so the voice lines up with the lips.
#: Upstream keeps the model's right-hand context in the audio queue, which makes the mouth run
#: ahead of the sound; ATRIUM_LIP_ALIGN tunes it (0 restores upstream's behaviour).
LIP_ALIGN_FRAMES = int(os.environ.get("ATRIUM_LIP_ALIGN", "10"))
#: A signed trim on the video timeline, in milliseconds; positive holds the picture back. Once
#: both tracks are stamped from one clock what is left is the model's own look-ahead — the video
#: pulled out of res_frame_queue is not the lip shape for the audio pulled out beside it, and
#: warm_up above can only correct the first stride_left + stride_right frames of that before it
#: runs out of queue. Unlike the drift this replaces, it is a property of the model and its
#: stride settings, not of how fast the machine renders, so one measured value holds.
#: Re-measure with measure_lag.py after changing --model, --batch_size, or opt.l/opt.r.
#:
#: UNCALIBRATED, deliberately 0. It cannot be measured until an interviewer has a base clip
#: whose mouth is actually still — every evelyn* clip talks through its own loop, which swamps
#: the lip-sync signal measure_lag.py reads (see "Silent mouthing" in the README). As a sanity
#: bound when it can be measured: the model only looks ahead opt.r frames, 10 x 20 ms = 200 ms,
#: and warm_up above already pulls the audio forward by all of it, so expect a small number.
TRIM_MS = float(os.environ.get("ATRIUM_TRIM_MS", "0"))
AVATAR_ROOT = os.path.join("data", "avatars")
SILENT = 1  # LiveTalking's audiotype for silence
#: An audiotype with no clip bound to it, so LiveTalking falls back to the avatar's own frames:
#: mouth closed, head and hands still moving. That is what the interviewer should do during a
#: pause in her own speech — SILENT would cut to the notes clip, which is a jump mid-sentence.
RESTING = 2
#: A pause in the interviewer's speech this long stops the mouth. Roughly a fifth of a Gemini Live
#: turn is silence, in runs of up to ~600 ms; lip-syncing it is what makes the face mouth words to
#: an empty room after the voice has stopped. Shorter gaps stay "speech" so the mouth never twitches
#: between words. In 20 ms frames.
SILENCE_HOLD = int(os.environ.get("ATRIUM_SILENCE_HOLD", "8"))
#: Below this RMS a frame carries no voice. Gemini's silence is digital zero; the margin is for
#: faint room tone in a recorded voice.
SILENCE_RMS = float(os.environ.get("ATRIUM_SILENCE_RMS", "0.005"))

_owners: dict[str, str] = {}  # sessionid -> avatar id it was opened for
_state_frames: dict[tuple[str, str], list] = {}


def _align_lips() -> None:
    """Drop the warm-up audio the model is still looking ahead at, so lips and voice agree."""

    def warm_up(self) -> None:
        for _ in range(self.stride_left_size + self.stride_right_size):
            audio_frame = self.get_audio_frame()
            self.frames.append(audio_frame.data)
            self.output_queue.put(audio_frame)
        ahead = min(self.stride_left_size + LIP_ALIGN_FRAMES, self.output_queue.qsize())
        for _ in range(ahead):
            self.output_queue.get()

    BaseASR.warm_up = warm_up


def _stamp_frames() -> None:
    """Give both tracks a presentation timestamp from one clock, taken where they are produced.

    Upstream stamps a frame when it is *pulled*, from a counter that ticks once per call:
    `next_timestamp` adds exactly one frame period however long `recv` waited for the queue. So
    whenever inference falls behind real time the video track loses ground the audio track never
    loses — the offset is a function of how fast the box renders, and no fixed correction can
    follow it. That is what the frame-counting delay line used to paper over.

    `process_frames` pushes a video frame and the 640 audio samples it was inferred from in the
    same breath, so the pairing is already exact there. Stamping at that point, from the content
    rather than the wall clock, makes the two timelines advance together by construction: video
    counts 40 ms a frame, audio counts its own samples, and 640 samples at 16 kHz is 40 ms. A
    stalled renderer then delivers a late frame that still says when it belonged, which is
    precisely what a player needs to keep the mouth on the voice.
    """
    from server.webrtc import (
        AUDIO_TIME_BASE,
        SAMPLE_RATE,
        VIDEO_CLOCK_RATE,
        VIDEO_PTIME,
        VIDEO_TIME_BASE,
        HumanPlayer,
        PlayerStreamTrack,
    )

    def push_video(self, frame) -> None:
        from av import VideoFrame

        media = getattr(self, "_atrium_video_s", 0.0)
        self._atrium_video_s = media + VIDEO_PTIME
        self._HumanPlayer__video._queue.put((VideoFrame.from_ndarray(frame, format="bgr24"), None, media + TRIM_MS / 1000.0))

    def push_audio(self, frame, eventpoint=None) -> None:
        from av import AudioFrame

        new_frame = AudioFrame(format="s16", layout="mono", samples=frame.shape[0])
        new_frame.planes[0].update(frame.tobytes())
        new_frame.sample_rate = SAMPLE_RATE
        media = getattr(self, "_atrium_audio_s", 0.0)
        self._atrium_audio_s = media + frame.shape[0] / SAMPLE_RATE
        self._HumanPlayer__audio._queue.put((new_frame, eventpoint, media))

    async def recv(self):
        self._player._start(self)
        while True:
            try:
                frame, eventpoint, media = self._queue.get_nowait()
                break
            except queue.Empty:
                await asyncio.sleep(0.005)

        # One epoch per session, set by whichever track is pulled first, so both are paced
        # against the same origin instead of each starting its own.
        player = self._player
        epoch = getattr(player, "_atrium_epoch", None)
        if epoch is None:
            epoch = player._atrium_epoch = time.time() - media
        wait = epoch + media - time.time()
        if wait > 0:
            await asyncio.sleep(wait)

        if self.kind == "video":
            frame.pts, frame.time_base = round(media * VIDEO_CLOCK_RATE), VIDEO_TIME_BASE
        else:
            frame.pts, frame.time_base = round(media * SAMPLE_RATE), AUDIO_TIME_BASE
        if eventpoint and player is not None:
            player.notify(eventpoint)
        if self.kind == "video":  # upstream's "actual avg final fps" line, kept
            self.totaltime += time.perf_counter() - self.lasttime
            self.framecount += 1
            self.lasttime = time.perf_counter()
            if self.framecount == 100:
                logger.info(f"------actual avg final fps:{self.framecount / self.totaltime:.4f}")
                self.framecount, self.totaltime = 0, 0
        return frame

    HumanPlayer.push_video = push_video
    HumanPlayer.push_audio = push_audio
    PlayerStreamTrack.recv = recv


_align_lips()
_stamp_frames()


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def sign(avatar: str, ttl_s: int = 900) -> str:
    """The same token the app backend mints (kept here for tests)."""
    expiry = str(int(time.time()) + ttl_s)
    mac = hmac.new(SECRET, f"{avatar}.{expiry}".encode(), hashlib.sha256).digest()
    return f"{avatar}.{expiry}.{_b64(mac)}"


def verify(token: str, fallback_avatar: str) -> str | None:
    """The avatar id a token grants, or None."""
    if not SECRET:
        return (token or "").split(".")[0] or fallback_avatar
    try:
        avatar, expiry, mac = token.rsplit(".", 2)
    except ValueError:
        return None
    good = _b64(hmac.new(SECRET, f"{avatar}.{expiry}".encode(), hashlib.sha256).digest())
    if not hmac.compare_digest(good, mac) or int(expiry) < time.time():
        return None
    return avatar


def _safe_avatar(avatar: str) -> bool:
    return bool(avatar) and os.path.basename(avatar) == avatar and os.path.isdir(os.path.join(AVATAR_ROOT, avatar))


def _state_dir(avatar: str, state: str) -> str | None:
    if os.path.basename(state) != state:
        return None
    path = os.path.join(AVATAR_ROOT, avatar, "states", state)
    return path if glob.glob(os.path.join(path, "*.png")) or glob.glob(os.path.join(path, "*.jpg")) else None


def _frames(avatar: str, state: str):
    key = (avatar, state)
    if key not in _state_frames:
        path = _state_dir(avatar, state)
        files = glob.glob(os.path.join(path, "*.[jpJP][pnPN]*[gG]"))
        files.sort(key=lambda f: int(os.path.splitext(os.path.basename(f))[0]))
        _state_frames[key] = read_imgs(files)
    return _state_frames[key]


async def offer(request):
    params = await request.json()
    avatar = verify(params.get("token", ""), request.app["opt"].avatar_id)
    if avatar is None or not _safe_avatar(avatar):
        return web.json_response({"code": 401, "msg": "invalid token"}, status=401)

    session_params = {"avatar": avatar}
    listening = _state_dir(avatar, "listening")
    if listening:
        # Writing notes is the default silent clip; other states are swapped in on request.
        session_params["custom_config"] = json.dumps([{"audiotype": SILENT, "imgpath": listening}])

    from aiortc import RTCSessionDescription
    rtc = request.app["rtc_manager"]
    try:
        sessionid = await session_manager.create_session(session_params)
    except MaxSessionError as e:
        return web.json_response({"code": 503, "msg": str(e)}, status=503)
    pc = await rtc._create_pc_and_answer(
        session_manager.get_session(sessionid), sessionid,
        RTCSessionDescription(sdp=params["sdp"], type=params["type"]),
    )
    _owners[sessionid] = avatar
    logger.info("atrium offer sessionid=%s avatar=%s", sessionid, avatar)
    return web.json_response({"sdp": pc.localDescription.sdp, "type": pc.localDescription.type, "sessionid": sessionid})


class Resampler:
    """24 kHz -> 16 kHz (up 2, low-pass, down 3), continuous across chunks."""

    def __init__(self):
        self.taps = firwin(97, 7600, fs=48000) * 2
        self.zi = np.zeros(len(self.taps) - 1)
        self.phase = 0
        self.rest = np.zeros(0, dtype=np.float32)

    def __call__(self, pcm16: bytes) -> np.ndarray:
        x = np.frombuffer(pcm16[: len(pcm16) // 2 * 2], dtype="<i2").astype(np.float64) / 32768.0
        up = np.zeros(len(x) * 2)
        up[::2] = x
        y, self.zi = lfilter(self.taps, 1.0, up, zi=self.zi)
        out = y[self.phase::3]
        self.phase = (self.phase - len(y)) % 3
        return np.concatenate([self.rest, out.astype(np.float32)])


class MouthGate:
    """Whether a 20 ms chunk of the interviewer's speech should drive her mouth.

    The audio is queued either way and the candidate hears every pause exactly as it was
    spoken — only the picture changes. Without this the model lip-syncs silence, and the face
    carries on mouthing through every gap in the turn and past its end.
    """

    def __init__(self) -> None:
        self.quiet = 0

    def reset(self) -> None:
        self.quiet = 0

    def audiotype(self, chunk: np.ndarray) -> int:
        if float(np.sqrt(np.mean(chunk.astype(np.float32) ** 2))) >= SILENCE_RMS:
            self.quiet = 0
            return 0
        self.quiet += 1
        return RESTING if self.quiet > SILENCE_HOLD else 0


def _set_state(avatar_session, avatar: str, state: str):
    if not _state_dir(avatar, state):
        # No clip for this state: the avatar's own frames, as while speaking.
        avatar_session.custom_index.pop(SILENT, None)
        return
    avatar_session.custom_img_cycle[SILENT] = _frames(avatar, state)
    avatar_session.custom_index[SILENT] = 0


async def audio(request):
    sessionid = request.query.get("sessionid", "")
    avatar = verify(request.query.get("token", ""), request.app["opt"].avatar_id)
    avatar_session = session_manager.get_session(sessionid)
    if avatar is None or avatar_session is None or _owners.get(sessionid) != avatar:
        return web.json_response({"code": 401, "msg": "invalid session"}, status=401)

    ws = web.WebSocketResponse(heartbeat=30)
    await ws.prepare(request)
    chunk = avatar_session.chunk
    resample = Resampler()
    gate = MouthGate()
    try:
        async for msg in ws:
            if msg.type == WSMsgType.BINARY:
                samples = resample(msg.data)
                usable = len(samples) // chunk * chunk
                for i in range(0, usable, chunk):
                    piece = samples[i:i + chunk]
                    # Queued directly rather than through put_audio_frame, which would stamp
                    # every chunk as speech and set the mouth going through the pauses too.
                    avatar_session.asr.queue.put(
                        AudioFrameData(data=piece, type=gate.audiotype(piece), userdata={})
                    )
                resample.rest = samples[usable:]
            elif msg.type == WSMsgType.TEXT:
                command = json.loads(msg.data)
                if command.get("type") == "interrupt":
                    avatar_session.flush_talk()
                    resample.rest = np.zeros(0, dtype=np.float32)
                    gate.reset()
                elif command.get("type") == "state":
                    _set_state(avatar_session, avatar, str(command.get("state", "")))
            elif msg.type == WSMsgType.ERROR:
                break
    finally:
        # The page closed the socket: the face goes with it.
        _owners.pop(sessionid, None)
        session_manager.remove_session(sessionid)
    return ws


async def health(_request):
    return web.json_response({"ok": True})


def setup_atrium_routes(app):
    app.router.add_post("/atrium/offer", offer)
    app.router.add_get("/atrium/audio", audio)
    app.router.add_get("/atrium/health", health)
