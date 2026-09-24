# The debate hall

The uncropped 1080p takes as Veo delivered them, and the image they were filmed from (the one the
user supplied). `public/video/debate/hall/` ships these scaled to 1920x1080, plus a 9:16 slice
(`crop=608:1080:656:0`) for an upright phone. Kept here so the framing can change without paying
for the footage again — they are not served to the app.

    hall_master.png       the hall as supplied: the opposition bench seen from your lectern
    listen_master.mp4     the bench listening while you argue
    opponent_master.mp4   the man in the centre chair arguing back

The take running is the one whose person has the floor (`DEBATE_TAKES`, `DebateRoom.tsx`), and both
start and end on the photograph. See `docs/meeting-video.md` for the prompts and the checks.

## The close-up (`closeup/`)

The opponent's lip-synced face. `src.png` is his crop from `hall_master.png`; `still.png` the
Gemini edit of him facing the camera, lips closed, hands out of frame; `listening.mp4` the Veo 3.1
Fast take (head still, prompted with no nodding). Frames 48-115 of that take sigh and mouth, so
`loop.mp4` is frames 120-199 then 0-30, cross-faded (8 frames) at both joins into a forward loop.
Installed on the face VM as `debate_opponent` (`install_face.sh debate_opponent jaw`) and shipped
as `public/video/debate/hall/opponent_face.{mp4,jpg}` (`DEBATE_CLOSEUP`). Every debater with a
man's voice wears it (`HALL_FACE` in `backend/app/modules/debate/debaters.py`); Cara stays on the
hall footage.

## The calm take (`calm/`) — what ships now

The user: "eliminate excessive hand movement and fix lip synch". The arguing take waved both hands
and mouthed words of its own, so it looked like talking through silences and fought MuseTalk's
mouth. `calm/src.png` is frame 0 of the old face-server clip; `still.png` the Gemini edit (hands
flat on the table, lips closed); `calm_master.mp4` Veo 3.1 1080p from that still to itself. The
edit misspelled the sign "OPPOSTTION", so `calm_fixed.mp4` overlays the original sign text
(`crop=118:26:797:499` from src.png at `overlay=801:499`). Shipped as
`public/video/debate/hall/{landscape,portrait}_calm.{mp4,jpg}` and used for both takes;
`calm25.mp4` is the 25 fps copy for `install_face.sh debate_opponent jaw`.

### Building `debate_opponent`: prep on a crop, not the wide frame

MuseTalk's face detector wanders in a hall full of faces: run on the whole 1920x1080 frame it put
the box on his chin and chest (`[693,330,960,500]`) and, by frame 150, on the empty chairs beside
him (`[597,319,701,495]`), so it repainted his collar and his mouth moved no more than the base
clip's (0.52 vs 0.55 mean frame diff). The old gesturing face had the same fault. Instead:

1. `ffmpeg -i /opt/inputs/debate_opponent.mp4 -vf crop=320:320:760:200 /tmp/debate_opponent_crop.mp4`
   (only him in frame) and `install_face.sh debate_opponent_crop jaw` — box steady at `[153,116,212,204]`.
2. Build `data/avatars/debate_opponent` from it: its `mask/`, `latents.pt`, `loop_forward`; the
   full 1920x1080 frames of the calm clip as `full_imgs/%08d.png`; both `coords.pkl` and
   `mask_coords.pkl` shifted by (+760, +200) → face `[913,316,972,404]`.
3. `systemctl restart livetalking` (faces are preloaded at boot; check `/atrium/health` shows 0 sessions).

Mouth motion over the test speech after the fix: 1.65 mean frame diff (base 0.55).
