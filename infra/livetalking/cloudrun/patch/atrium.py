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
import subprocess
import sys
import threading
import time

import cv2
import numpy as np
from aiohttp import WSMsgType, web
from scipy.signal import firwin, lfilter

from avatars.audio_features.base_asr import BaseASR
from avatars.base_avatar import AudioFrameData
from server.session_manager import MaxSessionError, session_manager
from utils.image import read_imgs as _upstream_read_imgs
from concurrent.futures import ThreadPoolExecutor

#: Frames read at once when a face is loaded. On Cloud Run the faces sit in Cloud Storage (a mounted bucket)
#: where each file takes ~0.2 s to open, so upstream's CPU-sized pool (8 on 4 vCPUs) needed ~30 s per face and
#: the page gave up waiting. Reading many at once brings a face in within a few seconds; on a local disk
#: it changes nothing.
READ_WORKERS = int(os.environ.get("ATRIUM_READ_WORKERS", "64"))


def read_imgs(img_list):
    """utils.image.read_imgs, with a pool sized for network storage instead of for the CPU count."""
    if len(img_list) < 2:
        return _upstream_read_imgs(img_list)
    with ThreadPoolExecutor(max_workers=READ_WORKERS) as pool:
        return list(pool.map(cv2.imread, img_list))


try:  # the MuseTalk face loader imported upstream's version by name: point it at this one
    import avatars.musetalk_avatar as _musetalk_avatar
    _musetalk_avatar.read_imgs = read_imgs
except Exception:  # noqa: BLE001 - another model: its loader keeps upstream's reader
    pass
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
#: MuseTalk only. Which audio each frame's mouth shape is read from, in 40 ms video frames: positive
#: reads it from later audio, so the mouth moves earlier. Unlike TRIM_MS this leaves the picture and
#: the voice on one clock — the mouth still rests exactly when the voice stops — and only changes the
#: shape. Measured with lip_probe.py against a probe face made from one still frame.
FEAT_SHIFT = int(os.environ.get("ATRIUM_FEAT_SHIFT", "0"))
#: MuseTalk paints the face at 256x256 and upstream scales it back into the frame bilinearly, so the
#: mouth reads softer than the rest of the face. The paste uses Lanczos and this much unsharp mask
#: on the painted face alone (0 turns it off).
SHARPEN = float(os.environ.get("ATRIUM_SHARPEN", "0.6"))
#: The video bitrate aiortc starts at, in kbit/s; it may climb to twice this. Upstream starts VP8 at
#: 500 and caps it at 1500, which smears a 1280x720 close-up of a face.
VIDEO_KBPS = int(os.environ.get("ATRIUM_VIDEO_KBPS", "2500"))
#: The least it may drop to. Chrome's estimate of a link it has only just met (it only hears aiortc's
#: REMB, and aiortc never probes) settles around 700 kbps, which smears the lips at 1280x720 even
#: on a line with room for several times that. A face needs a few Mbps; a line that has less loses
#: packets rather than detail, which is the better failure for a mouth someone is watching.
VIDEO_MIN_KBPS = int(os.environ.get("ATRIUM_VIDEO_MIN_KBPS", "2000"))
AVATAR_ROOT = os.path.join("data", "avatars")
#: How far behind real time the stream plays, so frames are always in hand. The renderer makes a
#: batch at a time (16 frames, 640 ms) at barely more than real time, and runs slower still for a
#: session's first seconds; with nothing in hand every late batch starves Chrome of audio, and
#: Chrome stretches the voice to fill the gap, which is heard as a buzz. Re-established after a stall.
CUSHION_S = float(os.environ.get("ATRIUM_CUSHION_S", "0.4"))
#: The cushion for a face with several people in it (the in-person panel room): its renderer runs as
#: close to real time as any, but the room is where a dip was heard, so it holds a little more.
ROOM_CUSHION_S = float(os.environ.get("ATRIUM_ROOM_CUSHION_S", "0.7"))
#: How far behind the pacing clock a frame may be before the clock is moved rather than caught up.
LATE_RESET_S = float(os.environ.get("ATRIUM_LATE_RESET_S", "0.08"))
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

#: Scale to zero: with no face streaming and nobody holding the server up for this many seconds,
#: the VM powers itself off (0 = never). The API starts it again when a candidate begins setting
#: up a session, and holds it up (`/atrium/health?hold=<token>`) while they are on their way in.
IDLE_STOP_S = float(os.environ.get("ATRIUM_IDLE_STOP_S", "0"))
#: Faces to load into memory right after start-up, besides the default one (comma-separated).
#: LiveTalking otherwise reads a face's frames and latents from disk inside the first offer for
#: it, which holds that candidate's picture back by seconds.
PRELOAD = [a.strip() for a in os.environ.get("ATRIUM_PRELOAD", "").split(",") if a.strip()]

