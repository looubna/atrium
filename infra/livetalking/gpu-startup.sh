#!/bin/bash
# Boots the face server on a GPU VM: clone upstream, restore models and the interviewer's
# recording from Cloud Storage, apply our additions, and keep it running.
set -eux
exec > /var/log/livetalking-setup.log 2>&1

UPSTREAM=b3e7490
BUCKET=gs://atrium-coach-dev-livetalking

cd /opt
[ -d LiveTalking ] || git clone https://github.com/lipku/LiveTalking.git
cd LiveTalking
git checkout "$UPSTREAM"

# Models (wav2lip, face detection) and the interviewer's frames.
gsutil cp "$BUCKET/lt_assets.tar.gz" /tmp/
tar -xzf /tmp/lt_assets.tar.gz -C /opt/LiveTalking
mkdir -p /root/.cache/torch/hub/checkpoints
mv -f /opt/LiveTalking/s3fd-619a316812.pth /root/.cache/torch/hub/checkpoints/

# Our endpoints and lip alignment.
gsutil cp "$BUCKET/atrium.py" server/atrium.py
python3 - <<'PY'
p = 'server/routes.py'
s = open(p).read()
if 'setup_atrium_routes' not in s:
    s = s.replace("    setup_avatar_routes(app)",
                  "    setup_avatar_routes(app)\n\n    from server.atrium import setup_atrium_routes\n    setup_atrium_routes(app)")
    open(p, 'w').write(s)
PY

pip install --no-input -r requirements.txt
nvidia-smi || true

cat > /etc/systemd/system/livetalking.service <<'UNIT'
[Unit]
Description=LiveTalking face server
After=network-online.target

[Service]
WorkingDirectory=/opt/LiveTalking
ExecStart=/opt/conda/bin/python app.py --transport webrtc --model wav2lip --avatar_id evelyn --listenport 8010
Restart=always

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable --now livetalking
