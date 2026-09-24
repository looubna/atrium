#!/bin/bash
# On the face VM: the sales faces, from /tmp/sales/ (copies of this folder's loops).
#   sl_buyer      Claire on her webcam (buyer/loop.mp4, 1280x720)            — the online one-to-one calls
#   sl_investors  the investors' call (investors/room.mp4, 1280x720): Robert top-left, Priya top-right,
#                 Kevin bottom-left, each a 640x360 webcam tile of one stream  — the online investor pitch
#   sp_buyer      Claire across her meeting-room table                        — in person
#   sp_investors  the three at the fund's boardroom table: Priya left, Robert centre, Kevin right — in person
# A room speaks from speak.mp4 (only the stretches where everyone sits up and looks at the seller, so
# the painted mouth is always on a face turned to them) and listens to loop.mp4 (the whole take, with
# the writing and the nods), which is its `listening` state: what plays while the seller talks.
# A face with several people is prepared one person at a time from the part of the frame holding only
# them (MuseTalk takes one face per clip) and their boxes shifted back; person 0 is Robert, then Priya
# (speakers/1) and Kevin (speakers/2), the order the page names speakers in. Robert has a beard: `lips`.
# Needs the GPU to itself (stop livetalking first): preparation does not fit beside the running service.
set -euo pipefail
cd /opt/MuseTalk
AV=/opt/LiveTalking/data/avatars
prep() {  # name clip crop mode
  ffmpeg -loglevel error -y -i /tmp/sales/$2 -vf "crop=$3" -c:v libx264 -crf 12 -pix_fmt yuv420p /opt/inputs/sales_$1.mp4
  cat > configs/inference/sales_$1.yaml <<Y
sales_$1:
 preparation: True
 bbox_shift: 5
 video_path: "/opt/inputs/sales_$1.mp4"
 audio_clips:
     speech: "/opt/inputs/speech.wav"
Y
  rm -rf results/v15/avatars/sales_$1
  /opt/mt/bin/python -m scripts.realtime_inference --inference_config configs/inference/sales_$1.yaml --result_dir results \
    --unet_model_path models/musetalkV15/unet.pth --unet_config models/musetalkV15/musetalk.json --version v15 --fps 25 \
    --ffmpeg_path /usr/bin --parsing_mode $4 < /dev/null > /tmp/sales/prep_$1.log 2>&1
}
prep buyer buyer/loop.mp4 1280:720:0:0 jaw
prep room_buyer buyer_room/speak.mp4 1280:720:0:0 jaw
prep call_robert investors/room.mp4 640:360:0:0 lips
prep call_priya investors/room.mp4 640:360:640:0 jaw
prep call_kevin investors/room.mp4 640:360:0:360 jaw
prep room_priya investor_room/speak.mp4 420:720:0:0 jaw
prep room_robert investor_room/speak.mp4 440:720:420:0 lips
prep room_kevin investor_room/speak.mp4 420:720:860:0 jaw

frames() {  # clip face
  rm -rf $AV/$2; mkdir -p $AV/$2/full_imgs
  ffmpeg -loglevel error -i /tmp/sales/$1 -start_number 0 $AV/$2/full_imgs/%08d.png
}
frames buyer/loop.mp4 sl_buyer; frames investors/room.mp4 sl_investors
frames buyer_room/speak.mp4 sp_buyer; frames investor_room/speak.mp4 sp_investors
for r in buyer_room:sp_buyer investor_room:sp_investors; do  # the listening state: the whole take
  mkdir -p $AV/${r#*:}/states/listening
  ffmpeg -loglevel error -i /tmp/sales/${r%:*}/loop.mp4 -start_number 0 $AV/${r#*:}/states/listening/%08d.png
done
/opt/mt/bin/python - <<'PY'
import os, pickle, shutil, torch
src = "/opt/MuseTalk/results/v15/avatars/sales_{}"; root = "/opt/LiveTalking/data/avatars"
def put(name, face, speaker=0, dx=0, dy=0):
    s, out = src.format(name), f"{root}/{face}" + (f"/speakers/{speaker}" if speaker else "")
    os.makedirs(f"{out}/mask", exist_ok=True)
    n = len(os.listdir(f"{root}/{face}/full_imgs"))
    masks = sorted(os.listdir(f"{s}/mask"))
    assert len(masks) == 2 * n, (name, len(masks), n)  # the clip, then itself reversed: keep the forward half
    for m in masks[:n]: shutil.copy(f"{s}/mask/{m}", f"{out}/mask/{m}")
    for f in ("coords.pkl", "mask_coords.pkl"):
        boxes = pickle.load(open(f"{s}/{f}", "rb"))[:n]
        pickle.dump([(b[0] + dx, b[1] + dy, b[2] + dx, b[3] + dy) for b in boxes], open(f"{out}/{f}", "wb"))
    torch.save(torch.load(f"{s}/latents.pt")[:n], f"{out}/latents.pt")
    if not speaker: shutil.copy(f"{s}/avator_info.json", out)
    print(out, name, n, "frames, face box", pickle.load(open(f"{out}/coords.pkl", "rb"))[0])
put("buyer", "sl_buyer")
put("room_buyer", "sp_buyer")
put("call_robert", "sl_investors")
put("call_priya", "sl_investors", 1, 640, 0)
put("call_kevin", "sl_investors", 2, 0, 360)
put("room_robert", "sp_investors", 0, 420, 0)
put("room_priya", "sp_investors", 1)
put("room_kevin", "sp_investors", 2, 860, 0)
for face in ("sl_buyer", "sl_investors", "sp_buyer", "sp_investors"):
    if face.startswith("sp_"): open(f"{root}/{face}/clean_cuts", "w").close()  # a cut, not a blend, when it starts to listen
    open(f"{root}/{face}/loop_forward", "w").close()
PY
echo "sales faces ready"
