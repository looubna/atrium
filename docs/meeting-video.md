# Meeting room footage

In a small-room presentation, the presenter's view of the meeting room is shown
as a photoreal still and short video loops instead of the real-time 3D room
(`src/components/navigation/MeetingVideo.tsx`). Drop files in and reload — no
code changes.

```
public/video/meeting/
  sitting/portrait/   presenter seated at the head of the table, phone upright
  standing/portrait/  presenter standing, phone upright
  sitting/landscape/  (optional) seated, phone on its side
  standing/landscape/ (optional) standing, phone on its side
  landscape/          shared by both postures when no posture folder has footage
```

The app looks in `<posture>/<orientation>/` for the session's posture first,
then in the shared `<orientation>/`. Each folder holds:

```
    poster.jpg        required for that view
    idle.mp4          the room listening — loops
    listen_1.mp4      optional variation mixed into idle (a nod, a glance)
    listen_2.mp4      optional second variation
    hand_raise.mp4    someone raises a hand and ends holding it up
    hand_wait.mp4     the hand stays up — loops while the question waits
    hand_lower.mp4    the hand comes down, back to the listening pose
```

`.webm` works too. Anything missing is skipped:

| Present | What shows |
|---|---|
| nothing | the 3D room, as before |
| `poster.jpg` only | the still image |
| + `idle` | the listening loop |
| + `hand_*` | a hand goes up when the session asks a question, down when it is answered |

Each orientation only uses its own folder. With no `portrait/poster.jpg`, an
upright phone shows the 3D room (which frames itself for portrait) rather than
a thin letterboxed strip of the wide shot.

The current landscape `poster.jpg`, `idle.mp4` and `listen_*.mp4` are generated
locally from the reference image with LivePortrait (head sway, blinks, eye
movement, nods, smiles) — see `animate_meeting.py` in the session scratchpad.
LivePortrait animates faces only; hand-raise clips still need a video tool.

## The one rule that makes it look continuous

**Every clip starts and ends on the poster frame**, except the hand chain,
which is linked end-to-start:

```
poster ──idle──▶ poster ──hand_raise──▶ HAND UP ──hand_wait──▶ HAND UP ──hand_lower──▶ poster
```

Most image-to-video tools (Runway, Kling, Luma, Veo) let you set a **first
frame and a last frame**. Use `poster.jpg` for both on `idle`/`listen_*`. For
the hand chain, save the last frame of `hand_raise` as `hand_up.jpg` and use it
as the first/last frame of `hand_wait` and the first frame of `hand_lower`.

## Specs

- Same framing as the poster, **locked-off camera** (no pan, zoom or drift)
- Landscape 1920×1080 (or the poster's 1624×969); portrait 1080×1920
- 4–8 s, 24 or 30 fps, no audio
- Aim for under 3 MB a clip. With ffmpeg (`brew install ffmpeg`):

```sh
ffmpeg -i in.mp4 -an -c:v libx264 -crf 26 -preset slow -pix_fmt yuv420p -movflags +faststart -vf "scale=1920:-2" idle.mp4
```

## Prompts

Start every video from `poster.jpg` (image-to-video). Shared ending for all of
them:

> Static locked-off camera, no camera movement, no zoom. Same room, same
> lighting, same three people, nobody enters or leaves. Photorealistic, natural
> subtle motion. The video ends on exactly the starting frame.

**idle** — *The three colleagues sit attentively and listen to the presenter
(the camera). They breathe naturally, blink, and make tiny posture shifts; eyes
stay on the camera. Nothing else moves.*

**listen_1** — *The woman on the right nods slowly twice in agreement while the
others keep listening, then settles back into her original pose.*

**listen_2** — *The man on the left glances down at his laptop, types briefly,
looks back up at the camera and nods once, returning to his original pose.*

**hand_raise** (last frame = hand up, not the poster) — *The woman on the right
raises her right hand to ask a question and keeps it raised, looking at the
camera with an interested expression.*

**hand_wait** (first and last frame = `hand_up.jpg`) — *She keeps her hand
raised and waits patiently, looking at the camera; slight natural movement, the
others listen.*

**hand_lower** (first frame = `hand_up.jpg`, last frame = poster) — *She lowers
her hand, nods thanks, and settles back into her original listening pose.*

**Portrait poster** (image generation, from the landscape image as reference) —
*The same meeting room, people, clothing and lighting, recomposed as a vertical
9:16 photo from the head of the table: the table runs away from the camera, the
two side attendees and the one at the far end all in frame, the pendant light
and glass wall above.* Then generate the portrait clips from that image with
the same prompts.
