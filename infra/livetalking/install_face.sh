#!/bin/bash
# On the face VM: turns /tmp/<face>.mp4 (a 25 fps clip whose last frame leads back into its first)
# into a LiveTalking face that loops forward.   sudo bash install_face.sh <face> [jaw|lips]
# `lips` repaints only the lips, which keeps a beard (the default `jaw` repaints the lower face).
set -euo pipefail
FACE=$1; MODE=${2:-jaw}
cp /tmp/$FACE.mp4 /opt/inputs/$FACE.mp4
cd /opt/MuseTalk
cat > configs/inference/atrium_$FACE.yaml <<Y
$FACE:
 preparation: True
 bbox_shift: 5
 video_path: "/opt/inputs/$FACE.mp4"
 audio_clips:
     speech: "/opt/inputs/speech.wav"
Y
rm -rf results/v15/avatars/$FACE
/opt/mt/bin/python -m scripts.realtime_inference --inference_config configs/inference/atrium_$FACE.yaml \
  --result_dir results --unet_model_path models/musetalkV15/unet.pth --unet_config models/musetalkV15/musetalk.json \
  --version v15 --fps 25 --ffmpeg_path /usr/bin --parsing_mode $MODE < /dev/null > /tmp/prep_$FACE.log 2>&1
src=results/v15/avatars/$FACE; dst=/opt/LiveTalking/data/avatars/$FACE
rm -rf $dst; mkdir -p $dst/full_imgs $dst/mask
# MuseTalk saves the clip followed by itself reversed; keep the forward half and loop that.
/opt/mt/bin/python - "$src" "$dst" <<'PY'
import os, pickle, shutil, sys, torch
src, dst = sys.argv[1:3]
names = sorted(os.listdir(f"{src}/full_imgs")); n = len(names) // 2
for d in ("full_imgs", "mask"):
    for name in sorted(os.listdir(f"{src}/{d}"))[:n]:
        shutil.copy(f"{src}/{d}/{name}", f"{dst}/{d}/{name}")
for f in ("coords.pkl", "mask_coords.pkl"):
    pickle.dump(pickle.load(open(f"{src}/{f}", "rb"))[:n], open(f"{dst}/{f}", "wb"))
torch.save(torch.load(f"{src}/latents.pt")[:n], f"{dst}/latents.pt")
shutil.copy(f"{src}/avator_info.json", dst)
print(n, "frames, face box", pickle.load(open(f"{src}/coords.pkl", "rb"))[0])
PY
touch $dst/loop_forward
