output "api_url" {
  value = google_cloud_run_v2_service.api.uri
}

output "worker_url" {
  value = google_cloud_run_v2_service.worker.uri
}

output "artifact_registry" {
  value = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.images.repository_id}"
}

output "user_content_bucket" {
  value = google_storage_bucket.user_content.name
}

output "processing_bucket" {
  value = google_storage_bucket.processing.name
}

output "service_accounts" {
  value = {
    api       = google_service_account.api.email
    worker    = google_service_account.worker.email
    invoker   = google_service_account.invoker.email
    deployer  = google_service_account.deployer.email
    terraform = google_service_account.terraform.email
  }
}

output "workload_identity_provider" {
  value = google_iam_workload_identity_pool_provider.github.name
}

# GoogleService-Info.plist for the iOS build (base64). Written into ios/App/App/
# by CI; not committed.
output "ios_google_service_info_base64" {
  value     = data.google_firebase_apple_app_config.ios.config_file_contents
  sensitive = true
}

# Firebase web configuration is public by design (it identifies the project, it
# does not authorize anything); it feeds the client .env files.
output "firebase_web_config" {
  value = {
    apiKey            = data.google_firebase_web_app_config.web.api_key
    authDomain        = data.google_firebase_web_app_config.web.auth_domain
    projectId         = var.project_id
    storageBucket     = data.google_firebase_web_app_config.web.storage_bucket
    messagingSenderId = data.google_firebase_web_app_config.web.messaging_sender_id
    appId             = google_firebase_web_app.web.app_id
  }
}

