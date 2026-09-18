#!/usr/bin/env bash
# Creates one Atrium environment's Google Cloud project and the Terraform state
# bucket. Everything else (Firebase, Firestore, buckets, service accounts,
# Cloud Run, Cloud Tasks, WIF, budgets) is managed by infra/terraform.
#
# Usage:
#   BILLING_ACCOUNT=0103A2-F24377-0788D2 infra/bootstrap/create-project.sh <project-id> <dev|staging|prod>
#
# Idempotent: safe to re-run.
set -euo pipefail

PROJECT_ID="${1:?project id required}"
ENV_NAME="${2:?environment required (dev|staging|prod)}"
BILLING_ACCOUNT="${BILLING_ACCOUNT:?set BILLING_ACCOUNT}"
REGION="${REGION:-us-central1}"

if [[ ! "$ENV_NAME" =~ ^(dev|staging|prod)$ ]]; then
  echo "environment must be dev, staging or prod" >&2
  exit 2
fi

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
STATE_BUCKET="${PROJECT_ID}-tfstate"

if gcloud projects describe "$PROJECT_ID" >/dev/null 2>&1; then
  echo "Project $PROJECT_ID exists"
else
  echo "Creating project $PROJECT_ID"
  gcloud projects create "$PROJECT_ID" --name="Atrium ${ENV_NAME}" --labels="app=atrium,env=${ENV_NAME}"
fi

echo "Linking billing account"
gcloud billing projects link "$PROJECT_ID" --billing-account="$BILLING_ACCOUNT" >/dev/null

echo "Enabling bootstrap APIs"
gcloud services enable \
  cloudresourcemanager.googleapis.com \
  serviceusage.googleapis.com \
  cloudbilling.googleapis.com \
  iam.googleapis.com \
  storage.googleapis.com \
  firebase.googleapis.com \
  --project="$PROJECT_ID"

if gcloud storage buckets describe "gs://${STATE_BUCKET}" --project="$PROJECT_ID" >/dev/null 2>&1; then
  echo "State bucket gs://${STATE_BUCKET} exists"
else
  echo "Creating state bucket gs://${STATE_BUCKET}"
  gcloud storage buckets create "gs://${STATE_BUCKET}" \
    --project="$PROJECT_ID" \
    --location="$REGION" \
    --uniform-bucket-level-access \
    --public-access-prevention
  gcloud storage buckets update "gs://${STATE_BUCKET}" --versioning
fi

BACKEND_FILE="$ROOT/infra/terraform/envs/${ENV_NAME}/backend.hcl"
mkdir -p "$(dirname "$BACKEND_FILE")"
cat >"$BACKEND_FILE" <<EOF
bucket = "${STATE_BUCKET}"
prefix = "atrium/${ENV_NAME}"
EOF

echo
echo "Done. Next:"
echo "  terraform -chdir=infra/terraform/envs/${ENV_NAME} init -backend-config=backend.hcl"
echo "  terraform -chdir=infra/terraform/envs/${ENV_NAME} apply"
