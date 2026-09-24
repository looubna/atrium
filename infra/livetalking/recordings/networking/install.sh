#!/bin/bash
# Cuts a guest's loop, puts it in the app, and installs their face on the VM.   ./install.sh <guest> [jaw|lips]
set -euo pipefail
g=$1; mode=${2:-jaw}; cd "$(dirname "$0")"
../../../../backend/.venv/bin/python make_loop.py $g
gcloud compute scp $g/loop.mp4 ../../install_face.sh atrium-face-l4:/tmp/ --project atrium-coach-dev --zone us-central1-a >/dev/null 2>&1
gcloud compute ssh atrium-face-l4 --project atrium-coach-dev --zone us-central1-a --command "mv /tmp/loop.mp4 /tmp/nw_$g.mp4; sudo bash /tmp/install_face.sh nw_$g $mode" 2>&1 | tail -1
