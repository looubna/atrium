# Operational signals. The application logs structured JSON; the messages below
# are emitted by backend/app (see the log call sites named in each description).
#
# Latency alerts are intentionally not based on Cloud Run request latency: live
# interviews are WebSocket requests that last up to an hour and would dominate
# any percentile. Request latency is analysed in Cloud Trace instead.

locals {
  log_metrics = {
    ai_failures = {
      description = "Structured model calls that timed out or failed (ai_usage with outcome != ok)."
      filter      = "jsonPayload.message=\"ai_usage\" AND jsonPayload.data.outcome!=\"ok\""
    }
    pipeline_failures = {
      description = "Processing pipeline steps that failed (processing step failed / failed permanently)."
      filter      = "jsonPayload.message=~\"^processing step failed\""
    }
    live_failures = {
      description = "Live interview gateway or engine failures."
      filter      = "jsonPayload.message=(\"live gateway failure\" OR \"live engine connect failed\" OR \"live engine error\")"
    }
    budget_exceeded = {
      description = "The billing budget was exceeded and AI features were disabled."
      filter      = "jsonPayload.message=\"budget exceeded; AI features disabled\""
    }
  }

  alert_thresholds = {
    ai_failures       = { count = 5, window = "600s" }
    pipeline_failures = { count = 1, window = "600s" }
    live_failures     = { count = 3, window = "600s" }
    budget_exceeded   = { count = 1, window = "300s" }
  }
}

resource "google_logging_metric" "app" {
  for_each    = local.log_metrics
  project     = var.project_id
  name        = "atrium/${each.key}"
  description = each.value.description
  filter      = "resource.type=\"cloud_run_revision\" AND ${each.value.filter}"

  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
    unit        = "1"
  }

  depends_on = [google_project_service.enabled]
}

resource "google_monitoring_alert_policy" "log_metric" {
  for_each     = local.alert_thresholds
  project      = var.project_id
  display_name = "Atrium ${var.env}: ${replace(each.key, "_", " ")}"
  combiner     = "OR"

  conditions {
    display_name = "${each.key} >= ${each.value.count}"
    condition_threshold {
      filter          = "metric.type=\"logging.googleapis.com/user/${google_logging_metric.app[each.key].name}\" AND resource.type=\"cloud_run_revision\""
      comparison      = "COMPARISON_GT"
      threshold_value = each.value.count - 1
      duration        = "0s"
      aggregations {
        alignment_period     = each.value.window
        per_series_aligner   = "ALIGN_SUM"
        cross_series_reducer = "REDUCE_SUM"
      }
    }
  }

  notification_channels = [google_monitoring_notification_channel.email.id]
  documentation {
    content   = "See docs/operations.md (Monitoring and troubleshooting) for this alert."
    mime_type = "text/markdown"
  }
}

resource "google_monitoring_alert_policy" "api_5xx" {
  project      = var.project_id
  display_name = "Atrium ${var.env}: API server errors"
  combiner     = "OR"

  conditions {
    display_name = "5xx responses above 1 per minute"
    condition_threshold {
      filter          = "metric.type=\"run.googleapis.com/request_count\" AND resource.type=\"cloud_run_revision\" AND resource.label.service_name=\"${google_cloud_run_v2_service.api.name}\" AND metric.label.response_code_class=\"5xx\""
      comparison      = "COMPARISON_GT"
      threshold_value = 1
      duration        = "300s"
      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_DELTA"
        cross_series_reducer = "REDUCE_SUM"
      }
    }
  }

  notification_channels = [google_monitoring_notification_channel.email.id]
}

resource "google_monitoring_alert_policy" "cpu" {
  project      = var.project_id
  display_name = "Atrium ${var.env}: Cloud Run CPU saturation"
  combiner     = "OR"

  conditions {
    display_name = "p99 container CPU above 85% for 10 minutes"
    condition_threshold {
      filter          = "metric.type=\"run.googleapis.com/container/cpu/utilizations\" AND resource.type=\"cloud_run_revision\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0.85
      duration        = "600s"
      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_PERCENTILE_99"
        cross_series_reducer = "REDUCE_MAX"
        group_by_fields      = ["resource.label.service_name"]
      }
    }
  }

  notification_channels = [google_monitoring_notification_channel.email.id]
}

resource "google_monitoring_alert_policy" "queue_backlog" {
  project      = var.project_id
  display_name = "Atrium ${var.env}: processing backlog"
  combiner     = "OR"

  conditions {
    display_name = "More than 50 queued tasks for 15 minutes"
    condition_threshold {
      filter          = "metric.type=\"cloudtasks.googleapis.com/queue/depth\" AND resource.type=\"cloud_tasks_queue\""
      comparison      = "COMPARISON_GT"
      threshold_value = 50
      duration        = "900s"
      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_MAX"
        cross_series_reducer = "REDUCE_MAX"
        group_by_fields      = ["resource.label.queue_id"]
      }
    }
  }

  notification_channels = [google_monitoring_notification_channel.email.id]
}

resource "google_monitoring_uptime_check_config" "api" {
  project      = var.project_id
  display_name = "Atrium ${var.env} API health"
  timeout      = "10s"
  period       = "300s"

  http_check {
    path         = "/health"
    port         = 443
    use_ssl      = true
    validate_ssl = true
  }

  monitored_resource {
    type = "uptime_url"
    labels = {
      project_id = var.project_id
      host       = trimsuffix(trimprefix(google_cloud_run_v2_service.api.uri, "https://"), "/")
    }
  }
}

resource "google_monitoring_alert_policy" "uptime" {
  project      = var.project_id
  display_name = "Atrium ${var.env}: API health check failing"
  combiner     = "OR"

  conditions {
    display_name = "Health check failing from 2+ regions"
    condition_threshold {
      filter          = "metric.type=\"monitoring.googleapis.com/uptime_check/check_passed\" AND resource.type=\"uptime_url\" AND metric.label.check_id=\"${google_monitoring_uptime_check_config.api.uptime_check_id}\""
      comparison      = "COMPARISON_GT"
      threshold_value = 1
      duration        = "600s"
      aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_NEXT_OLDER"
        cross_series_reducer = "REDUCE_COUNT_FALSE"
        group_by_fields      = ["resource.label.host"]
      }
    }
  }

  notification_channels = [google_monitoring_notification_channel.email.id]
}

# Product analytics: only ai_usage and product_event logs are exported. Log
# entries carry a salted uid hash, never the uid.
resource "google_bigquery_dataset" "analytics" {
  project                     = var.project_id
  dataset_id                  = "atrium_analytics"
  location                    = "US"
  delete_contents_on_destroy  = !var.deletion_protection
  default_table_expiration_ms = 400 * 24 * 60 * 60 * 1000
  labels                      = local.labels
  depends_on                  = [google_project_service.enabled]
}

resource "google_logging_project_sink" "analytics" {
  project                = var.project_id
  name                   = "atrium-analytics"
  destination            = "bigquery.googleapis.com/projects/${var.project_id}/datasets/${google_bigquery_dataset.analytics.dataset_id}"
  filter                 = "resource.type=\"cloud_run_revision\" AND jsonPayload.message=(\"ai_usage\" OR \"product_event\")"
  unique_writer_identity = true

  bigquery_options {
    use_partitioned_tables = true
  }
}

resource "google_bigquery_dataset_iam_member" "analytics_sink" {
  project    = var.project_id
  dataset_id = google_bigquery_dataset.analytics.dataset_id
  role       = "roles/bigquery.dataEditor"
  member     = google_logging_project_sink.analytics.writer_identity
}
