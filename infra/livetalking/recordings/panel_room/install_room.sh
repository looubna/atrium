#!/bin/bash
# On the face VM: builds the in-person panel room face `panel_room` from /tmp/room/loop.mp4 (1280x720).
# MuseTalk finds its face from whole-body keypoints and takes the first person, so each person is prepared
# from a vertical strip of the frame holding only them, and their boxes are shifted back into the full
# frame. The face shows the original frames: person 0 = Evelyn (lead), 1 = Daniel, 2 = Grace.
# Needs the GPU to itself (stop livetalking first): preparation does not fit beside the running service.
set -euo pipefail
cd /opt/MuseTalk
prep() {  # name x-offset width mode
  ffmpeg -loglevel error -y -i /tmp/room/loop.mp4 -vf "crop=$3:720:$2:0" -c:v libx264 -crf 12 -pix_fmt yuv420p /opt/inputs/room_$1.mp4
  cat > configs/inference/room_$1.yaml <<Y
room_$1:
 preparation: True
 bbox_shift: 5
 video_path: "/opt/inputs/room_$1.mp4"
 audio_clips:
     speech: "/opt/inputs/speech.wav"
Y
  rm -rf results/v15/avatars/room_$1
  /opt/mt/bin/python -m scripts.realtime_inference --inference_config configs/inference/room_$1.yaml --result_dir results \
    --unet_model_path models/musetalkV15/unet.pth --unet_config models/musetalkV15/musetalk.json --version v15 --fps 25 \
    --ffmpeg_path /usr/bin --parsing_mode $4 < /dev/null > /tmp/room/prep_$1.log 2>&1
}
prep daniel 0 440 lips; prep evelyn 440 460 jaw; prep grace 880 400 jaw
dst=/opt/LiveTalking/data/avatars/panel_room; rm -rf $dst; mkdir -p $dst/full_imgs
ffmpeg -loglevel error -i /tmp/room/loop.mp4 -start_number 0 $dst/full_imgs/%08d.png
/opt/mt/bin/python - "$dst" <<'PY'
import os, pickle, shutil, sys, torch
dst = sys.argv[1]; src = "/opt/MuseTalk/results/v15/avatars/room_{}"
n = len(os.listdir(f"{dst}/full_imgs"))
def shift(boxes, dx):
    return [(b[0] + dx, b[1], b[2] + dx, b[3]) for b in boxes]
def put(name, dx, out):
    s = src.format(name); os.makedirs(f"{out}/mask", exist_ok=True)
    masks = sorted(os.listdir(f"{s}/mask"))
    assert len(masks) == 2 * n, (name, len(masks), n)
    for m in masks[:n]: shutil.copy(f"{s}/mask/{m}", f"{out}/mask/{m}")
    for f in ("coords.pkl", "mask_coords.pkl"):
        boxes = pickle.load(open(f"{s}/{f}", "rb"))[:n]
        pickle.dump(shift(boxes, dx), open(f"{out}/{f}", "wb"))
    torch.save(torch.load(f"{s}/latents.pt")[:n], f"{out}/latents.pt")
    print(name, "face box", shift(pickle.load(open(f"{s}/coords.pkl", "rb"))[:1], dx)[0])
put("evelyn", 440, dst); shutil.copy(src.format("evelyn") + "/avator_info.json", dst)
put("daniel", 0, f"{dst}/speakers/1"); put("grace", 880, f"{dst}/speakers/2")
PY
touch $dst/loop_forward
echo "panel_room ready: $(ls $dst/full_imgs | wc -l) frames"
