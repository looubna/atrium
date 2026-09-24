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

## The in-person interview room

A live in-person interview films its own room (`src/components/navigation/InPersonInterview.tsx`)
rather than going through `MeetingVideo`: the interviewers sitting across the table, seen from the
candidate's own chair, listening between turns and talking while they have the floor. The camera
never moves and never cuts away, and the name of whoever is speaking sits under the frame.

```
public/video/inperson/room/
  one/landscape.jpg              the room, wide — the frame every take starts and ends on
  one/landscape.mp4              the room listening        → the candidate is answering
  one/landscape_lead.mp4         the lead talking          → the lead has the floor
  one/landscape_colleague.mp4    a colleague talking       → that colleague has the floor
  one/portrait.jpg|…             the same, upright
  panel/…                        the three-person room: the lead and both colleagues
```

Every take is optional and needs no code change: a missing take falls back to the listening take,
and that to the photograph, so a room with no footage at all still works. Same rule as above —
**every take starts and ends on the poster frame** — plus the specs in [Specs](#specs): locked-off
camera, 1920×1080 landscape and 1080×1920 portrait, 4–8 s, silent, under 3 MB.

### One shot, one take per speaker

Interviews are voice only: there is no lip-synced face to draw into a chair, and the room is shot
from the candidate's own seat and never cuts away. So the camera never moves and the only thing
that changes between turns is **which take is running** — the one whose person has the floor. The
name under the frame says who that is.

Nothing is ever composited into the picture. An earlier version scaled a recording until its head
matched a head in the photograph, cut an oval mask round it and clipped it at the table edge; at
this distance a head is about 77 px wide, so it could only ever read as a sticker. It is gone.

This is not lip-sync and does not pretend to be. What reads at that size is *who* is talking, not
which syllable they are on — which is why one take per speaker is enough, and why real lip-sync
would not be worth its cost here (`scratch/musetalk-test/results/` measured MuseTalk at 16 fps on
an L4 and 22 on a V100, against the 25 fps real time needs).

The panel's takes were filmed from `panel/landscape.jpg` with
`infra/livetalking/recordings/veo.py` (8 s, `veo-3.1-generate-001`, `RESOLUTION=1080p`, about
$3.20 each). The Fast model was tried first at $0.80 and is where most of the "weird" came from:
its people lean, gesture and shift about. Each prompt names **one** speaker, pins the other two
shut, and says what the *only* movements in the clip are — Veo will otherwise have everybody
talking and waving:

> A job interview in a boardroom, filmed from the candidate's chair. Three interviewers sit across
> the table. The woman in the CENTRE asks the candidate a question: her lips move naturally and
> continuously for the whole clip and her head moves only very slightly as she speaks. The man on
> the left keeps his lips closed and listens, giving one slow nod of the head. The woman on the
> right keeps her lips closed, looks down at her open notebook and writes a few words, then looks
> up again.
> \[shared ending: everyone stays seated upright, hands still, shoulders still; the only movements
> in the whole clip are the ones described; locked-off camera; every mouth closed at the end; ends
> on exactly the starting frame\]

The negative prompt matters as much as the prompt: `leaning forward, leaning back, hand gestures,
gesturing, waving, shrugging, swaying, rocking, head bobbing, exaggerated expressions, laughing,
grinning, turning away, standing up, camera movement, zoom, pan, cut, text, caption, subtitles,
extra people`.

`landscape_colleague.mp4` is the same prompt with the man on the left speaking and the other two
closed-lipped. The listening take names nobody as speaking at all.

Check each one before shipping it: the speaker's mouth should move throughout, the other two
should stay shut, and the first and last frames should match the poster (compare them as greyscale
means — anything under about 2/255 is compression noise).

### Who sits in the chairs

The room is the only picture of these people the candidate gets, and their names are said out loud
and shown under the frame: the centre chair is `IN_PERSON_LEAD` (Evelyn Ross) — the room is one
photograph, so the lead cannot change with the round the way a call's tile can, and the round's
character comes from the questions instead — and the sides are `PANEL_IN_PERSON` —
Marcus Adeyemi, who comes in once or twice, and Hana Sato, who says hello and takes notes. They
are the same for every interview, so the left and right chairs never have to change.

The room has its own roster for exactly this reason: a video call seats `PANEL` (Daniel Brooks,
Grace Lin and Sam Wright, who never speaks) and can seat anyone, because a tile costs nothing.
The room can only seat the three people who are in the photograph.

### Making it

The empty-room photographs are already in place, and `public/faces/<avatarId>.jpg` is the frame each
person's recording starts from — the reference for what they look like. Per room:

1. **Poster** (image generation): the empty room photo plus the three people's stills as reference —
   *the same boardroom, same lighting and framing, with these three people seated in the three
   chairs, facing the camera across the table, attentive, notebooks in front of them.* Save over
   `room/panel/landscape.jpg`, so the poster and the clip are the same frame.
2. **Clip** (image-to-video, first frame = last frame = that poster), with
   `infra/livetalking/recordings/veo.py`:

   ```sh
   SECONDS_LEN=8 python3 infra/livetalking/recordings/veo.py veo-3.1-fast-generate-001 \
     public/video/inperson/room/panel/landscape.mp4 16:9 \
     public/video/inperson/room/panel/landscape.jpg \
     "<the prompt above>"
   ```

3. **Compress** with the ffmpeg line above, and repeat for `portrait` (`9:16`) and for `one/`.

The one-to-one room is filmed too: `one/landscape.mp4` (Evelyn listening and writing a note) and
`one/landscape_lead.mp4` (Evelyn asking a question).

Both were filmed on the full room photograph (cropped 1920x1098 -> 1920x1080 first, since Veo films
16:9) and then cropped to sit across a desk from her, because the full room put her down the far end of a
boardroom table and read as distant:

    landscape  crop=988:556:480:276,scale=1920:1080    (1.94x)
    portrait   crop=494:878:728:202,scale=1080:1920    (2.19x)

The framing is matched to `scratch/musetalk-test/results/20260919-032531/videos/speech.mp4`, which
is the look that was asked for: her head about 30% of the frame height, the desk edge near the
bottom with her hands and the notebooks in it, and no ceiling. Distance alone was not the point —
the earlier 1.6x crop was nearly as close but kept the ceiling and a long empty table, which is
what read as far away. Note the app scales takes with `object-cover`, so a window narrower than
16:9 crops them a second time.

These are upscales of the 1080p masters (1.94x and 2.19x), so they are softer than native. Filming
again at this framing — a closer room still, then both takes — is what would fix that, at the usual
two-clip cost. The crop is what the app ships, and
`one/landscape.jpg` is the listening take's own first frame, so the photograph and the takes are
the same pixels rather than merely the same shot. Re-crop all three together or they stop being one
frame; the uncropped 1080p originals are the thing to re-crop from.

**Portrait is cut from the same takes, not filmed again** (the crop above), so both orientations are
the same room, the same woman and the same performance, with no second shoot to pay for. The old `one/portrait.jpg` (a much longer table, her head about 70 px) is gone;
cropping *that* to match would have upscaled her face nearly 3x.

The panel room could get its portrait the same way, from `panel/landscape*.mp4`, though those are the
compressed 1920x1080 ships rather than masters, so the slice starts from less.

### The safety filter has opinions about mouths

Veo's filter blocks a clip outright — `raiMediaFilteredReasons`, no video, **not charged** — when
the *negative* prompt names the mouth. `open mouth, parted lips, visible teeth, jaw movement` and
`opening her mouth` each came back blocked; the same shot passed as soon as the negatives said only
`talking, speaking, mouthing words`. So pin the mouth in the prompt, not in the negatives.

Even then the first one that came back had her mouthing words for a third of its length, which is
the one thing a listening take must not do. What worked was giving her something else to do with
the time: *taking notes while the candidate answers* — she looks down at the notebook, writes,
glances back up — rather than a description of sitting still. Check every take before shipping it
(`select='not(mod(n,6))'`, tiled) and re-roll the ones that talk; a blocked attempt costs nothing,
a delivered one costs the full clip.

## The debate hall

A live debate is argued from your own lectern at the front of a hall, looking across at the
opposition bench (`src/components/navigation/DebateRoom.tsx`, media in `src/data/debateMedia.ts`).
It used to borrow the one-to-one interview photograph, so an opponent was argued at across an empty
meeting table with an interviewer sitting in it.

```
public/video/debate/hall/
  landscape.jpg            the hall, from the lectern — the frame both takes start and end on
  landscape.mp4            the bench listening        → you have the floor
  landscape_opponent.mp4   the centre chair arguing   → your opponent has the floor
  portrait.jpg|…           the same, upright (crop=608:1080:656:0 of the landscape takes)
```

Same rules as the interview room: one locked-off frame, one take per person who can hold the floor,
every take starting and ending on the photograph, and a missing take falling back to the listening
one and then to the photograph. `DebateRoom` runs the opponent's take while their voice is audible
(`interviewerSpeaking`, held `CUT_BACK_MS` past the end so a breath between sentences does not put
the bench back to listening). The player itself is shared: `RoomTake` in
`src/components/navigation/RoomTake.tsx`, used by both rooms.

Real lip-sync was considered here and turned down for the same reason as the interview room: at this
framing the speaker's head is about 110 px and his mouth about 30 px, which is smaller than the
interview room's, while a GPU face server would have to run for the whole debate.
