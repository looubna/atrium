resource "google_artifact_registry_repository" "images" {
  project       = var.project_id
  location      = var.region
  repository_id = "atrium"
  format        = "DOCKER"
  labels        = local.labels

  cleanup_policies {
    id     = "keep-recent"
    action = "KEEP"
    most_recent_versions {
      keep_count = 20
    }
  }

  cleanup_policies {
    id     = "delete-old"
    action = "DELETE"
    condition {
      older_than = "2592000s"
    }
  }

  depends_on = [google_project_service.enabled]
}

resource "random_password" "analytics_salt" {
  length  = 48
  special = false
}

resource "google_secret_manager_secret" "analytics_salt" {
  project   = var.project_id
  secret_id = "analytics-uid-salt"
  labels    = local.labels
  replication {
    auto {}
  }
  depends_on = [google_project_service.enabled]
}

resource "google_secret_manager_secret_version" "analytics_salt" {
  secret      = google_secret_manager_secret.analytics_salt.id
  secret_data = random_password.analytics_salt.result
}

resource "google_secret_manager_secret_iam_member" "analytics_salt" {
  for_each = {
    api    = google_service_account.api.member
    worker = google_service_account.worker.member
  }
  secret_id = google_secret_manager_secret.analytics_salt.id
  role      = "roles/secretmanager.secretAccessor"
  member    = each.value
}

# Signs the tokens our LiveTalking face server checks. Only the API needs it — the worker never
# talks to the face server. Empty: interviews run without a face. Set FACE_VMS (or LIVETALKING_URL) in app_config.
resource "google_secret_manager_secret" "livetalking_secret" {
  count     = var.livetalking_secret == "" ? 0 : 1
  project   = var.project_id
  secret_id = "livetalking-secret"
  labels    = local.labels
  replication {
    auto {}
  }
  depends_on = [google_project_service.enabled]
}

resource "google_secret_manager_secret_version" "livetalking_secret" {
  count       = var.livetalking_secret == "" ? 0 : 1
  secret      = google_secret_manager_secret.livetalking_secret[0].id
  secret_data = var.livetalking_secret
}

resource "google_secret_manager_secret_iam_member" "livetalking_secret" {
  count     = var.livetalking_secret == "" ? 0 : 1
  secret_id = google_secret_manager_secret.livetalking_secret[0].id
  role      = "roles/secretmanager.secretAccessor"
  member    = google_service_account.api.member
}


# Paid plans (RevenueCat): the secret REST API key and the webhook's shared secret live in Secret Manager
# as `revenuecat-api-key` and `revenuecat-webhook-secret`, created and rotated outside Terraform (their
# values never pass through Terraform state). Only the API reads them. Off until revenuecat_enabled.
locals {
  billing_secrets = var.revenuecat_enabled ? {
    "revenuecat-api-key"        = "REVENUECAT_API_KEY"
    "revenuecat-webhook-secret" = "REVENUECAT_WEBHOOK_SECRET"
  } : {}
}

resource "google_secret_manager_secret_iam_member" "billing" {
  for_each  = local.billing_secrets
  project   = var.project_id
  secret_id = each.key
  role      = "roles/secretmanager.secretAccessor"
  member    = google_service_account.api.member
}

resource "google_cloud_tasks_queue" "queues" {
  for_each = {
    processing  = { concurrent = 20, attempts = 6 }
    maintenance = { concurrent = 5, attempts = 10 }
  }
  project  = var.project_id
  location = var.region
  name     = each.key

  rate_limits {
    max_concurrent_dispatches = each.value.concurrent
    max_dispatches_per_second = 10
  }

  retry_config {
    max_attempts  = each.value.attempts
    min_backoff   = "10s"
    max_backoff   = "600s"
    max_doublings = 5
  }

  depends_on = [google_project_service.enabled]
}

locals {
  common_env = merge(var.app_config, {
    APP_ENV              = var.env
    GOOGLE_CLOUD_PROJECT = var.project_id
    GCP_REGION           = var.region
    USER_CONTENT_BUCKET  = google_storage_bucket.user_content.name
    PROCESSING_BUCKET    = google_storage_bucket.processing.name
    TASKS_LOCATION       = var.region
    TASKS_INVOKER_SA     = google_service_account.invoker.email
    # Both services queue work for the worker (the worker queues each pipeline's next step), and a
    # service can't reference its own URL, so use Cloud Run's deterministic service URL.
    WORKER_URL                = "https://atrium-worker-${data.google_project.this.number}.${var.region}.run.app"
    RECORDING_RETENTION_DAYS  = tostring(var.recording_retention_days)
    ALLOWED_ORIGINS           = join(",", var.app_origins)
    GOOGLE_GENAI_USE_VERTEXAI = "TRUE"
    APP_CHECK_ENFORCED        = tostring(var.app_check_enforced)
    # Keep prompts, transcripts and model responses out of trace spans.
    ADK_CAPTURE_MESSAGE_CONTENT_IN_SPANS = "false"
  })
}

