#!/bin/bash
# The move from atrium-coach-dev (looubnaenakhli@gmail.com) to atrium-coach-app (suzyiubts@gmail.com),
# step 1, run by the owner: the steps an assistant may not run by itself.
#   1. Copy the three secrets the app needs into the new project (values go straight from one
#      Secret Manager to the other; nothing is printed or written to disk).
#   2. Create a new face-server secret (a random value) for the new project.
#   3. Let the new account read the old project's user files, to copy them over.
#   4. Create the app's infrastructure in the new project with Terraform (infra/terraform/envs/app):
#      the API and worker services, buckets, Firestore, Firebase, task queues, service accounts and
#      their permissions, alerts and the budget. It only adds resources to atrium-coach-app.
set -euo pipefail
OLD_ACCOUNT=looubnaenakhli@gmail.com
NEW_ACCOUNT=suzyiubts@gmail.com
OLD=atrium-coach-dev
NEW=atrium-coach-app
cd "$(dirname "$0")/../terraform/envs/app"

for secret in revenuecat-api-key revenuecat-webhook-secret cloudflare-turn-api-token; do
  gcloud secrets describe "$secret" --project "$NEW" --account "$NEW_ACCOUNT" >/dev/null 2>&1 ||
    gcloud secrets create "$secret" --project "$NEW" --account "$NEW_ACCOUNT" --replication-policy automatic
  gcloud secrets versions access latest --secret "$secret" --project "$OLD" --account "$OLD_ACCOUNT" |
    gcloud secrets versions add "$secret" --data-file=- --project "$NEW" --account "$NEW_ACCOUNT"
  echo "copied $secret"
done

if ! gcloud secrets describe livetalking-secret --project "$NEW" --account "$NEW_ACCOUNT" >/dev/null 2>&1; then
  gcloud secrets create livetalking-secret --project "$NEW" --account "$NEW_ACCOUNT" --replication-policy automatic
  openssl rand -base64 32 | tr -d '\n' |
    gcloud secrets versions add livetalking-secret --data-file=- --project "$NEW" --account "$NEW_ACCOUNT"
  echo "created livetalking-secret"
fi

# Let the new account read the old project's user files (recordings, uploads), to copy them over.
gcloud storage buckets add-iam-policy-binding "gs://$OLD-user-content" --member="user:$NEW_ACCOUNT" \
  --role=roles/storage.objectViewer --project "$OLD" --account "$OLD_ACCOUNT" >/dev/null
echo "new account can read the old user files"

export GOOGLE_OAUTH_ACCESS_TOKEN="$(gcloud auth print-access-token --account "$NEW_ACCOUNT")"
terraform init -backend-config=backend.hcl -input=false >/dev/null
terraform plan -input=false -no-color -out=app.tfplan | grep -E "^Plan:" || true
terraform apply -input=false -no-color app.tfplan | grep -E "Apply complete|Error" || true
rm -f app.tfplan
echo "step 1 done"
