#!/bin/bash
# On the face VM: the large-audience presentation's company auditorium (`theater_room`), from
# /tmp/theater/room.mp4 (public/video/theater/landscape/idle.mp4 at 25 fps, 1920x1080). Three people in
# the front row are the audience that asks questions (backend `modules/presentation`,
# Format.LARGE_AUDIENCE), in the order the page names speakers: 0 Robert, the chair (the man with
# glasses at the centre), 1 Priya (the woman with long brown hair, left of the aisle), 2 Kevin (the man
# with glasses, far right). Each is prepared from a 256x256 crop holding only them — MuseTalk's detector
# wanders in a room full of faces — and their boxes shifted back. Built like the classroom
# (recordings/academic/install_room.sh); make_strip.sh then cuts the streamed band.
set -euo pipefail
cd /opt/MuseTalk
AV=/opt/LiveTalking/data/avatars
prep() {  # name crop(w:h:x:y) mode
  ffmpeg -loglevel error -y -i /tmp/theater/room.mp4 -vf "crop=$2" -c:v libx264 -crf 12 -pix_fmt yuv420p /opt/inputs/theater_$1.mp4
  cat > configs/inference/theater_$1.yaml <<Y
theater_$1:
 preparation: True
 bbox_shift: 5
 video_path: "/opt/inputs/theater_$1.mp4"
 audio_clips:
     speech: "/opt/inputs/speech.wav"
Y
  rm -rf results/v15/avatars/theater_$1
  /opt/mt/bin/python -m scripts.realtime_inference --inference_config configs/inference/theater_$1.yaml --result_dir results \
    --unet_model_path models/musetalkV15/unet.pth --unet_config models/musetalkV15/musetalk.json --version v15 --fps 25 \
    --ffmpeg_path /usr/bin --parsing_mode $3 < /dev/null > /tmp/theater/prep_$1.log 2>&1
}
prep robert 256:256:847:337 jaw
prep priya 256:256:562:342 jaw
prep kevin 256:256:1547:337 jaw

rm -rf $AV/theater_room; mkdir -p $AV/theater_room/full_imgs
ffmpeg -loglevel error -i /tmp/theater/room.mp4 -start_number 0 $AV/theater_room/full_imgs/%08d.png
/opt/mt/bin/python - <<'PY'
import os, pickle, shutil, torch
src = "/opt/MuseTalk/results/v15/avatars/theater_{}"; root = "/opt/LiveTalking/data/avatars/theater_room"
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
put("robert", 0, 847, 337)
put("priya", 1, 562, 342)
put("kevin", 2, 1547, 337)
open(f"{root}/loop_forward", "w").close()
PY
echo "theater room ready"
