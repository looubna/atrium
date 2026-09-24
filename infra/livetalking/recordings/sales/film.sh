#!/bin/bash
# Films one sales person's silent listening clip from $1/still.png (Veo 3.1 Fast, ~$0.80). Retries free refusals/overload.
# usage: film.sh <dir> webcam|room|panel
g=$1; kind=$2; cd "$(dirname "$0")"
[ -f $g/listening.mp4 ] && exit 0
CALM="They are SILENT for the whole clip and never reply: their lips stay gently closed the entire time and they never form a word. They keep looking straight into the camera, making steady eye contact, and never look away to the side or at anyone else. The only movements are slow natural breathing, natural blinking and, once, a single small slow nod. Hands and shoulders stay still. Photorealistic. The video ends on exactly the starting frame."
case $kind in
  webcam) RES=720p; P="Static laptop webcam on a video call, locked-off, no camera movement, no zoom. The person faces the camera and listens attentively to the speaker on the call. $CALM The background stays still.";;
  room)   RES=1080p; P="Static locked-off camera at the eye level of a visitor seated across the table, no camera movement, no zoom. The woman sits at the table and listens attentively to the visitor. $CALM Once, briefly, she glances down to write a short note in her notebook, then looks straight back at the camera. The background stays still.";;
  panel)  RES=1080p; P="Static locked-off camera at the eye level of a founder seated across the boardroom table, no camera movement, no zoom. The three investors sit still in their chairs and listen attentively to the founder. All three are SILENT for the whole clip; their lips stay gently closed and nobody forms a word. Each of them keeps looking straight into the camera the whole time, and none of them ever turns to look at the others. The only movements are slow natural breathing and natural blinking; once, the man in the centre gives a single small slow nod, and once, the woman on the left glances down to write a short note, then looks back at the camera. Hands and shoulders otherwise stay still, nobody gestures or leans. Photorealistic. The video ends on exactly the starting frame.";;
esac
for try in 1 2 3 4 5; do
  RESOLUTION=$RES NEGATIVE="talking, speaking, mouthing words, looking sideways, turning head, looking at each other, gesturing, hand movement, leaning, head bobbing, walking, camera movement, zoom, pan, cut, text, caption" \
    python3 ../veo.py veo-3.1-fast-generate-001 $g/listening.mp4 16:9 $g/still.png "$P" > $g/veo.log 2>&1 && exit 0
  grep -q "RESOURCE_EXHAUSTED\|429\|high load\|code': 8\|raiMedia" $g/veo.log || { tail -3 $g/veo.log; exit 1; }
  sleep 60
done
exit 1
