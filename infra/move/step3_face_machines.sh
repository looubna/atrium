#!/bin/bash
# The move, step 3, run by the owner: the two lip-sync face machines in atrium-coach-app, from the
# image copied from atrium-coach-dev (every face, the thesis committee included), with the same face
# program as before (infra/move/face-metadata) and the new project's face-server secret.
# Only one GPU may run at a time (the project's quota), so each machine is created, then stopped;
# the API starts whichever it needs. Run step 2 first.
set -euo pipefail
NEW_ACCOUNT=suzyiubts@gmail.com
NEW=atrium-coach-app
META="$(cd "$(dirname "$0")" && pwd)/face-metadata"
SECRET_FILE="$(mktemp)"
trap 'rm -f "$SECRET_FILE"' EXIT
gcloud secrets versions access latest --secret livetalking-secret --project "$NEW" --account "$NEW_ACCOUNT" > "$SECRET_FILE"

create() {  # name zone address
  local name=$1 zone=$2 address=$3
  if gcloud compute instances describe "$name" --zone "$zone" --project "$NEW" --account "$NEW_ACCOUNT" >/dev/null 2>&1; then
    echo "$name already exists"; return
  fi
  for attempt in 1 2 3 4 5 6; do
    if gcloud compute instances create "$name" --zone "$zone" --project "$NEW" --account "$NEW_ACCOUNT" \
        --machine-type g2-standard-8 --accelerator type=nvidia-l4,count=1 \
        --maintenance-policy TERMINATE --no-restart-on-failure \
        --image atrium-face-image --boot-disk-type pd-ssd --boot-disk-size 100GB \
        --address "$address" --tags livetalking --no-service-account --no-scopes \
        --metadata-from-file "startup-script=$META/startup-script,atrium-py=$META/atrium-py,forward-loop-py=$META/forward-loop-py,routes-patch=$META/routes-patch,atrium-preload=$META/atrium-preload,atrium-idle-stop-s=$META/atrium-idle-stop-s,atrium-secret=$SECRET_FILE" \
        >/dev/null 2>&1; then
      echo "$name created in $zone"; break
    fi
    echo "$name: no GPU free in $zone yet (attempt $attempt), retrying in 60 s"; sleep 60
  done
  gcloud compute instances stop "$name" --zone "$zone" --project "$NEW" --account "$NEW_ACCOUNT" >/dev/null 2>&1 &&
    echo "$name stopped (the app starts it when needed)"
}

create atrium-face-l4 us-central1-a atrium-face-ip
create atrium-face-l4-standby us-east4-a atrium-face-ip-standby
echo "step 3 done"
