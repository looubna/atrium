#!/bin/bash
# On the face VM: the thesis defence's lecture hall (`defense_room`), from /tmp/defense/room.mp4
# (public/video/defense/landscape/idle.mp4 at 25 fps, 1920x1080). Three of the committee at the front
# table are the ones who question the candidate (backend `modules/presentation`, Format.DEFENCE), in the
# order the page names speakers: 0 Robert, the chair (the man with glasses, centre: `jaw`), 1 Priya (the
# woman with curly hair, left of him: `jaw`), 2 Kevin (the man far left, hand at his chin: `lips`, so the
# repaint never touches his hand). Each is prepared from a 256x256 crop holding only them — MuseTalk's
# detector wanders in a room full of faces (see debate_hall/README.md) — and their boxes shifted back.
# Stop livetalking first (the prep does not fit beside it), then start it again.
set -euo pipefail
cd /opt/MuseTalk
AV=/opt/LiveTalking/data/avatars
prep() {  # name crop(w:h:x:y) mode
  ffmpeg -loglevel error -y -i /tmp/defense/room.mp4 -vf "crop=$2" -c:v libx264 -crf 12 -pix_fmt yuv420p /opt/inputs/defense_$1.mp4
  cat > configs/inference/defense_$1.yaml <<Y
defense_$1:
 preparation: True
 bbox_shift: 5
 video_path: "/opt/inputs/defense_$1.mp4"
 audio_clips:
     speech: "/opt/inputs/speech.wav"
Y
  rm -rf results/v15/avatars/defense_$1
  /opt/mt/bin/python -m scripts.realtime_inference --inference_config configs/inference/defense_$1.yaml --result_dir results \
    --unet_model_path models/musetalkV15/unet.pth --unet_config models/musetalkV15/musetalk.json --version v15 --fps 25 \
    --ffmpeg_path /usr/bin --parsing_mode $3 < /dev/null > /tmp/defense/prep_$1.log 2>&1
}
prep robert 256:256:762:352 jaw
prep priya 256:256:455:360 jaw
prep kevin 256:256:200:368 lips

rm -rf $AV/defense_room; mkdir -p $AV/defense_room/full_imgs
ffmpeg -loglevel error -i /tmp/defense/room.mp4 -start_number 0 $AV/defense_room/full_imgs/%08d.png
/opt/mt/bin/python - <<'PY'
import os, pickle, shutil, torch
src = "/opt/MuseTalk/results/v15/avatars/defense_{}"; root = "/opt/LiveTalking/data/avatars/defense_room"
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
put("robert", 0, 762, 352)
put("priya", 1, 455, 360)
put("kevin", 2, 200, 368)
open(f"{root}/loop_forward", "w").close()
PY
echo "defense room ready"
