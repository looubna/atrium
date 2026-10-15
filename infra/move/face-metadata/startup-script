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

# Batch 16 (the default): batch 8 was tried on 2026-09-27 to cut ~0.3 s of delay, but a real session then
# rendered at only ~25 fps on the L4, frames arrived late and the mouth ran out of sync. Keep 16.
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

# Watchdog: systemd restarts the face server if it exits (Restart=always), but not if it hangs. Every 30 s
# this asks /atrium/health locally; after 3 failures in a row it restarts the service. Never in the first
# 240 s after the service (re)started, while it loads its models, so a cold start is never cut short.
cat > /tmp/atrium-watchdog.sh <<'WD'
#!/bin/bash
fails=0
while sleep 30; do
  since=$(systemctl show livetalking -p ActiveEnterTimestampMonotonic --value)
  now=$(awk '{print int($1*1000000)}' /proc/uptime)
  [ "$since" -gt 0 ] && [ $(( (now - since) / 1000000 )) -lt 240 ] && { fails=0; continue; }
  if curl -sf -m 10 -o /dev/null http://127.0.0.1:8010/atrium/health; then fails=0; else fails=$((fails + 1)); fi
  if [ "$fails" -ge 3 ]; then
    logger -t atrium-watchdog "face server not answering 3 times in a row: restarting"
    systemctl restart livetalking; fails=0
  fi
done
WD
cat > /tmp/atrium-watchdog.service <<'UNIT'
[Unit]
Description=Restarts the face server if it stops answering
After=livetalking.service

[Service]
ExecStart=/usr/local/bin/atrium-watchdog.sh
Restart=always

[Install]
WantedBy=multi-user.target
UNIT
wd_changed=0
cmp -s /tmp/atrium-watchdog.sh /usr/local/bin/atrium-watchdog.sh || { install -m 755 /tmp/atrium-watchdog.sh /usr/local/bin/atrium-watchdog.sh; wd_changed=1; }
cmp -s /tmp/atrium-watchdog.service /etc/systemd/system/atrium-watchdog.service || {
  install -m 644 /tmp/atrium-watchdog.service /etc/systemd/system/atrium-watchdog.service; wd_changed=1; }
systemctl daemon-reload
systemctl enable atrium-watchdog
if [ "$wd_changed" = 1 ]; then systemctl restart atrium-watchdog; else systemctl start atrium-watchdog; fi

# https in front of the face server, for phones: Android and iOS WebViews refuse plain http. Caddy
# answers at <external-ip-with-dashes>.sslip.io (a public name for any IP) with a Let's Encrypt
# certificate kept in /var/lib/caddy, and proxies to :8010, WebSockets included. With a static IP
# the name and certificate stay the same across boots. The API uses it when FACE_VM_HTTPS=true.
# Only our three signed endpoints are exposed (/atrium/offer, /atrium/audio, /atrium/health): LiveTalking's
# own routes (/offer, /human, /humanaudio, ...) check nothing and stay reachable only on :8010 from the
# firewall's allow-list. And never without a secret: with ATRIUM_SECRET unset the server accepts any avatar.
IP=$(curl -sf -H 'Metadata-Flavor: Google' \
  http://metadata.google.internal/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip || true)
if [ -n "$IP" ] && [ -n "$(md atrium-secret)" ]; then
  if ! command -v caddy >/dev/null; then
    curl -fsSL -o /usr/local/bin/caddy "https://caddyserver.com/api/download?os=linux&arch=amd64"
    chmod 755 /usr/local/bin/caddy
  fi
  mkdir -p /etc/caddy /var/lib/caddy
  cat > /tmp/Caddyfile <<CADDYFILE
${IP//./-}.sslip.io {
	header {
		Strict-Transport-Security "max-age=31536000"
		X-Content-Type-Options nosniff
		-Server
	}
	@atrium path /atrium/offer /atrium/audio /atrium/health
	handle @atrium {
		reverse_proxy 127.0.0.1:8010
	}
	handle {
		respond 404
	}
}
CADDYFILE
  cat > /tmp/caddy.service <<CADDY
[Unit]
Description=Caddy (https for the face server)
After=network-online.target

[Service]
Environment=XDG_DATA_HOME=/var/lib/caddy XDG_CONFIG_HOME=/var/lib/caddy
ExecStart=/usr/local/bin/caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
Restart=always

[Install]
WantedBy=multi-user.target
CADDY
  caddy_changed=0
  cmp -s /tmp/Caddyfile /etc/caddy/Caddyfile || { install -m 644 /tmp/Caddyfile /etc/caddy/Caddyfile; caddy_changed=1; }
  cmp -s /tmp/caddy.service /etc/systemd/system/caddy.service || {
    install -m 644 /tmp/caddy.service /etc/systemd/system/caddy.service; caddy_changed=1; }
  systemctl daemon-reload
  systemctl enable caddy
  if [ "$caddy_changed" = 1 ]; then systemctl restart caddy; else systemctl start caddy; fi
fi
