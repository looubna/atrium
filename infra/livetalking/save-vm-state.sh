#!/bin/bash
# Rescue the face server's hand-made state off atrium-face-l4 and make it reproducible.
#
# Everything that makes the face good was installed by hand on that one VM and exists
# nowhere else: the `lips` parsing mode that keeps William's beard, and the two avatars
# prepared from the calm base clips (the `musetalk-v15` image still has the old base,
# the one with the eyes-closed tilt). Losing that boot disk means rebuilding both.
#
# This pulls the patch into the repo, pushes the prepared avatars to GCS, snapshots the
# disk, and bakes an image that boots with all of it already in place.
#
#   ./save-vm-state.sh            # extract + snapshot
#   ./save-vm-state.sh --image    # also bake musetalk-v16 (stops the VM)
set -euo pipefail

PROJECT=atrium-coach-dev
VM=atrium-face-l4
BUCKET=gs://atrium-coach-dev-livetalking
HERE="$(cd "$(dirname "$0")" && pwd)"
STAMP="$(date -u +%Y%m%d-%H%M%S)"

ZONE="$(gcloud compute instances list --project="$PROJECT" --filter="name=$VM" \
  --format='value(zone)' | head -1)"
[ -n "$ZONE" ] || { echo "$VM not found in $PROJECT — was it deleted?" >&2; exit 1; }
echo "==> $VM in $ZONE"

state() { gcloud compute instances describe "$VM" --project="$PROJECT" --zone="$ZONE" \
  --format='value(status)'; }
on_vm() { gcloud compute ssh "$VM" --project="$PROJECT" --zone="$ZONE" --tunnel-through-iap \
  --command="$1"; }

if [ "$(state)" != "RUNNING" ]; then
  echo "==> starting (billed while it runs)"
  gcloud compute instances start "$VM" --project="$PROJECT" --zone="$ZONE"
  until on_vm 'test -d /opt/MuseTalk' 2>/dev/null; do sleep 5; done
fi

# 1. The lips parsing mode, as a patch against the upstream file.
echo "==> lips parsing patch"
on_vm 'cd /opt/MuseTalk && git diff -- musetalk/utils/face_parsing/__init__.py' \
  > "$HERE/musetalk-lips-parsing.patch"
if [ ! -s "$HERE/musetalk-lips-parsing.patch" ]; then
  # Not a git checkout, or the change was never tracked: keep the whole file instead.
  echo "    (no git diff — saving the file whole)"
  rm -f "$HERE/musetalk-lips-parsing.patch"
  on_vm 'cat /opt/MuseTalk/musetalk/utils/face_parsing/__init__.py' \
    > "$HERE/musetalk-face-parsing.py"
fi

# 2. The prepared avatars: frames, masks, coords, latents. Too big for git, so GCS.
#    These are what LiveTalking loads at start-up; rebuilding them needs the GPU.
#    The VM runs with --no-service-account --no-scopes, so it cannot reach GCS itself:
#    the tarballs come down over SSH and go up from here, where we hold credentials.
echo "==> prepared avatars -> $BUCKET/avatars/$STAMP/"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
for pair in "avatars:/opt/MuseTalk/results/v15/avatars" \
            "lt-avatars:/opt/LiveTalking/data/avatars"; do
  name="${pair%%:*}"; dir="${pair#*:}"
  on_vm "test -d $dir" 2>/dev/null || { echo "    (no $dir — skipping)"; continue; }
  on_vm "sudo tar czf /tmp/$name-$STAMP.tgz -C $dir ."
  on_vm "du -h /tmp/$name-$STAMP.tgz"
  gcloud compute scp --project="$PROJECT" --zone="$ZONE" --tunnel-through-iap \
    "$VM:/tmp/$name-$STAMP.tgz" "$STAGE/"
  on_vm "rm -f /tmp/$name-$STAMP.tgz"
  gsutil cp "$STAGE/$name-$STAMP.tgz" "$BUCKET/avatars/$STAMP/"
done

# 3. Anything else we changed by hand, for the record.
echo "==> inventory"
on_vm 'ls -la /opt/MuseTalk/results/v15/avatars/ /opt/LiveTalking/data/avatars/ 2>&1; \
  echo "--- livetalking unit ---"; systemctl cat livetalking 2>&1 | head -30' \
  > "$HERE/vm-inventory.txt"

# 4. Snapshot the boot disk: the cheap insurance, whatever else happens.
echo "==> snapshot"
gcloud compute disks snapshot "$VM" --project="$PROJECT" --zone="$ZONE" \
  --snapshot-names="musetalk-working-$STAMP" \
  --description="atrium-face-l4 with the lips parsing mode and the calm-base avatars"

if [ "${1:-}" = "--image" ]; then
  echo "==> baking musetalk-v16 (stops the VM)"
  gcloud compute instances stop "$VM" --project="$PROJECT" --zone="$ZONE"
  gcloud compute images create "musetalk-v16-$STAMP" --project="$PROJECT" \
    --source-disk="$VM" --source-disk-zone="$ZONE" --family=musetalk \
    --description="MuseTalk v1.5 + lips parsing mode + evelyn_calm/william prepared"
  echo "==> musetalk-v16-$STAMP is now the musetalk family head"
fi

echo
echo "Saved:"
echo "  snapshot  musetalk-working-$STAMP"
echo "  avatars   $BUCKET/avatars/$STAMP/"
ls -la "$HERE"/musetalk-*parsing* "$HERE/vm-inventory.txt" 2>/dev/null || true
echo
echo "The VM is still running and billing. Stop it when you are done:"
echo "  gcloud compute instances stop $VM --project=$PROJECT --zone=$ZONE"
