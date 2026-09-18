resource "google_service_account" "api" {
  project      = var.project_id
  account_id   = "atrium-api"
  display_name = "Atrium API (Cloud Run)"
}

resource "google_service_account" "worker" {
  project      = var.project_id
  account_id   = "atrium-worker"
  display_name = "Atrium worker (Cloud Run)"
}

resource "google_service_account" "invoker" {
  project      = var.project_id
  account_id   = "atrium-invoker"
  display_name = "Invokes the worker from Cloud Tasks, Scheduler and Pub/Sub"
}

resource "google_service_account" "deployer" {
  project      = var.project_id
  account_id   = "atrium-deployer"
  display_name = "CI: builds and deploys application code"
}

resource "google_service_account" "terraform" {
  project      = var.project_id
  account_id   = "atrium-terraform"
  display_name = "CI: applies infrastructure from the main branch"
}

locals {
  telemetry_roles = [
    "roles/logging.logWriter",
    "roles/monitoring.metricWriter",
    "roles/cloudtrace.agent",
    "roles/telemetry.tracesWriter",
  ]

  api_project_roles = concat(local.telemetry_roles, [
    "roles/datastore.user",
    "roles/aiplatform.user",
    "roles/cloudtasks.enqueuer",
    "roles/firebaseauth.viewer",
    # Practice Center rounds are transcribed inline, while the user waits.
    "roles/speech.client",
  ])

  worker_project_roles = concat(local.telemetry_roles, [
    "roles/datastore.user",
    "roles/aiplatform.user",
    "roles/cloudtasks.enqueuer",
    "roles/speech.client",
    "roles/firebaseauth.admin",
  ])

  deployer_project_roles = [
    "roles/run.developer",
    "roles/artifactregistry.writer",
    "roles/firebaserules.admin",
    "roles/datastore.indexAdmin",
  ]
}

resource "google_project_iam_member" "api" {
  for_each = toset(local.api_project_roles)
  project  = var.project_id
  role     = each.value
  member   = google_service_account.api.member
}

resource "google_project_iam_member" "worker" {
  for_each = toset(local.worker_project_roles)
  project  = var.project_id
  role     = each.value
  member   = google_service_account.worker.member
}

resource "google_project_iam_member" "deployer" {
  for_each = toset(local.deployer_project_roles)
  project  = var.project_id
  role     = each.value
  member   = google_service_account.deployer.member
}

# Terraform in CI manages IAM, services and data stores, so it needs owner. It is
# only reachable from the protected main branch (see wif.tf).
resource "google_project_iam_member" "terraform_owner" {
  project = var.project_id
  role    = "roles/owner"
  member  = google_service_account.terraform.member
}

# Keyless V4 signed URLs: the runtime identity signs through IAM signBlob.
resource "google_service_account_iam_member" "api_sign_self" {
  service_account_id = google_service_account.api.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = google_service_account.api.member
}

resource "google_service_account_iam_member" "worker_sign_self" {
  service_account_id = google_service_account.worker.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = google_service_account.worker.member
}

# Enqueuing a task with an OIDC token for the invoker requires actAs on it.
resource "google_service_account_iam_member" "api_act_as_invoker" {
  service_account_id = google_service_account.invoker.name
  role               = "roles/iam.serviceAccountUser"
  member             = google_service_account.api.member
}

resource "google_service_account_iam_member" "worker_act_as_invoker" {
  service_account_id = google_service_account.invoker.name
  role               = "roles/iam.serviceAccountUser"
  member             = google_service_account.worker.member
}

# Pub/Sub push subscriptions mint OIDC tokens for the invoker.
resource "google_service_account_iam_member" "pubsub_token_invoker" {
  service_account_id = google_service_account.invoker.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:service-${local.project_number}@gcp-sa-pubsub.iam.gserviceaccount.com"
  depends_on         = [google_project_service.enabled]
}

# CI deploys Cloud Run revisions that run as these identities.
resource "google_service_account_iam_member" "deployer_act_as" {
  for_each = {
    api     = google_service_account.api.name
    worker  = google_service_account.worker.name
    invoker = google_service_account.invoker.name
  }
  service_account_id = each.value
  role               = "roles/iam.serviceAccountUser"
  member             = google_service_account.deployer.member
}

# Bucket-scoped object access.
resource "google_storage_bucket_iam_member" "api_user_content" {
  bucket = google_storage_bucket.user_content.name
  role   = "roles/storage.objectAdmin"
  member = google_service_account.api.member
}

resource "google_storage_bucket_iam_member" "worker_user_content" {
  bucket = google_storage_bucket.user_content.name
  role   = "roles/storage.objectAdmin"
  member = google_service_account.worker.member
}

resource "google_storage_bucket_iam_member" "worker_processing" {
  bucket = google_storage_bucket.processing.name
  role   = "roles/storage.objectAdmin"
  member = google_service_account.worker.member
}

# Speech-to-Text batch recognition reads audio and writes results as its own service agent.
resource "google_project_service_identity" "speech" {
  provider   = google-beta
  project    = var.project_id
  service    = "speech.googleapis.com"
  depends_on = [google_project_service.enabled]
}

# A new service agent takes a while to become visible to IAM; binding it immediately fails with
# "Service account ... does not exist" on a fresh project.
resource "time_sleep" "speech_identity" {
  create_duration = "90s"
  triggers        = { member = google_project_service_identity.speech.member }
}

resource "google_storage_bucket_iam_member" "speech_processing" {
  bucket = google_storage_bucket.processing.name
  role   = "roles/storage.objectAdmin"
  member = time_sleep.speech_identity.triggers["member"]
}
