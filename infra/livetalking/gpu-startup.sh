#!/bin/bash
# Boots the face server on a GPU VM made from the `musetalk` image family (MuseTalk v1.5, its
# weights and a Python 3.10 env in /opt/mt; see scratch/musetalk-test for how it was built).
# First boot: clone LiveTalking, add our bridge, build Evelyn's face. Every boot: serve.
#
# Instance metadata: startup-script (this file), atrium-py (atrium.py), forward-loop-py (forward-loop.py), routes-patch
# (routes.patch), atrium-secret (same as LIVETALKING_SECRET in the API's environment), and optionally
# atrium-idle-stop-s (default 900) and atrium-preload (faces to load at start-up, e.g. "william,nw_marketing").
set -euxo pipefail
exec >> /var/log/livetalking-setup.log 2>&1

UPSTREAM=b3e7490a20e7a6330492f8a6ea8200a5d50279d1
LT=/opt/LiveTalking
export PATH=/opt/mt/bin:$PATH
md() { curl -sf -H 'Metadata-Flavor: Google' "http://metadata.google.internal/computeMetadata/v1/instance/attributes/$1"; }

if [ ! -f "$LT/.atrium-ready" ]; then
  [ -d "$LT" ] || git clone https://github.com/lipku/LiveTalking.git "$LT"
  cd "$LT"
  git checkout -f "$UPSTREAM"

  # Our endpoints and lip alignment.
  md atrium-py > server/atrium.py
  md routes-patch > /tmp/routes.patch
  git apply /tmp/routes.patch

  # LiveTalking's server packages, without disturbing what MuseTalk pinned.
  cat > /tmp/pins.txt <<'PINS'
torch==2.0.1
torchvision==0.15.2
torchaudio==2.0.2
numpy==1.23.5
transformers==4.39.2
diffusers==0.30.2
accelerate==0.28.0
huggingface_hub==0.30.2
mmcv==2.0.1
PINS
  python -m pip install --no-input -c /tmp/pins.txt aiortc aiohttp aiohttp_cors resampy python-dotenv \
    soundfile==0.12.1 einops librosa opencv-python-headless websockets==12.0 flask edge_tts openai dashscope

  # The weights MuseTalk's own setup downloaded.
  for m in musetalkV15 sd-vae whisper dwpose face-parse-bisent; do ln -sfn "/opt/MuseTalk/models/$m" "models/$m"; done

  # Cross-fade the silent<->speaking cut. Upstream writes this blend and then ships it switched
  # off, so the picture hard-cuts the moment the voice starts: the mouth pops open on one frame,
  # and the swap from the notes clip to the base clip lands in the same frame. Both are visible.
  # A sed rather than a patch because it is one word on a line that moves between upstream
  # commits. Idempotent: on a re-run the pattern no longer matches and nothing changes.
  sed -i 's/^\( *\)enable_transition = False/\1enable_transition = True/' avatars/base_avatar.py
  grep -q 'enable_transition = True' avatars/base_avatar.py || { echo "transition patch missed"; exit 1; }

  # Faces marked `loop_forward` loop their clip forward instead of forward-then-backward, so
  # people moving in the background never walk in reverse (forward-loop.py).
  md forward-loop-py > /tmp/forward-loop.py && /opt/mt/bin/python /tmp/forward-loop.py

  # Evelyn listening, mouth closed, 25 fps: the canvas the lips are painted on. The image's
  # MuseTalk test already prepared her in the layout LiveTalking loads (frames, masks,
  # coords, latents); LiveTalking's own genavatar would need face_recognition (dlib) for
  # the same result.
  mkdir -p data/avatars/evelyn
  src=/opt/MuseTalk/results/v15/avatars/evelyn
  cp -r "$src/full_imgs" "$src/mask" "$src/coords.pkl" "$src/mask_coords.pkl" "$src/latents.pt" \
    "$src/avator_info.json" data/avatars/evelyn/
  touch "$LT/.atrium-ready"
fi

# Every boot, as fast as possible: the API starts this VM the moment a candidate opens a session's
# setup, and stops nothing -- the server powers the VM off itself once idle (ATRIUM_IDLE_STOP_S).
# The service is enabled, so systemd has already started it by the time this script runs. It is
# restarted only when something below actually changed: an unconditional restart here killed the
# model load already under way and paid for it twice (~35 s of every cold start).
changed=0
install_if_changed() {  # <new file> <destination>
  if ! cmp -s "$1" "$2"; then install -m "${3:-644}" "$1" "$2"; changed=1; fi
}

cat > /tmp/atrium-face.env <<ENV
ATRIUM_SECRET=$(md atrium-secret)
# Measured with lip_probe.py for MuseTalk v1.5 at batch 16, -l/-r 10: the mouth otherwise lands ~320 ms late.
ATRIUM_FEAT_SHIFT=7
# Power off after this long with no face streaming and nobody holding the server up.
ATRIUM_IDLE_STOP_S=$(md atrium-idle-stop-s || echo 900)
# Faces read into memory straight after start-up, so no candidate's first frame waits on the disk.
ATRIUM_PRELOAD=$(md atrium-preload || true)
ENV
install_if_changed /tmp/atrium-face.env /etc/atrium-face.env 600

cat > /tmp/livetalking.service <<UNIT
[Unit]
Description=LiveTalking face server (MuseTalk)
After=network-online.target

[Service]
WorkingDirectory=$LT
EnvironmentFile=/etc/atrium-face.env
ExecStart=/opt/mt/bin/python app.py --transport webrtc --model musetalk --avatar_id evelyn --listenport 8010 --max_session 4 --stun stun:stun.l.google.com:19302
Restart=always

[Install]
WantedBy=multi-user.target
UNIT
install_if_changed /tmp/livetalking.service /etc/systemd/system/livetalking.service

# The GPU driver stays initialised between processes instead of being torn down and brought up
# again around every start of the service.
nvidia-smi -pm 1 || true

systemctl daemon-reload
systemctl enable livetalking
if [ "$changed" = 1 ]; then systemctl restart livetalking; else systemctl start livetalking; fi
