"""On the face VM: per-frame mouth opening, eye opening and head position of a park clip.

    cd /opt/MuseTalk && /opt/mt/bin/python /tmp/park/measure.py /tmp/park/woman_land25.mp4 > woman_land.tsv

Uses MuseTalk's own DWPose model (the one that places the painted mouth), 68 face points:
mouth = inner-lip gap (62-66, 61-67, 63-65) and eyes = lid gap, both over the nose length
(27-30) so head size does not matter; nose_dx/dy = nose tip against frame 0, in nose lengths.
A good frame to speak from has the mouth shut, the eyes open and the head near where it rests.
"""

from __future__ import annotations

import sys

import cv2
import numpy as np
from mmpose.apis import inference_topdown, init_model
from mmpose.structures import merge_data_samples

model = init_model(
    "./musetalk/utils/dwpose/rtmpose-l_8xb32-270e_coco-ubody-wholebody-384x288.py",
    "./models/dwpose/dw-ll_ucoco_384.pth",
    device="cuda",
)

cap = cv2.VideoCapture(sys.argv[1])
print("frame\tmouth\teyes\tnose_dx\tnose_dy")
first = None
n = 0
while True:
    ok, frame = cap.read()
    if not ok:
        break
    p = merge_data_samples(inference_topdown(model, frame)).pred_instances.keypoints[0][23:91]
    scale = np.linalg.norm(p[30] - p[27])
    mouth = np.mean([abs(p[66][1] - p[62][1]), abs(p[67][1] - p[61][1]), abs(p[65][1] - p[63][1])]) / scale
    eyes = np.mean([abs(p[41][1] - p[37][1]), abs(p[40][1] - p[38][1]),
                    abs(p[47][1] - p[43][1]), abs(p[46][1] - p[44][1])]) / scale
    if first is None:
        first = p[30].copy()
    d = (p[30] - first) / scale
    print(f"{n}\t{mouth:.3f}\t{eyes:.3f}\t{d[0]:+.2f}\t{d[1]:+.2f}")
    n += 1
