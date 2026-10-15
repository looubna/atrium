#!/bin/bash
# The move, step 2, run by the owner:
#   1. Terraform again (infra/terraform/envs/app): the face machine list, the relay key and the API's
#      permission to start the face machines (the same setup atrium-coach-dev had, set there by hand).
#   2. Let the API's service account read the two secrets it uses that Terraform does not manage:
#      the face server's secret and the Cloudflare relay token.
set -euo pipefail
NEW_ACCOUNT=suzyiubts@gmail.com
NEW=atrium-coach-app
bash "$(dirname "$0")/step1b_infra.sh"
for secret in livetalking-secret cloudflare-turn-api-token; do
  gcloud secrets add-iam-policy-binding "$secret" --project "$NEW" --account "$NEW_ACCOUNT" \
    --member="serviceAccount:atrium-api@$NEW.iam.gserviceaccount.com" \
    --role=roles/secretmanager.secretAccessor >/dev/null
  echo "the API can read $secret"
done
echo "step 2 done"
