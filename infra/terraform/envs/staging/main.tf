terraform {
  required_version = ">= 1.9"
  backend "gcs" {}
}

locals {
  project_id = "atrium-coach-staging"
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

  project_id           = local.project_id
  env                  = "staging"
  billing_account      = "0103A2-F24377-0788D2"
  budget_amount        = 70000 # KRW (billing account currency), about USD 50
  github_repository    = "looubna/atrium"
  alert_email          = "looubnaenakhli@gmail.com"
  deletion_protection  = false
  app_check_enforced   = true
  api_min_instances    = 0
  api_max_instances    = 5
  worker_max_instances = 5

  app_origins = [
    "capacitor://localhost",
  ]

  app_config = {
    LIVE_MODEL         = "gemini-live-2.5-flash-native-audio"
    LIVE_LOCATION      = "us-central1"
    TEXT_MODEL         = "gemini-3.8-flash"
    TEXT_LOCATION      = "global"
    SPEECH_LOCATION    = "us"
    FREE_TRIAL_MINUTES = "20" # live minutes a free account gets once
  }
}

output "platform" {
  value = {
    api_url                    = module.platform.api_url
    worker_url                 = module.platform.worker_url
    artifact_registry          = module.platform.artifact_registry
    service_accounts           = module.platform.service_accounts
    workload_identity_provider = module.platform.workload_identity_provider
    firebase_web_config        = module.platform.firebase_web_config
  }
}
