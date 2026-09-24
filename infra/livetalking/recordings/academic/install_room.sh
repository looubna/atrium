#!/bin/bash
# On the face VM: the academic presentation's classroom (`academic_room`), from /tmp/academic/room.mp4
# (public/video/academic/landscape/idle.mp4 at 25 fps, 1920x1080). Three of the students in it are the
# audience that asks questions (backend `modules/presentation`, Format.ACADEMIC), in the order the page
# names speakers: 0 Robert, the chair (the man with glasses, right, hands under his chin: `lips`, so
# the repaint never touches his hands), 1 Priya (the woman in the white sweater, centre), 2 Kevin (the
# young man, centre-left). Each is prepared from a 256x256 crop holding only them — MuseTalk's detector
# wanders in a room full of faces (see debate_hall/README.md) — and their boxes shifted back.
# Stop livetalking first (the prep does not fit beside it), then start it again.
set -euo pipefail
cd /opt/MuseTalk
AV=/opt/LiveTalking/data/avatars
prep() {  # name crop(w:h:x:y) mode
  ffmpeg -loglevel error -y -i /tmp/academic/room.mp4 -vf "crop=$2" -c:v libx264 -crf 12 -pix_fmt yuv420p /opt/inputs/academic_$1.mp4
  cat > configs/inference/academic_$1.yaml <<Y
academic_$1:
 preparation: True
 bbox_shift: 5
 video_path: "/opt/inputs/academic_$1.mp4"
 audio_clips:
     speech: "/opt/inputs/speech.wav"
Y
  rm -rf results/v15/avatars/academic_$1
  /opt/mt/bin/python -m scripts.realtime_inference --inference_config configs/inference/academic_$1.yaml --result_dir results \
    --unet_model_path models/musetalkV15/unet.pth --unet_config models/musetalkV15/musetalk.json --version v15 --fps 25 \
    --ffmpeg_path /usr/bin --parsing_mode $3 < /dev/null > /tmp/academic/prep_$1.log 2>&1
}
prep robert 256:256:1222:267 lips
prep priya 256:256:862:277 jaw
prep kevin 256:256:412:262 jaw

rm -rf $AV/academic_room; mkdir -p $AV/academic_room/full_imgs
ffmpeg -loglevel error -i /tmp/academic/room.mp4 -start_number 0 $AV/academic_room/full_imgs/%08d.png
/opt/mt/bin/python - <<'PY'
import os, pickle, shutil, torch
src = "/opt/MuseTalk/results/v15/avatars/academic_{}"; root = "/opt/LiveTalking/data/avatars/academic_room"
def put(name, speaker, dx, dy):
    s, out = src.format(name), root + (f"/speakers/{speaker}" if speaker else "")
    os.makedirs(f"{out}/mask", exist_ok=True)
    n = len(os.listdir(f"{root}/full_imgs"))
    masks = sorted(os.listdir(f"{s}/mask"))
    assert len(masks) == 2 * n, (name, len(masks), n)  # the clip, then itself reversed: keep the forward half
    for m in masks[:n]: shutil.copy(f"{s}/mask/{m}", f"{out}/mask/{m}")
    for f in ("coords.pkl", "mask_coords.pkl"):
        boxes = pickle.load(open(f"{s}/{f}", "rb"))[:n]
        pickle.dump([(b[0] + dx, b[1] + dy, b[2] + dx, b[3] + dy) for b in boxes], open(f"{out}/{f}", "wb"))
    torch.save(torch.load(f"{s}/latents.pt")[:n], f"{out}/latents.pt")
    if not speaker: shutil.copy(f"{s}/avator_info.json", out)
    boxes = pickle.load(open(f"{out}/coords.pkl", "rb"))
    xs = [b[0] for b in boxes]; ys = [b[1] for b in boxes]
    print(name, n, "frames; face box", boxes[0], "x0 range", min(xs), max(xs), "y0 range", min(ys), max(ys))
put("robert", 0, 1222, 267)
put("priya", 1, 862, 277)
put("kevin", 2, 412, 262)
open(f"{root}/loop_forward", "w").close()
PY
echo "academic room ready"
