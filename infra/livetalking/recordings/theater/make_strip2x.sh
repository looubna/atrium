#!/bin/bash
# On the face VM, after make_strip.sh: `theater_strip2x`, the same front-row band at twice the size
# (2304x352 for x 608, y 384, 1152x176 of the room). The faces in this wide shot are only 45-60 px,
# so MuseTalk's 256 px mouth was being squeezed into a few dozen pixels; at twice the size it keeps
# twice the detail, and the page shows it in the same place. Nothing is re-prepared: the frames are
# upscaled, the boxes doubled and the masks resized; the face latents do not depend on the output size.
set -euo pipefail
X=608 Y=384 W=1152 H=176
SRC=/opt/LiveTalking/data/avatars/theater_strip DST=/opt/LiveTalking/data/avatars/theater_strip2x
rm -rf $DST; mkdir -p $DST/full_imgs
ffmpeg -loglevel error -i /tmp/theater/room.mp4 \
  -vf "crop=$W:$H:$X:$Y,scale=$((W * 2)):$((H * 2)):flags=lanczos" -start_number 0 $DST/full_imgs/%08d.png
/opt/mt/bin/python - "$SRC" "$DST" <<'PY'
import os, pickle, shutil, sys
import cv2
src, dst = sys.argv[1], sys.argv[2]
for sub in ("", "speakers/1", "speakers/2"):
    s, d = os.path.join(src, sub), os.path.join(dst, sub)
    os.makedirs(f"{d}/mask", exist_ok=True)
    for name in sorted(os.listdir(f"{s}/mask")):
        mask = cv2.imread(f"{s}/mask/{name}", cv2.IMREAD_UNCHANGED)
        cv2.imwrite(f"{d}/mask/{name}", cv2.resize(mask, (mask.shape[1] * 2, mask.shape[0] * 2), interpolation=cv2.INTER_LINEAR))
    shutil.copy(f"{s}/latents.pt", d)
    for f in ("coords.pkl", "mask_coords.pkl"):
        boxes = [tuple(v * 2 for v in b) for b in pickle.load(open(f"{s}/{f}", "rb"))]
        pickle.dump(boxes, open(f"{d}/{f}", "wb"))
shutil.copy(f"{src}/avator_info.json", dst)
open(f"{dst}/loop_forward", "w").close()
print("2x strip ready:", len(os.listdir(f"{dst}/full_imgs")), "frames")
PY
