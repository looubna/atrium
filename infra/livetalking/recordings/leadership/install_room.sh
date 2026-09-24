#!/bin/bash
# On the face VM: the leadership call's one face for the whole team, from /tmp/lroom/room.mp4
# (1280x720: Laura top-left, Marcus top-right, Nadia bottom-left, each a 640x360 webcam tile).
# Each person is prepared from their own quarter (MuseTalk takes one face per clip) and shifted back
# into the full frame. One face per call lead — lr_laura, lr_marcus, lr_nadia — holds the lead as
# person 0 and the other two after it in team order, which is the order the page names speakers in.
set -euo pipefail
cd /opt/MuseTalk
prep() {  # name x y mode
  ffmpeg -loglevel error -y -i /tmp/lroom/room.mp4 -vf "crop=640:360:$2:$3" -c:v libx264 -crf 12 -pix_fmt yuv420p /opt/inputs/lroom_$1.mp4
  cat > configs/inference/lroom_$1.yaml <<Y
lroom_$1:
 preparation: True
 bbox_shift: 5
 video_path: "/opt/inputs/lroom_$1.mp4"
 audio_clips:
     speech: "/opt/inputs/speech.wav"
Y
  rm -rf results/v15/avatars/lroom_$1
  /opt/mt/bin/python -m scripts.realtime_inference --inference_config configs/inference/lroom_$1.yaml --result_dir results \
    --unet_model_path models/musetalkV15/unet.pth --unet_config models/musetalkV15/musetalk.json --version v15 --fps 25 \
    --ffmpeg_path /usr/bin --parsing_mode $4 < /dev/null > /tmp/lroom/prep_$1.log 2>&1
}
prep laura 0 0 jaw; prep marcus 640 0 lips; prep nadia 0 360 jaw
mkdir -p /tmp/lroom/frames; rm -f /tmp/lroom/frames/*
ffmpeg -loglevel error -i /tmp/lroom/room.mp4 -start_number 0 /tmp/lroom/frames/%08d.png
/opt/mt/bin/python - <<'PY'
import os, pickle, shutil, torch
src = "/opt/MuseTalk/results/v15/avatars/lroom_{}"; root = "/opt/LiveTalking/data/avatars"
offset = {"laura": (0, 0), "marcus": (640, 0), "nadia": (0, 360)}
team = ["laura", "marcus", "nadia"]
n = len(os.listdir("/tmp/lroom/frames"))
def shift(boxes, dx, dy):
    return [(b[0] + dx, b[1] + dy, b[2] + dx, b[3] + dy) for b in boxes]
def put(name, out):
    s = src.format(name); os.makedirs(f"{out}/mask", exist_ok=True)
    masks = sorted(os.listdir(f"{s}/mask"))
    assert len(masks) == 2 * n, (name, len(masks), n)
    for m in masks[:n]: shutil.copy(f"{s}/mask/{m}", f"{out}/mask/{m}")
    dx, dy = offset[name]
    for f in ("coords.pkl", "mask_coords.pkl"):
        pickle.dump(shift(pickle.load(open(f"{s}/{f}", "rb"))[:n], dx, dy), open(f"{out}/{f}", "wb"))
    torch.save(torch.load(f"{s}/latents.pt")[:n], f"{out}/latents.pt")
    return shift(pickle.load(open(f"{s}/coords.pkl", "rb"))[:1], dx, dy)[0]
for lead in team:
    dst = f"{root}/lr_{lead}"; shutil.rmtree(dst, ignore_errors=True); os.makedirs(dst)
    shutil.copytree("/tmp/lroom/frames", f"{dst}/full_imgs")
    box = put(lead, dst); shutil.copy(src.format(lead) + "/avator_info.json", dst)
    for i, other in enumerate([m for m in team if m != lead], start=1):
        put(other, f"{dst}/speakers/{i}")
    open(f"{dst}/loop_forward", "w").close()
    print(f"lr_{lead}: {n} frames, lead face box {box}")
PY
