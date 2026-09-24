#!/usr/bin/env bash
# Films the three people of an in-person panel, from the stills already in their folders.
#
#   ./make_panel.sh                      # the whole panel
#   ./make_panel.sh marcus               # one person
#   VEO_MODEL=veo-3.1-generate-001 ./make_panel.sh   # the fuller, dearer model
#
# Each person needs two 8-second clips (see ../README.md, "Interviewer recordings"):
#   talking.mp4  the lip-sync canvas — seated, listening, MOUTH CLOSED, natural head and hands
#   notes.mp4    the listening state — the same framing, writing notes and glancing up
# Both start and end on the person's still, so either one loops without a jump.
#
# Clips that already exist are left alone, so re-running after a failure costs nothing extra.
# At Veo 3.1 Fast rates (720p, silent) a clip is about $0.80, so the two speakers cost about $3.20.
#
# Only the people who speak are filmed. The third at the table (PANEL_OBSERVER) says nothing, so
# she needs no lip-synced recording: she is in the footage of the room and never cut to.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
MODEL="${VEO_MODEL:-veo-3.1-fast-generate-001}"
PANEL=("${@:-}")
[ -z "${PANEL[0]}" ] && PANEL=(evelyn_meeting marcus)

# Whatever the person does with their own mouth shows through wherever the interviewer's speech
# goes quiet, so the canvas clip must not open it.
NEG="talking, speaking, open mouth, parted lips, visible teeth, mouthing words, lip movement, \
jaw movement, camera movement, zoom, pan, cut, other people, text, caption"

COMMON="Static locked-off camera, no camera movement, no zoom. Same room, same lighting, nobody \
enters or leaves, no one else in frame. Photorealistic, natural subtle motion. The video ends on \
exactly the starting frame."

# Asking for "no talking" is not enough — Veo will film someone talking anyway. Describing the
# mouth as a physical state it must hold works better, and even then the result needs looking at.
TALKING="The person sits at the meeting room table listening to the candidate sitting across from \
them. They are SILENT for the whole clip and never reply. Their lips stay gently pressed together \
the entire time: the jaw does not open, the teeth are never visible, and they never mouth or form \
a single word. The expression is calm and attentive with a closed-lipped hint of a smile. The only \
movement is this: slow breathing, blinking, small tilts and turns of the head, a slight shift of \
the shoulders, hands resting on the table near the notebook and moving a little, and one or two \
slow nods of understanding. Their eyes stay on the camera. $COMMON"

NOTES="The person sits at the meeting room table while the candidate answers. They look down and \
write a few words in the open notebook, then glance back up at the camera, attentive, and write \
again. Their mouth stays CLOSED throughout. Unhurried, natural movement of the head, hands and \
pen. $COMMON"

for face in "${PANEL[@]}"; do
  dir="$HERE/$face"
  still="$dir/$face.png"
  [ -f "$still" ] || { echo "$face: no still at $still — make one with gen_still.py first"; exit 1; }
  for clip in talking notes; do
    out="$dir/$clip.mp4"
    if [ -f "$out" ]; then
      echo "$face/$clip.mp4 already filmed, skipping"
      continue
    fi
    prompt=$TALKING
    [ "$clip" = notes ] && prompt=$NOTES
    echo "filming $face/$clip.mp4 …"
    SECONDS_LEN=8 NEGATIVE="$NEG" python3 "$HERE/veo.py" "$MODEL" "$out" 16:9 "$still" "$prompt"
  done
done

echo
echo "Check every talking.mp4 before building an avatar from it: the mouth must stay SHUT, because"
echo "lip-sync repaints it and an open mouth shows through as silent mouthing in every pause."
echo "  ffmpeg -i <face>/talking.mp4 -vf \"select='not(mod(n,24))',crop=280:280:520:120,tile=4x2\" -frames:v 1 mouth.png"
echo "Delete and re-run for any face that came back talking; it is a roll of the dice each time."
echo
echo "Then, with the face server running (LIVETALKING_URL, default localhost:8010):"
for face in "${PANEL[@]}"; do echo "  ../make_avatar.sh $face"; done
echo
echo "Then point the app at them in backend/.env.local:"
echo "  LIVETALKING_AVATAR=evelyn_meeting"
echo "  LIVETALKING_FACES=marcus=marcus"