#: A face opened by /atrium/offer whose page never connects its audio socket within this many
#: seconds (the app closed during set-up) is closed, so it neither holds a slot nor keeps the VM up.
UNATTACHED_S = float(os.environ.get("ATRIUM_UNATTACHED_S", "120"))

_owners: dict[str, str] = {}  # sessionid -> avatar id it was opened for
_opened: dict[str, float] = {}  # sessionid -> when it was opened, until its audio socket attaches
_last_active = time.monotonic()
_preloaded: list[str] = []
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
        face = getattr(player, "_HumanPlayer__container", None)
        cushion = ROOM_CUSHION_S if getattr(face, "_faces", None) else CUSHION_S
        epoch = getattr(player, "_atrium_epoch", None)
        if epoch is None:
            epoch = player._atrium_epoch = time.time() - media + cushion
        wait = epoch + media - time.time()
        if wait < -LATE_RESET_S:
            # The renderer fell behind (a session's first seconds run below 25 fps). Sending the
            # backlog at once to catch up is a burst, and Chrome answers a burst by growing its
            # jitter buffers — by different amounts for sound and picture, so the lips drift off the
            # voice and stay off. Moving the shared epoch instead delays both tracks by the stall,
            # together, and pacing carries on smoothly from here.
            epoch = player._atrium_epoch = time.time() - media + cushion
            wait = cushion
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


def _shift_features() -> None:
    """Read each frame's mouth shape FEAT_SHIFT frames later in the audio (see FEAT_SHIFT)."""
    if not FEAT_SHIFT:
        return
    try:
        from avatars.audio_features.whisper import WhisperASR
    except ImportError:  # not a MuseTalk build
        return
    original = WhisperASR._feature2chunks

    def shifted(self, feature_array, batch_size, audio_feat_win=[8, 8], start=0, feature_idx_multiplier=1.0):
        return original(self, feature_array, batch_size, audio_feat_win, start + FEAT_SHIFT, feature_idx_multiplier)

    WhisperASR._feature2chunks = shifted


def _sharpen_paste() -> None:
    """Paste the painted face back with Lanczos and a light unsharp mask (see SHARPEN)."""
    try:
        from avatars import musetalk_avatar
    except ImportError:  # not a MuseTalk build
        return

    def paste_back_frame(self, pred_frame, idx: int):
        # Whose face this frame's mouth belongs to, on a face with several speakers (_multi_speaker).
        faces = getattr(self, "_faces", None)
        if faces:
            coords, masks, mask_coords, _ = faces[getattr(pred_frame, "speaker", 0)]
        else:
            coords, masks, mask_coords = self.coord_list_cycle, self.mask_list_cycle, self.mask_coords_list_cycle
        bbox = coords[idx]
        ori_frame = self.frame_list_cycle[idx].copy()
        x1, y1, x2, y2 = bbox
        res_frame = cv2.resize(pred_frame.astype(np.uint8), (x2 - x1, y2 - y1), interpolation=cv2.INTER_LANCZOS4)
        if SHARPEN > 0:
            blur = cv2.GaussianBlur(res_frame, (0, 0), 1.2)
            res_frame = cv2.addWeighted(res_frame, 1 + SHARPEN, blur, -SHARPEN, 0)
        return musetalk_avatar.get_image_blending(ori_frame, res_frame, bbox, masks[idx], mask_coords[idx])

    musetalk_avatar.MuseReal.paste_back_frame = paste_back_frame


#: Where a face with several people in it keeps the others: data/avatars/<id>/speakers/<n>/ holds
#: coords.pkl, mask_coords.pkl, latents.pt and mask/ for person n, prepared from the same clip. The
#: face's own files are person 0. One stream shows the whole room; the page says who is speaking.
SPEAKERS_DIR = "speakers"
_speaker_cache: dict[str, list] = {}


def _load_speakers(avatar: str) -> list:
    if avatar in _speaker_cache:
        return _speaker_cache[avatar]
    import pickle

    import torch

    root = os.path.join(AVATAR_ROOT, avatar, SPEAKERS_DIR)
    faces = []
    for name in sorted(os.listdir(root), key=int) if os.path.isdir(root) else []:
        d = os.path.join(root, name)
        with open(os.path.join(d, "coords.pkl"), "rb") as f:
            coords = pickle.load(f)
        with open(os.path.join(d, "mask_coords.pkl"), "rb") as f:
            mask_coords = pickle.load(f)
        masks = read_imgs(sorted(glob.glob(os.path.join(d, "mask", "*.png")),
                                 key=lambda p: int(os.path.splitext(os.path.basename(p))[0])))
        faces.append((coords, masks, mask_coords, torch.load(os.path.join(d, "latents.pt"))))
    _speaker_cache[avatar] = faces
    return faces


