#!/bin/bash
# On the face VM, after install_room.sh: `academic_strip`, the classroom face cropped to the band
# holding the three askers (x 416, y 288, 1040x240 of the 1920x1080 room — the union of their face
# and repaint boxes, 454-1427 x 323-492, plus a margin the page feathers). The page lays it over the
# same spot in the filmed room it already plays, so only the strip where mouths move is streamed:
# 8x less video than the whole frame, which is what froze on the way to the browser, and the same
# bitrate spent on far fewer pixels. No GPU and no restart: faces load on demand.
set -euo pipefail
X=416 Y=288 W=1040 H=240
SRC=/opt/LiveTalking/data/avatars/academic_room DST=/opt/LiveTalking/data/avatars/academic_strip
rm -rf $DST; mkdir -p $DST/full_imgs
ffmpeg -loglevel error -i /tmp/academic/room.mp4 -vf "crop=$W:$H:$X:$Y" -start_number 0 $DST/full_imgs/%08d.png
/opt/mt/bin/python - "$SRC" "$DST" $X $Y $W $H <<'PY'
import os, pickle, shutil, sys
src, dst, x, y, w, h = sys.argv[1], sys.argv[2], *map(int, sys.argv[3:])
for sub in ("", "speakers/1", "speakers/2"):
    s, d = os.path.join(src, sub), os.path.join(dst, sub)
    os.makedirs(d, exist_ok=True)
    shutil.copytree(f"{s}/mask", f"{d}/mask")
    shutil.copy(f"{s}/latents.pt", d)
    for f in ("coords.pkl", "mask_coords.pkl"):
        boxes = [(b[0] - x, b[1] - y, b[2] - x, b[3] - y) for b in pickle.load(open(f"{s}/{f}", "rb"))]
        assert all(0 <= b[0] and 0 <= b[1] and b[2] <= w and b[3] <= h for b in boxes), (sub, f, boxes[0])
        pickle.dump(boxes, open(f"{d}/{f}", "wb"))
shutil.copy(f"{src}/avator_info.json", dst)
open(f"{dst}/loop_forward", "w").close()
print("strip ready:", len(os.listdir(f"{dst}/full_imgs")), "frames")
PY
