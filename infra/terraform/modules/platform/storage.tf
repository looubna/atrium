resource "google_storage_bucket" "user_content" {
  project                     = var.project_id
  name                        = "${var.project_id}-user-content"
  location                    = var.region
  storage_class               = "STANDARD"
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = !var.deletion_protection
  labels                      = local.labels

  # Deleted objects stay recoverable for 7 days; documented in the deletion SLA.
  soft_delete_policy {
    retention_duration_seconds = 604800
  }

  # Uploads that were started but never finished.
  lifecycle_rule {
    condition {
      age = 7
    }
    action {
      type = "AbortIncompleteMultipartUpload"
    }
  }

  cors {
    origin          = var.app_origins
    method          = ["GET", "HEAD", "PUT", "POST"]
    response_header = ["Content-Type", "Content-Length", "Content-Range", "Range", "x-goog-resumable", "x-goog-generation"]
    max_age_seconds = 3600
  }

  depends_on = [google_project_service.enabled]
}

resource "google_storage_bucket" "processing" {
  project                     = var.project_id
  name                        = "${var.project_id}-processing"
  location                    = var.region
  storage_class               = "STANDARD"
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = true
  labels                      = local.labels

  # Temporary audio chunks and Speech-to-Text output: no soft delete, gone in 3 days.
  soft_delete_policy {
    retention_duration_seconds = 0
  }

  lifecycle_rule {
    condition {
      age = 3
    }
    action {
      type = "Delete"
    }
  }

  depends_on = [google_project_service.enabled]
}
