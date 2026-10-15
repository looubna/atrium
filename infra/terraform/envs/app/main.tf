terraform {
  required_version = ">= 1.9"
  backend "gcs" {}
}

# The app's project since 2026-10-01 (moved from atrium-coach-dev, whose credits ran out).
locals {
  project_id = "atrium-coach-app"
}

provider "google" {
  project               = local.project_id
  region                = "us-central1"
  user_project_override = true
  billing_project       = local.project_id
}

provider "google-beta" {
  project               = local.project_id
  region                = "us-central1"
  user_project_override = true
  billing_project       = local.project_id
}

module "platform" {
  source = "../../modules/platform"
  # RevenueCat secrets exist in Secret Manager (created 2026-09-27); the API reads them.
  revenuecat_enabled = true

  project_id           = local.project_id
  env                  = "dev" # same settings as before the move: nothing in the app changes
  billing_account      = "016AAB-91B8CC-7782CA"
  budget_amount        = 45 # EUR (billing account currency), about USD 50
  github_repository    = "looubna/atrium"
  alert_email          = "looubnaenakhli@gmail.com"
  deletion_protection  = false
  app_check_enforced   = false # local and web development use unattested clients
  api_min_instances    = 0
  api_max_instances    = 3
  worker_max_instances = 3

  app_origins = [
    "capacitor://localhost",
    "https://localhost", # the Android app (Capacitor's WebView origin)
    "http://localhost:5173",
    "http://localhost:4173",
  ]

  app_config = {
    LIVE_MODEL              = "gemini-live-2.5-flash-native-audio"
    LIVE_LOCATION           = "us-central1"
    TEXT_MODEL              = "gemini-3.8-flash"
    TEXT_LOCATION           = "global"
    SPEECH_LOCATION         = "us"
    FREE_TRIAL_MINUTES      = "20" # live minutes a free account gets once
    # The lip-sync face machines, started on demand: the main one first, the standby when its zone
    # has no GPU (as on atrium-coach-dev, where these were set on the service by hand).
    FACE_VMS               = "us-central1-a/atrium-face-l4,us-east4-a/atrium-face-l4-standby"
    FACE_VM_HTTPS          = "true"
    CLOUDFLARE_TURN_KEY_ID = "676a4843cce18dd7298a2dc39fcd45ee"
    # DO NOT `terraform apply` UNTIL THESE ARE COPIED IN. Set by hand on the live atrium-api service
    # (2026-10-02 → 10-10) and owned by Terraform, so an apply without them removes them and every
    # face goes dark. Copy the exact values from:
    #   gcloud run services describe atrium-api --region us-central1 --project atrium-coach-app \
    #     --format='value(spec.template.spec.containers[0].env)'
    # FACE_CLOUD_RUN_URL = "<us-east4 atrium-face URL>,<europe-west4 atrium-face URL>"
    # LIVETALKING_FACES  = "<networking guests: nw_*>"
    # The atrium-face Cloud Run services themselves (us-east4, europe-west4) are not in Terraform.
  }
}

output "platform" {
  value = {
    api_url                    = module.platform.api_url
    worker_url                 = module.platform.worker_url
    artifact_registry          = module.platform.artifact_registry
    user_content_bucket        = module.platform.user_content_bucket
    processing_bucket          = module.platform.processing_bucket
    service_accounts           = module.platform.service_accounts
    workload_identity_provider = module.platform.workload_identity_provider
    firebase_web_config        = module.platform.firebase_web_config
  }
}

# Firebase was added to the project in the console on 2026-10-01 (accepting its terms for the new
# account needs the console); adopted by Terraform here.
import {
  to = module.platform.google_firebase_project.this
  id = "projects/atrium-coach-app"
}
