# LiveTalking face server (in-person interviewers)

In-person interviewers are people recorded seated at a desk, lip-synced live by
[LiveTalking](https://github.com/lipku/LiveTalking) (Apache-2.0) from the interviewer's own
speech. The app sends it the 24 kHz PCM the call plays; it streams back WebRTC video with that
same voice on it, so what the candidate hears is locked to the lips. While nobody speaks it
plays a clip of the interviewer writing notes.

This folder holds our additions to upstream (commit in `UPSTREAM_COMMIT`):

- `atrium.py` → `server/atrium.py`: `POST /atrium/offer`, `GET /atrium/audio` (WebSocket), `GET /atrium/health`,
  plus the lip alignment described below.
- `routes.patch`: registers those routes.

## Run it on a Mac (Apple GPU)

```bash
git clone https://github.com/lipku/LiveTalking.git ~/LiveTalking && cd ~/LiveTalking
git checkout "$(cat <repo>/infra/livetalking/UPSTREAM_COMMIT)"
cp <repo>/infra/livetalking/atrium.py server/ && git apply <repo>/infra/livetalking/routes.patch
uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python torch==2.9.1 torchvision==0.24.1 torchaudio==2.9.1 -r requirements.txt
# Models: https://drive.google.com/drive/folders/1FOC_MD6wdogyyX_7V1d4NDIO7P9NlSAJ
#   wav2lip256.pth -> models/wav2lip.pth ; wav2lip256_avatar1.tar.gz -> data/avatars/
ATRIUM_SECRET=<same as LIVETALKING_SECRET> .venv/bin/python app.py --transport webrtc --model wav2lip --avatar_id wav2lip256_avatar1
```

An M3 Pro runs wav2lip at about 32 fps (25 are needed for real time). Then start the API with:

```bash
LIVETALKING_URL=http://localhost:8010
LIVETALKING_SECRET=<same secret>
LIVETALKING_AVATAR=wav2lip256_avatar1   # until the interviewers are recorded
```

## Scale to zero (production)

The GPU is stopped whenever nobody is practising and started on demand:

1. **Start.** The moment someone opens the setup of a session with a face (`showsLiveFace` in
   `src/data/practice.ts`), the page calls `POST /faces/warm` and keeps polling it. The API
   (`backend/app/platform/faces/pool.py`) starts the first VM in `FACE_VMS` and, if that zone is out
   of GPUs, the next one. The page shows the Atrium logo turning and filling with the time left
   (`FaceWarmupStatus`). Nothing waits on it: a session that starts first runs on the voice alone,
   and the face joins mid-call once the server is up.
2. **Hold.** Each poll pings `/atrium/health?hold=<signed token>`, and every open face counts as
   activity.
3. **Stop.** After `ATRIUM_IDLE_STOP_S` (default 900) with no face streaming and no hold, `atrium.py`
   powers the VM off itself. The API never stops anything, so a VM still stops if the API is down.

Cold start was measured at 75-90 s: about 45 s of VM boot and driver init, then 35 s of model load.
Two things shorten it:
- `gpu-startup.sh` no longer restarts the service on every boot. systemd has already started it,
  and the old unconditional restart killed a model load that was already under way.
- `ATRIUM_PRELOAD` loads the other faces into memory straight after start-up, so no one's first
  frame waits on the disk.

One-time VM setup (needs billing on):

```bash
gcloud compute instances add-metadata atrium-face-l4 --zone us-central1-a \
  --metadata-from-file startup-script=gpu-startup.sh,atrium-py=atrium.py \
  --metadata '^;^atrium-idle-stop-s=900;atrium-preload=william,nw_marketing,nw_product,nw_analyst,nw_director,nw_founder,nw_engineer,nw_recruiter'
```

(`^;^` makes `;` the separator, so the comma list stays one value.)

API: `FACE_VMS=us-central1-a/atrium-face-l4` (add a VM in another zone for failover), plus
`FACE_VM_PROJECT` when the VMs are in a different project. In a deployed environment, Terraform grants
the API's service account a custom role that can only read and start instances.

## Lip sync

Out of the box the mouth ran ahead of the voice, and by a different amount every session.

The cause is in `server/webrtc.py`: a frame is stamped when it is **pulled**, not when it is made.
`next_timestamp` adds exactly one frame period per call, however long `recv` sat waiting on an
empty queue, so whenever inference falls behind real time the video track loses ground the audio
track never loses. The offset was therefore a function of how fast the machine rendered — which is
why it moved between sessions, and why the fixed frame-count correction that used to live here
could never hold.

`atrium.py` replaces that with a real presentation timestamp (`_stamp_frames`). `process_frames`
pushes a video frame and the 640 audio samples it was inferred from in the same breath, so the
pairing is already exact there; both are stamped at that point from the content rather than the
wall clock. Video counts 40 ms per frame, audio counts its own samples, and 640 samples at 16 kHz
is 40 ms — so the two timelines advance together by construction. A stalled renderer now delivers
a late frame that still says when it belonged, and both tracks are paced against one epoch.

Two knobs remain, and both are properties of the **model**, not the machine:

- **`ATRIUM_LIP_ALIGN`** (default 10 frames of 20 ms): warm-up audio dropped at start-up. Capped
  by how much is in the output queue (`stride_left + stride_right`), so it cannot correct more
  than a few hundred milliseconds on its own.
- **`ATRIUM_TRIM_MS`** (default 0, **uncalibrated**): the rest of the model's look-ahead — the
  video pulled out of `res_frame_queue` is not the lip shape for the audio pulled out beside it.
  Positive holds the picture back.

The trim cannot be measured yet: it needs a base clip whose mouth is still, and none of the
`evelyn*` clips are (see below). When one exists, expect a small number — the model looks ahead
`opt.r` frames, 10 × 20 ms = 200 ms, and `warm_up` already pulls the audio forward by all of it.
Re-measure after changing `--model`, `--batch_size`, or `opt.l`/`opt.r`; nothing else should move
it, and if it moves anyway the stamping has regressed.

### Measuring

`measure_lag.py` connects as a headless candidate and measures the offset from the WebRTC output.
Run it with the silence gate off, or the mouth rests during the probe's own gaps and leaves too
little movement to correlate against:

```bash
ATRIUM_SILENCE_HOLD=100000 .venv/bin/python app.py --transport webrtc --model wav2lip --avatar_id evelyn_calm
~/LiveTalking/.venv/bin/python measure_lag.py --avatar evelyn_calm --takes 4
```

It picks the mouth by variance while speech is playing (`--mouth-box r0,r1,c0,c1` pins it when a
take is too busy), spaces its bursts unevenly so the correlation cannot lock onto a neighbour, and
discards any take whose peak hits the search limit. Measure against a **calm base clip** (closed
mouth, little head movement) or the recording's own motion swamps the signal.

**It cannot currently produce a number, and that is correct behaviour.** Every take is discarded
because no correlation peak stands clear of its aliases: the base clip's own mouth motion is a
stronger signal than the lip-sync repaint it is trying to find. It will start working once an
interviewer has a still-mouthed base clip.

Two earlier readings here (-625 ms, then +50/-5/-5 ms after a 625 ms trim) were **wrong** and have
been withdrawn: the box they were pinned to — rows 300-420, cols 552-764 — is the interviewer's
neck and collar, not her mouth. Her mouth in these 1280x720 recordings is rows 205-265, cols
630-730, the same box `recordings/make_calm_base.py` uses. Check any `--mouth-box` by cropping a
frame of `data/avatars/<id>/full_imgs/` to it and looking at the result before trusting a reading.

## Silent mouthing

Roughly a fifth of a Gemini Live turn is silence — pauses between sentences, runs of up to ~600 ms
in the 33 s sample in `scratch/avatar-bakeoff/audio/` — and the turn simply stops when the
interviewer hands the floor back. Lip-syncing that silence makes the face mouth words to an empty
room, which is what a candidate notices first.

`atrium.py` classifies every 20 ms chunk before queueing it. Sustained quiet is queued as an
audiotype with no clip bound to it, so LiveTalking shows the avatar's own frames — mouth closed,
head and hands still moving — while the audio still plays underneath, so the candidate hears the
pause exactly as it was spoken. Two knobs:

- **`ATRIUM_SILENCE_HOLD`** (default 8 frames of 20 ms): how long quiet must last before the mouth
  rests. Shorter gaps stay "speech" so the mouth never twitches between words.
- **`ATRIUM_SILENCE_RMS`** (default 0.005): below this a frame carries no voice.

Note it rests on the avatar's *own* frames, not the notes clip — `enable_transition` is `False`
upstream, so cutting to a different recording mid-turn would be a visible jump.

Verified from the server rather than the picture: push speech, 3 s of silence, then speech, and
poll `POST /is_speaking`, which returns the same flag `process_frames` sets from the frame type.
Gate off, it reports SPEAKING for one unbroken 6 s run. Gate on: 1.4 s speaking, 2.8 s at rest,
2.0 s speaking. (`measure_gate.py` runs that check.)

### The base clips talk (open — this is the bigger half)

The gate stops the lip-sync, but what it rests **on** is the avatar's own frames, and those are not
still. Measured over each loop's mouth (rows 205-265, cols 630-730) against a patch of background:

| avatar | mouth std | background std |
|---|---|---|
| `evelyn_calm` | 12.69 | 0.14 |
| `evelyn` | 20.75 | 0.41 |
| `evelyn_closed` | 26.42 | 0.43 |
| `evelyn_smooth` | 12.60 | 0.69 |

Her mouth moves roughly ninety times the noise floor in every one of them, `evelyn_closed` worst
of all. So the face still mouths during a pause — the gate moved the cause rather than removing it,
and this is the remaining half of the "lips moving with no voice" complaint.

Why `make_calm_base.py` did not catch it: its `tolerance = 20.0` is looser than the whole range it
is judging — the mouth in `talking.mp4` never gets more than 30.4 grey levels from the closed
reference, so nearly every frame passed. The reference still, `recordings/evelyn/evelyn.png`, does
have a properly closed mouth, so only the threshold is at fault.

Tightening it does not rescue these takes. At a tolerance of 4-8 the longest closed run in
`talking.mp4` is 1-5 frames; `notes.mp4` has 23-27 (about a second), but she is looking down at the
notebook there, which is the wrong framing for the clip the mouth is repainted onto. The footage
simply does not contain a still-mouthed, camera-facing stretch, which is the case
`make_calm_base.py` already anticipates: *"no stretch with a closed mouth: film one instead."*

So the fix is a purpose-made clip — listening, **mouth closed**, facing the candidate, with natural
head and hand movement — which is what the Interviewer recordings section below already asks for.
`recordings/veo.py` generates one at about $0.10 per second of video. Everything else here stays
blocked behind it: the trim cannot be measured until the mouth holds still.

## Interviewer recordings

Each face needs two 8-second clips in `recordings/<id>/`: `talking.mp4` (the person seated at
their desk, facing the candidate, **mouth closed**, listening, with natural head and hand
movement) and `notes.mp4` (the same framing, writing notes and glancing up).

The base clip's mouth matters: lip-sync repaints the mouth from the interviewer's speech, so a
recording of someone talking only shows through as silent mouthing whenever the audio goes
quiet. A calm, closed mouth is the canvas the model wants. The camera must be locked off and the framing identical
in both, or the loop jumps. Then:

```bash
./make_avatar.sh evelyn
```

That builds `data/avatars/evelyn/` on the server and fills
`data/avatars/evelyn/states/listening/` with the notes frames. Face ids are in
`backend/app/modules/interview/interviewers.py`.

### The in-person panel

A panel is three people in one meeting room: the lead and the two colleagues in `PANEL_COLLEAGUES`
(Marcus Adeyemi, Hana Sato). Their stills were generated from the meeting-room photograph
(`public/video/meeting/landscape/poster.jpg`) so all three share a room, a camera and a framing —
the cut between close-ups has to read as one room, not as a video call.

`recordings/make_panel.sh` films all three from those stills in one go, skipping any clip that
already exists, then prints the `make_avatar.sh` calls and the `backend/.env.local` lines that
point the app at them. About $4.80 for the six clips at Veo 3.1 Fast rates.

A purpose-filmed `talking.mp4` keeps its mouth shut, so `make_calm_base.py` — which salvages a
closed-mouth stretch out of footage of someone talking — is not needed for these.

`calm.mp4` is the current base for `evelyn_calm`: the one-second stretch of `talking.mp4` where
her mouth stays closed, found by comparing each frame's mouth against the still photo. It is a
stopgap — her hands barely move in it. A purpose-made clip (listening, mouth closed, gesturing)
would be better.

The clips here were generated with Veo 3.1 Fast (`veo-3.1-fast-generate-001` on Vertex AI in
us-central1; the `-preview` name it launched under is gone) from one still image, so both clips
are the same person and room: `recordings/gen_still.py` makes the still, `recordings/veo.py`
animates it (about $0.10 per second of video, silent, 720p). Real footage of a consenting person
works just as well.

LiveTalking stamps a small grey "LiveTalking" label into the top-left of the avatar frames when
it builds a face (`avatars/wav2lip/genavatar.py`), which its licence asks for on published video.

## Licence

LiveTalking's code is Apache-2.0. Check the licence of the lip-sync weights before production:
the original Wav2Lip weights are for non-commercial use only.
