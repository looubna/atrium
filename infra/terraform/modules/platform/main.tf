data "google_project" "this" {
  project_id = var.project_id
}

locals {
  project_number    = data.google_project.this.number
  placeholder_image = "us-docker.pkg.dev/cloudrun/container/hello"
  labels = {
    app = "atrium"
    env = var.env
  }

  services = toset([
    "aiplatform.googleapis.com",
    "artifactregistry.googleapis.com",
    "bigquery.googleapis.com",
    "billingbudgets.googleapis.com",
    "cloudscheduler.googleapis.com",
    "cloudtasks.googleapis.com",
    "cloudtrace.googleapis.com",
    "firebase.googleapis.com",
    "firebaseappcheck.googleapis.com",
    "firebaserules.googleapis.com",
    "firestore.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "identitytoolkit.googleapis.com",
    "logging.googleapis.com",
    "monitoring.googleapis.com",
    "pubsub.googleapis.com",
    "run.googleapis.com",
    "secretmanager.googleapis.com",
    "speech.googleapis.com",
    "texttospeech.googleapis.com",
    "storage.googleapis.com",
    "sts.googleapis.com",
    "telemetry.googleapis.com",
  ])
}

resource "google_project_service" "enabled" {
  for_each           = local.services
  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}
