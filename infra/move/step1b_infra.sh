#!/bin/bash
# The move, step 1b: create the app's infrastructure in atrium-coach-app with Terraform
# (infra/terraform/envs/app). Only adds resources to the new project. Run by the owner.
set -euo pipefail
NEW_ACCOUNT=suzyiubts@gmail.com
cd "$(dirname "$0")/../terraform/envs/app"
export GOOGLE_OAUTH_ACCESS_TOKEN="$(gcloud auth print-access-token --account "$NEW_ACCOUNT")"
terraform init -backend-config=backend.hcl -input=false -no-color >/dev/null
terraform plan -input=false -no-color -out=app.tfplan | grep -E "^Plan:" || true
terraform apply -input=false -no-color app.tfplan | grep -E "Apply complete|Error|error" || true
rm -f app.tfplan
echo "step 1b done"
