# The face server (LiveTalking + MuseTalk v1.5 + our atrium.py bridge) for Cloud Run with an L4 GPU.
# Built from the exact working environment exported out of the face VM image (export-from-image.sh):
#   mt.tar          -> /opt/mt          Python 3.10 env (torch 2.0.1, MuseTalk pins, aiortc...)
#   livetalking.tar -> /opt/LiveTalking LiveTalking at UPSTREAM_COMMIT, patched, models dereferenced
# The faces (data/avatars) are NOT in the image: Cloud Run mounts gs://…/avatars-all there read-only.
FROM nvidia/cuda:11.8.0-cudnn8-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive PYTHONUNBUFFERED=1
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3.10 python3.10-venv libpython3.10 ffmpeg libgl1 libglib2.0-0 libsndfile1 ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ADD mt.tar /opt/
ADD livetalking.tar /opt/
# The repo's bridge is the source of truth (the image's copy is whatever the VM was first booted with).
COPY atrium.py /opt/LiveTalking/server/atrium.py

WORKDIR /opt/LiveTalking
ENV PATH=/opt/mt/bin:$PATH \
    ATRIUM_FEAT_SHIFT=7 \
    ATRIUM_IDLE_STOP_S=0 \
    PORT=8080
# One conversation per instance (Cloud Run concurrency 1): the next caller gets a fresh instance.
CMD exec python app.py --transport webrtc --model musetalk --avatar_id evelyn --listenport ${PORT} \
    --max_session 1 --stun stun:stun.l.google.com:19302
