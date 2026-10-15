"""On the face VM: keeps a prepared face's paste areas inside the picture.   sudo /opt/mt/bin/python clamp_crop.py <face>

MuseTalk pastes each painted mouth back through a crop box about 1.5x the face box, reaching well
above the head. When the head sits near the top of the frame that box starts above row 0, the
paste target comes out empty ("could not broadcast ... into shape (0,192,3)") and the frame shows
the unpainted mouth: the lips cut in and out while the person talks. Clipping each box to the frame,
and its mask by the same rows and columns, pastes the same pixels minus the part off-screen.
"""

from __future__ import annotations

import os
import pickle
import sys

import cv2

root = f"/opt/LiveTalking/data/avatars/{sys.argv[1]}"
boxes = pickle.load(open(f"{root}/mask_coords.pkl", "rb"))
names = sorted(os.listdir(f"{root}/mask"), key=lambda n: int(os.path.splitext(n)[0]))
h, w = cv2.imread(f"{root}/full_imgs/{sorted(os.listdir(f'{root}/full_imgs'))[0]}").shape[:2]
clipped = 0
for i, ((x_s, y_s, x_e, y_e), name) in enumerate(zip(boxes, names)):
    if x_s >= 0 and y_s >= 0 and x_e <= w and y_e <= h:
        continue
    mask = cv2.imread(f"{root}/mask/{name}")
    mask = mask[max(0, -y_s):mask.shape[0] - max(0, y_e - h), max(0, -x_s):mask.shape[1] - max(0, x_e - w)]
    cv2.imwrite(f"{root}/mask/{name}", mask)
    boxes[i] = (max(0, x_s), max(0, y_s), min(w, x_e), min(h, y_e))
    clipped += 1
pickle.dump(boxes, open(f"{root}/mask_coords.pkl", "wb"))
print(sys.argv[1], f"{clipped} of {len(boxes)} paste areas clipped to the {w}x{h} frame")
