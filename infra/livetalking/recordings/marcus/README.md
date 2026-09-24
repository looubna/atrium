# Marcus (Daniel Brooks's face on the call)

`talking.mp4` / `notes.mp4` are the clips the face server's `marcus` avatar was built from. Both
show him **talking**, which is the fault that killed the face work in `84c1383`: lip-sync only
repaints the mouth while audio plays, so in every pause the recording's own mouth shows through
and he mouths words silently through everyone else's turn.

`talking_1080.mp4` / `notes_1080.mp4` are a re-film (2026-09-22, Veo 3.1 at 1080p, $6.40) that
came back talking as well — `make_panel.sh` is right that it is a roll of the dice. Measured with
the mouth box at 1080p (`crop=150:90:945:307`) against the forehead (`150:90:945:120`):

| clip | mouth | forehead | ratio |
|---|---|---|---|
| `talking.mp4` (720p box) | 3.02 | 0.01 | 207× |
| `notes.mp4` (720p box) | 3.02 | 0.01 | 301× |
| `talking_1080.mp4` | 3.96 | 0.04 | 94× |
| `notes_1080.mp4` | 4.29 | 0.02 | 176× |

Stitching the closed stretches together (the trick that worked for William) got to 30×, still not
shut. **Measure any new clip with a box that is actually on that clip's mouth** — a box calibrated
for someone else's framing reads near zero and looks like success.

Until one comes back shut, the honest options are Daniel on an initials tile, or borrowing a face
that is shut (`william`).
