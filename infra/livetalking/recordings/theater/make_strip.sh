#!/bin/bash
# On the face VM, after install_room.sh: `theater_strip`, the auditorium face cropped to the band
# holding the three askers in the front row (x 608, y 384, 1152x176 of the 1920x1080 room — the union
# of their face and repaint boxes, 650-1725 x 424-529, plus a margin the page feathers). The page lays
# it over the same spot in the filmed room it already plays, so only the strip where mouths move is
# streamed: 10x less video than the whole frame, and the same bitrate spent on far fewer pixels (the
# classroom's whole-frame stream froze on the way to the browser). No GPU and no restart.
set -euo pipefail
X=608 Y=384 W=1152 H=176
SRC=/opt/LiveTalking/data/avatars/theater_room DST=/opt/LiveTalking/data/avatars/theater_strip
rm -rf $DST; mkdir -p $DST/full_imgs
ffmpeg -loglevel error -i /tmp/theater/room.mp4 -vf "crop=$W:$H:$X:$Y" -start_number 0 $DST/full_imgs/%08d.png
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