def _multi_speaker() -> None:
    """One face, several people: each batch's mouth is painted on whoever its audio belongs to.

    The page tags every chunk of audio with the speaker (`{"type": "speaker", "index": n}` on the
    audio socket). The inference thread picks the batch's speaker from the chunks it just took and
    runs that person's latents, and every frame it makes carries that choice, so the paste thread
    pastes it on the face it was made for. (Not a queue beside the frames: frames of a speaking batch
    that fall on silence are never pasted, and a queue would slip one person onto another's face.)
    """
    try:
        from avatars import musetalk_avatar
    except ImportError:
        return
    from collections import Counter

    class Painted(np.ndarray):
        """A generated face, with whose it is."""

        speaker = 0

    cls = musetalk_avatar.MuseReal
    init, infer = cls.__init__, cls.inference_batch

    def __init__(self, opt, model, avatar):
        init(self, opt, model, avatar)
        extra = _load_speakers(str(getattr(opt, "avatar_id", "")))
        if not extra:
            return
        own = (self.coord_list_cycle, self.mask_list_cycle, self.mask_coords_list_cycle, self.input_latent_list_cycle)
        self._faces = [own, *extra]
        self._votes = []
        take = self.asr.output_queue.get

        def get(*args, **kwargs):
            frame = take(*args, **kwargs)
            if frame.type == 0:
                self._votes.append(int((frame.userdata or {}).get("speaker", 0)))
            return frame

        self.asr.output_queue.get = get

    def inference_batch(self, index, audiofeat_batch):
        faces = getattr(self, "_faces", None)
        if faces:
            votes, self._votes = self._votes, []
            speaker = Counter(votes).most_common(1)[0][0] if votes else getattr(self, "_speaker", 0)
            speaker = speaker if 0 <= speaker < len(faces) else 0
            self._speaker = speaker
            self.input_latent_list_cycle = faces[speaker][3]
        pred = infer(self, index, audiofeat_batch)
        if not faces:
            return pred
        painted = []
        for frame in pred:
            frame = np.asarray(frame).view(Painted)
            frame.speaker = self._speaker
            painted.append(frame)
        return painted

    cls.__init__ = __init__
    cls.inference_batch = inference_batch


def _raise_bitrate() -> None:
    """Start the video encoders at VIDEO_KBPS and never below VIDEO_MIN_KBPS (see both)."""
    from aiortc.codecs import h264, vpx

    for codec in (vpx, h264):
        codec.DEFAULT_BITRATE = VIDEO_KBPS * 1000
        codec.MIN_BITRATE = VIDEO_MIN_KBPS * 1000
        codec.MAX_BITRATE = max(codec.MAX_BITRATE, VIDEO_KBPS * 2000)


_align_lips()
_stamp_frames()
_shift_features()
_sharpen_paste()
_multi_speaker()
_raise_bitrate()


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

    from aiortc import RTCSessionDescription
    rtc = request.app["rtc_manager"]
    try:
        sessionid = await session_manager.create_session(_session_params(avatar))
    except MaxSessionError as e:
        return web.json_response({"code": 503, "msg": str(e)}, status=503)
    pc = await rtc._create_pc_and_answer(
        session_manager.get_session(sessionid), sessionid,
        RTCSessionDescription(sdp=params["sdp"], type=params["type"]),
    )
    _owners[sessionid] = avatar
    _opened[sessionid] = time.monotonic()
    _touch()
    logger.info("atrium offer sessionid=%s avatar=%s", sessionid, avatar)
    return web.json_response({"sdp": pc.localDescription.sdp, "type": pc.localDescription.type, "sessionid": sessionid})


def _session_params(avatar: str) -> dict:
    session_params = {"avatar": avatar}
    listening = _state_dir(avatar, "listening")
    if listening:
        # Writing notes is the default silent clip; other states are swapped in on request.
        session_params["custom_config"] = json.dumps([{"audiotype": SILENT, "imgpath": listening}])
    return session_params


# ── Cloud Run ────────────────────────────────────────────────────────────────────────────────────
# On Cloud Run the offer and the audio must travel on ONE connection: two requests may be routed to
# two different instances, and only one of them would hold the face. And there is no inbound UDP, so
# the video goes through the TURN relay the page already uses (Cloudflare, TLS on 443): the page sends
# its ICE servers with the offer and both ends meet at the relay. /atrium/offer + /atrium/audio stay
# exactly as they were for the VMs.