resource "google_cloud_run_v2_service" "worker" {
  project             = var.project_id
  name                = "atrium-worker"
  location            = var.region
  ingress             = "INGRESS_TRAFFIC_INTERNAL_ONLY"
  deletion_protection = var.deletion_protection
  labels              = local.labels

  template {
    service_account                  = google_service_account.worker.email
    timeout                          = "1800s"
    execution_environment            = "EXECUTION_ENVIRONMENT_GEN2"
    max_instance_request_concurrency = 4

    scaling {
      min_instance_count = 0
      max_instance_count = var.worker_max_instances
    }

    volumes {
      name = "user-content"
      gcs {
        bucket    = google_storage_bucket.user_content.name
        read_only = false
      }
    }

    volumes {
      name = "processing"
      gcs {
        bucket    = google_storage_bucket.processing.name
        read_only = false
      }
    }

    containers {
      image = local.placeholder_image

      resources {
        limits = {
          cpu    = "2"
          memory = "4Gi"
        }
      }

      volume_mounts {
        name       = "user-content"
        mount_path = "/mnt/user-content"
      }

      volume_mounts {
        name       = "processing"
        mount_path = "/mnt/processing"
      }

      dynamic "env" {
        for_each = merge(local.common_env, { ROLE = "worker" })
        content {
          name  = env.key
          value = env.value
        }
      }

      env {
        name = "ANALYTICS_SALT"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.analytics_salt.secret_id
            version = "latest"
          }
        }
      }
    }
  }

  # CI deploys new images; Terraform owns everything else.
  lifecycle {
    ignore_changes = [
      template[0].containers[0].image,
      client,
      client_version,
    ]
  }

  depends_on = [
    google_project_service.enabled,
    google_secret_manager_secret_iam_member.analytics_salt,
    google_storage_bucket_iam_member.worker_user_content,
    google_storage_bucket_iam_member.worker_processing,
  ]
}

resource "google_cloud_run_v2_service" "api" {
  project             = var.project_id
  name                = "atrium-api"
  location            = var.region
  ingress             = "INGRESS_TRAFFIC_ALL"
  deletion_protection = var.deletion_protection
  labels              = local.labels

  template {
    service_account                  = google_service_account.api.email
    timeout                          = "3600s"
    session_affinity                 = true
    max_instance_request_concurrency = 40

    scaling {
      min_instance_count = var.api_min_instances
      max_instance_count = var.api_max_instances
    }

    containers {
      image = local.placeholder_image

      resources {
        limits = {
          cpu    = "1"
          memory = "1Gi"
        }
      }

      startup_probe {
        http_get {
          path = "/health"
        }
        initial_delay_seconds = 0
        period_seconds        = 3
        failure_threshold     = 20
      }

      dynamic "env" {
        for_each = merge(local.common_env, { ROLE = "api" })
        content {
          name  = env.key
          value = env.value
        }
      }

      env {
        name = "ANALYTICS_SALT"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.analytics_salt.secret_id
            version = "latest"
          }
        }
      }

      dynamic "env" {
        for_each = google_secret_manager_secret.livetalking_secret
        content {
          name = "LIVETALKING_SECRET"
          value_source {
            secret_key_ref {
              secret  = env.value.secret_id
              version = "latest"
            }
          }
        }
      }
      dynamic "env" {
        for_each = local.billing_secrets
        content {
          name = env.value
          value_source {
            secret_key_ref {
              secret  = env.key
              version = "latest"
            }
          }
        }
      }
    }
  }

  lifecycle {
    ignore_changes = [
      template[0].containers[0].image,
      client,
      client_version,
    ]
  }

  depends_on = [
    google_project_service.enabled,
    google_secret_manager_secret_iam_member.analytics_salt,
    google_secret_manager_secret_iam_member.livetalking_secret,
  ]
}

# The API is public at the network level; every route authenticates with Firebase.
resource "google_cloud_run_v2_service_iam_member" "api_public" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.api.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

resource "google_cloud_run_v2_service_iam_member" "worker_invoker" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.worker.name
  role     = "roles/run.invoker"
  member   = google_service_account.invoker.member
}

resource "google_cloud_scheduler_job" "cron" {
  for_each = {
    retention = { schedule = "17 3 * * *", path = "/internal/cron/retention" }
    reconcile = { schedule = "*/10 * * * *", path = "/internal/cron/reconcile" }
  }
  project   = var.project_id
  region    = var.region
  name      = "atrium-${each.key}"
  schedule  = each.value.schedule
  time_zone = "Etc/UTC"

  retry_config {
    retry_count = 3
  }

  http_target {
    http_method = "POST"
    uri         = "${google_cloud_run_v2_service.worker.uri}${each.value.path}"
    oidc_token {
      service_account_email = google_service_account.invoker.email
      audience              = google_cloud_run_v2_service.worker.uri
    }
  }

  depends_on = [google_project_service.enabled]
}
