#!/usr/bin/env bash
# Turns one interviewer's two clips into a LiveTalking face.
#
#   ./make_avatar.sh evelyn            # uses recordings/evelyn/{talking,notes}.mp4
#
# The talking clip becomes the avatar the lip-sync runs on; the notes clip becomes the
# silent "listening" state played while the candidate answers. Needs the face server
# running (it does the face detection), and takes a few minutes per face on a Mac.
set -euo pipefail

FACE="${1:?usage: make_avatar.sh <face id>}"
HERE="$(cd "$(dirname "$0")" && pwd)"
SERVER="${LIVETALKING_HOME:-$HOME/LiveTalking}"
URL="${LIVETALKING_URL:-http://localhost:8010}"
CLIPS="$HERE/recordings/$FACE"

task=$(curl -fsS -X POST "$URL/api/avatar/task" -H 'Content-Type: application/json' \
  -d "{\"model\":\"wav2lip\",\"avatar_id\":\"$FACE\",\"video_path\":\"$CLIPS/talking.mp4\",\"img_size\":256}" \
  | sed -n 's/.*"task_id": *"\([^"]*\)".*/\1/p')
echo "avatar task $task"
until curl -fsS "$URL/api/avatar/task/$task" | grep -qE '"status": ?"(completed|failed)"'; do sleep 5; done
curl -fsS "$URL/api/avatar/task/$task"; echo

# Writing notes, at the 25 fps the server renders.
states="$SERVER/data/avatars/$FACE/states/listening"
mkdir -p "$states"
ffmpeg -v error -y -i "$CLIPS/notes.mp4" -vf fps=25 -start_number 0 "$states/%08d.png"
echo "$FACE ready: $(ls "$states" | wc -l | tr -d ' ') frames of notes"