#: Preferred relay URLs, best first: TLS on 443 passes every firewall, and TCP is what Cloud Run egress
#: is sure to carry. aiortc uses a single TURN server, so exactly one URL is kept.
_RELAY_ORDER = ("turns:", "transport=tcp", "turn:")


def _relay_server(ice_servers):
    """The one TURN server (with its credentials) aiortc should use, picked from the page's list."""
    from aiortc import RTCIceServer
    candidates = []
    for server in ice_servers if isinstance(ice_servers, list) else []:
        if not isinstance(server, dict) or not server.get("username"):
            continue
        urls = server.get("urls")
        for url in [urls] if isinstance(urls, str) else list(urls or []):
            if isinstance(url, str) and url.startswith(("turn:", "turns:")):
                rank = next((i for i, key in enumerate(_RELAY_ORDER) if key in url), len(_RELAY_ORDER))
                if url.startswith("turns:") and ":443" in url:
                    rank = -1
                candidates.append((rank, url, server))
    if not candidates:
        return None
    _, url, server = min(candidates, key=lambda c: c[0])
    return RTCIceServer(urls=url, username=server["username"], credential=server.get("credential", ""))


async def _relayed_pc(rtc, avatar_session, sessionid, offer, relay):
    """rtc_manager._create_pc_and_answer, with the relay as the peer's ICE server."""
    from aiortc import RTCConfiguration, RTCIceServer, RTCPeerConnection, RTCRtpSender
    from server.webrtc import HumanPlayer

    servers = [RTCIceServer(urls=rtc.opt.stun)] + ([relay] if relay else [])
    pc = RTCPeerConnection(configuration=RTCConfiguration(iceServers=servers))
    rtc.pcs.add(pc)

    @pc.on("connectionstatechange")
    async def on_connectionstatechange():
        logger.info("Connection state is %s", pc.connectionState)
        if pc.connectionState in ("failed", "closed"):
            await pc.close()
            rtc.pcs.discard(pc)
            session_manager.remove_session(sessionid)

    player = HumanPlayer(avatar_session)
    pc.addTrack(player.audio)
    pc.addTrack(player.video)
    capabilities = RTCRtpSender.getCapabilities("video")
    preferences = [c for c in capabilities.codecs if c.name == "H264"]
    preferences += [c for c in capabilities.codecs if c.name == "VP8"]
    preferences += [c for c in capabilities.codecs if c.name == "rtx"]
    pc.getTransceivers()[1].setCodecPreferences(preferences)
    await pc.setRemoteDescription(offer)
    await pc.setLocalDescription(await pc.createAnswer())
    return pc


async def session(request):
    """One face over one WebSocket: {offer, iceServers} in, {answer} out, then the audio as /atrium/audio."""
    avatar = verify(request.query.get("token", ""), request.app["opt"].avatar_id)
    if avatar is None or not _safe_avatar(avatar):
        return web.json_response({"code": 401, "msg": "invalid token"}, status=401)
    ws = web.WebSocketResponse(heartbeat=30)
    await ws.prepare(request)
    try:
        first = await ws.receive(timeout=30)
        message = json.loads(first.data) if first.type == WSMsgType.TEXT else {}
    except (asyncio.TimeoutError, ValueError):
        message = {}
    if message.get("type") != "offer" or not message.get("sdp"):
        await ws.close(code=4400, message=b"expected an offer")
        return ws

    from aiortc import RTCSessionDescription
    rtc = request.app["rtc_manager"]
    try:
        sessionid = await session_manager.create_session(_session_params(avatar))
    except MaxSessionError:
        await ws.send_json({"type": "busy"})
        await ws.close(code=4503, message=b"busy")
        return ws
    avatar_session = session_manager.get_session(sessionid)
    try:
        pc = await _relayed_pc(rtc, avatar_session, sessionid,
                               RTCSessionDescription(sdp=message["sdp"], type="offer"),
                               _relay_server(message.get("iceServers")))
    except Exception:  # noqa: BLE001 - a peer that cannot be built frees the slot for the next page
        logger.exception("atrium session could not answer")
        session_manager.remove_session(sessionid)
        await ws.close(code=4500, message=b"no answer")
        return ws
    _owners[sessionid] = avatar
    _opened[sessionid] = time.monotonic()
    _touch()
    logger.info("atrium session sessionid=%s avatar=%s", sessionid, avatar)
    try:
        await ws.send_json({"type": "answer", "sdp": pc.localDescription.sdp, "sessionid": sessionid})
    except Exception:  # noqa: BLE001 - the page left before the answer: close its face now
        _close_face(sessionid)
        return ws
    return await _pump(ws, avatar_session, sessionid, avatar)


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
    return await _pump(ws, avatar_session, sessionid, avatar)


