# Firebase is layered on the same project. Rules and indexes are deployed with
# the Firebase CLI from firebase/ so the emulator tests exercise the same files.

resource "google_firebase_project" "this" {
  provider   = google-beta
  project    = var.project_id
  depends_on = [google_project_service.enabled]
}

resource "google_firebase_web_app" "web" {
  provider        = google-beta
  project         = var.project_id
  display_name    = "Atrium web (${var.env})"
  deletion_policy = "DELETE"
  depends_on      = [google_firebase_project.this]
}

data "google_firebase_web_app_config" "web" {
  provider   = google-beta
  project    = var.project_id
  web_app_id = google_firebase_web_app.web.app_id
}

resource "google_firebase_apple_app" "ios" {
  provider        = google-beta
  project         = var.project_id
  display_name    = "Atrium iOS (${var.env})"
  bundle_id       = var.ios_bundle_id
  team_id         = var.apple_team_id == "" ? null : var.apple_team_id
  deletion_policy = "DELETE"
  depends_on      = [google_firebase_project.this]
}

data "google_firebase_apple_app_config" "ios" {
  provider = google-beta
  project  = var.project_id
  app_id   = google_firebase_apple_app.ios.app_id
}

# App Check: the iOS app attests with App Attest (needs the Apple Team ID on the
# app). Enforcement on Firestore rejects reads without a valid token; the API
# enforces App Check itself (APP_CHECK_ENFORCED).
resource "google_firebase_app_check_app_attest_config" "ios" {
  count      = var.apple_team_id == "" ? 0 : 1
  provider   = google-beta
  project    = var.project_id
  app_id     = google_firebase_apple_app.ios.app_id
  token_ttl  = "3600s"
  depends_on = [google_project_service.enabled]
}

resource "google_firebase_app_check_service_config" "firestore" {
  provider         = google-beta
  project          = var.project_id
  service_id       = "firestore.googleapis.com"
  enforcement_mode = var.app_check_enforced ? "ENFORCED" : "UNENFORCED"
  depends_on       = [google_firebase_project.this, google_firestore_database.default]
}

# Firebase Authentication (Identity Platform). Email/password is configured
# here; Sign in with Apple and Google need credentials created in the Apple
# Developer portal and Google Cloud console, then added as IdP configs.
resource "google_identity_platform_config" "auth" {
  provider = google-beta
  project  = var.project_id

  sign_in {
    allow_duplicate_emails = false
    email {
      enabled           = true
      password_required = true
    }
  }

  authorized_domains = distinct(concat(
    ["${var.project_id}.firebaseapp.com", "${var.project_id}.web.app"],
    var.env == "prod" ? [] : ["localhost"],
  ))

  depends_on = [google_firebase_project.this]
}

resource "google_firestore_database" "default" {
  project                           = var.project_id
  name                              = "(default)"
  location_id                       = var.region
  type                              = "FIRESTORE_NATIVE"
  concurrency_mode                  = "OPTIMISTIC"
  point_in_time_recovery_enablement = var.env == "prod" ? "POINT_IN_TIME_RECOVERY_ENABLED" : "POINT_IN_TIME_RECOVERY_DISABLED"
  delete_protection_state           = var.deletion_protection ? "DELETE_PROTECTION_ENABLED" : "DELETE_PROTECTION_DISABLED"
  deletion_policy                   = var.deletion_protection ? "ABANDON" : "DELETE"
  depends_on                        = [google_firebase_project.this]
}

# TTL: only server-owned job records expire automatically. TTL does not cascade
# to subcollections, so user data is removed by the deletion/retention jobs.
resource "google_firestore_field" "ttl" {
  for_each   = toset(["jobs", "rateLimits"])
  project    = var.project_id
  database   = google_firestore_database.default.name
  collection = each.value
  field      = "expireAt"
  ttl_config {}
  index_config {}
}
