terraform {
  required_version = ">= 1.9"
  backend "gcs" {}
}

locals {
  project_id = "atrium-coach-dev"
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
  env                  = "dev"
  billing_account      = "0103A2-F24377-0788D2"
  budget_amount        = 70000 # KRW (billing account currency), about USD 50
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

# Created through the Firebase API on 2026-09-27 for the Galaxy Store build; adopted by Terraform here.
import {
  to = module.platform.google_firebase_android_app.android
  id = "projects/atrium-coach-dev/androidApps/1:524974732273:android:e7504ecc8dbb92be4e8a50"
}

