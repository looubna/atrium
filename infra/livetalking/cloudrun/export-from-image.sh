#!/bin/bash
# One-off: run as the startup script of a CPU-only VM booted from `atrium-face-image` (no GPU needed).
# Copies the working face server out of the image for the Cloud Run container:
#   gs://atrium-coach-app-livetalking/cloudrun/{mt,musetalk-models,livetalking}.tar  (Python env, weights, patched LiveTalking)
#   gs://atrium-coach-app-livetalking/avatars-all/<face>/...                        (every face, mounted by Cloud Run)
# then writes a report and powers the VM off.
set -uo pipefail
exec >> /var/log/atrium-export.log 2>&1
B=gs://atrium-coach-app-livetalking
LT=/opt/LiveTalking
report() { echo "$*" | tee -a /tmp/report.txt; }
report "start $(date -u)"
report "sizes: $(du -sh /opt/mt /opt/MuseTalk/models $LT $LT/data/avatars 2>/dev/null | tr '\n' ' ')"
report "avatars: $(ls $LT/data/avatars | wc -l)"
report "models links: $(ls -l $LT/models | tr '\n' ' ' | head -c 800)"
tar -C /opt -cf - mt | gcloud storage cp - $B/cloudrun/mt.tar && report "mt ok"
tar -C /opt/MuseTalk -chf - models | gcloud storage cp - $B/cloudrun/musetalk-models.tar && report "models ok"
tar -C /opt --exclude=LiveTalking/data/avatars --exclude=LiveTalking/.git -chf - LiveTalking | gcloud storage cp - $B/cloudrun/livetalking.tar && report "livetalking ok"
gcloud storage rsync -r $LT/data/avatars $B/avatars-all && report "avatars ok"
report "done $(date -u)"
gcloud storage cp /tmp/report.txt $B/cloudrun/report.txt
gcloud storage cp /var/log/atrium-export.log $B/cloudrun/export.log
systemctl poweroff
