# GitHub Actions authenticates with short-lived OIDC tokens; no service account keys exist.

resource "google_iam_workload_identity_pool" "github" {
  project                   = var.project_id
  workload_identity_pool_id = "github"
  display_name              = "GitHub Actions"
  depends_on                = [google_project_service.enabled]
}

resource "google_iam_workload_identity_pool_provider" "github" {
  project                            = var.project_id
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github-oidc"
  display_name                       = "GitHub OIDC"

  attribute_mapping = {
    "google.subject"        = "assertion.sub"
    "attribute.repository"  = "assertion.repository"
    "attribute.ref"         = "assertion.ref"
    "attribute.environment" = "assertion.environment"
  }

  attribute_condition = "assertion.repository == '${var.github_repository}'"

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

locals {
  github_environment = var.env == "prod" ? "production" : var.env
  wif_principal_env  = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.environment/${local.github_environment}"
}

# Only jobs running in the matching GitHub Environment (which carries branch
# protection and, for production, required reviewers) can impersonate these.
resource "google_service_account_iam_member" "deployer_wif" {
  service_account_id = google_service_account.deployer.name
  role               = "roles/iam.workloadIdentityUser"
  member             = local.wif_principal_env
}

resource "google_service_account_iam_member" "terraform_wif" {
  service_account_id = google_service_account.terraform.name
  role               = "roles/iam.workloadIdentityUser"
  member             = local.wif_principal_env
}
