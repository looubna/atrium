#!/bin/bash
# Films one guest's listening clip from $1/still.png (Veo 3.1 Fast, silent, 720p, ~$0.80). Retries free refusals/overload.
g=$1; cd "$(dirname "$0")"
[ -f $g/listening.mp4 ] && exit 0
P="Static locked-off camera at eye level, no camera movement, no zoom. A person at a bright business networking reception stands facing the camera, listening to the person in front of them. They are SILENT for the whole clip and never reply. Their lips stay gently pressed together the entire time in a soft closed-lipped smile; the jaw never opens and they never form a word. They hold their head almost completely still, the way a person listens attentively without nodding: the only movement is slow, gentle breathing, natural blinking and, at most, a barely visible drift of the head. No nodding, no head tilts, no turning. The background stays soft and blurred; the few distant guests stand still in place chatting, nobody walks or crosses the frame. Photorealistic. The video ends on exactly the starting frame."
for try in 1 2 3 4; do
  NEGATIVE="talking, speaking, mouthing words, nodding, head tilting, head turning, walking, people walking, camera movement, zoom, pan, cut, text, caption" \
    python3 ../veo.py veo-3.1-fast-generate-001 $g/listening.mp4 16:9 $g/still.png "$P" > $g/veo.log 2>&1 && exit 0
  grep -q "RESOURCE_EXHAUSTED\|429\|high load\|code': 8" $g/veo.log || { tail -3 $g/veo.log; exit 1; }
  sleep 60
done
exit 1
