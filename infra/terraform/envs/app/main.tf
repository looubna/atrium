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
    # The web app (set by hand on atrium-api until 2026-10-15; now here so an apply keeps it).
    "https://app.atriumcoach.com",
    "https://atrium-web-6i1.pages.dev",
  ]

  app_config = {
    LIVE_MODEL         = "gemini-live-2.5-flash-native-audio"
    LIVE_LOCATION      = "us-central1"
    TEXT_MODEL         = "gemini-3.8-flash"
    TEXT_LOCATION      = "global"
    SPEECH_LOCATION    = "us"
    FREE_TRIAL_MINUTES = "20" # live minutes a free account gets once
    # The lip-sync face machines, started on demand: the main one first, the standby when its zone
    # has no GPU (as on atrium-coach-dev, where these were set on the service by hand).
    FACE_VMS               = "us-central1-a/atrium-face-l4,us-east4-a/atrium-face-l4-standby"
    FACE_VM_HTTPS          = "true"
    CLOUDFLARE_TURN_KEY_ID = "676a4843cce18dd7298a2dc39fcd45ee"
    # Set by hand on atrium-api (2026-10-02 → 10-10), copied from revision atrium-api-00012 on 2026-10-15.
    # Faces on Cloud Run GPU: us-east4 first, europe-west4 when it stays busy.
    FACE_CLOUD_RUN_URL = "https://atrium-face-139827614779.us-east4.run.app,https://atrium-face-139827614779.europe-west4.run.app"
    LIVETALKING_AVATAR = "evelyn"
    LIVETALKING_FACES  = "nw_marketing=nw_marketing,nw_product=nw_product,nw_analyst=nw_analyst,nw_director=nw_director,nw_founder=nw_founder,nw_engineer=nw_engineer,nw_recruiter=nw_recruiter"
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