async def _pump(ws, avatar_session, sessionid, avatar):
    """The page's voice and commands for one face, until the page closes the socket."""
    chunk = avatar_session.chunk
    resample = Resampler()
    gate = MouthGate()
    speaker = 0  # who the audio belongs to, on a face with several people (_multi_speaker)
    _opened.pop(sessionid, None)  # attached: from here the socket's own heartbeat ends a dead page
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
                        AudioFrameData(data=piece, type=gate.audiotype(piece), userdata={"speaker": speaker})
                    )
                resample.rest = samples[usable:]
            elif msg.type == WSMsgType.TEXT:
                command = json.loads(msg.data)
                if command.get("type") == "interrupt":
                    avatar_session.flush_talk()
                    resample.rest = np.zeros(0, dtype=np.float32)
                    gate.reset()
                elif command.get("type") == "speaker":
                    speaker = int(command.get("index", 0))
                elif command.get("type") == "state":
                    _set_state(avatar_session, avatar, str(command.get("state", "")))
            elif msg.type == WSMsgType.ERROR:
                break
    finally:
        # The page closed the socket: the face goes with it.
        _close_face(sessionid)
    return ws


def _close_face(sessionid: str) -> None:
    _owners.pop(sessionid, None)
    _opened.pop(sessionid, None)
    try:
        session_manager.remove_session(sessionid)
    except Exception:  # noqa: BLE001 - already gone
        logger.exception("atrium could not remove session %s", sessionid)
    _touch()


def _close_unattached() -> None:
    """Close faces whose page never connected its audio socket (see UNATTACHED_S)."""
    now = time.monotonic()
    for sessionid, opened in list(_opened.items()):
        if now - opened >= UNATTACHED_S:
            logger.info("atrium closing sessionid=%s: no audio socket after %.0f s", sessionid, now - opened)
            _close_face(sessionid)


async def _reap_unattached(_app) -> None:
    while True:
        await asyncio.sleep(30)
        _close_unattached()


def _touch() -> None:
    global _last_active
    _last_active = time.monotonic()


async def health(request):
    hold = request.query.get("hold")
    if hold and verify(hold, "") is not None:
        _touch()
    return web.json_response({"ok": True, "sessions": len(_owners), "preloaded": _preloaded})


def _someone_logged_in() -> bool:
    try:
        return bool(subprocess.run(["who"], capture_output=True, text=True, timeout=5).stdout.strip())
    except (OSError, subprocess.SubprocessError):
        return False


async def _stop_when_idle(_app) -> None:
    while True:
        await asyncio.sleep(15)
        # A face streaming, or someone at work on the VM itself (preparing a face over SSH).
        if _owners or _someone_logged_in():
            _touch()
            continue
        idle = time.monotonic() - _last_active
        if idle >= IDLE_STOP_S:
            logger.info("atrium idle for %.0f s: powering off", idle)
            subprocess.Popen(["systemctl", "poweroff"])
            return


def _preload_faces() -> None:
    # app.py runs as __main__, so its avatar cache is reached there, not by importing `app`.
    main = sys.modules["__main__"]
    cache, load = getattr(main, "global_avatars", None), getattr(main, "load_avatar", None)
    if cache is None or load is None:
        return
    for avatar in PRELOAD:
        if avatar in cache or not _safe_avatar(avatar):
            continue
        try:
            cache[avatar] = load(avatar)
            _preloaded.append(avatar)
            logger.info("atrium preloaded %s", avatar)
        except Exception:  # noqa: BLE001 - a face that fails to load still loads on its first offer
            logger.exception("atrium could not preload %s", avatar)


async def _start_background(app) -> None:
    if PRELOAD:
        threading.Thread(target=_preload_faces, name="atrium-preload", daemon=True).start()
    app["atrium_reaper"] = asyncio.get_running_loop().create_task(_reap_unattached(app))
    if IDLE_STOP_S > 0:
        app["atrium_idle"] = asyncio.get_running_loop().create_task(_stop_when_idle(app))


def setup_atrium_routes(app):
    app.router.add_post("/atrium/offer", offer)
    app.router.add_get("/atrium/audio", audio)
    app.router.add_get("/atrium/session", session)
    app.router.add_get("/atrium/health", health)
    app.on_startup.append(_start_background)
