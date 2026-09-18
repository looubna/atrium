# Budgets alert but never stop spend on their own. The 100% notification is
# pushed to the worker, which flips config/runtime.aiEnabled to false.

resource "google_pubsub_topic" "budget" {
  project    = var.project_id
  name       = "billing-budget"
  labels     = local.labels
  depends_on = [google_project_service.enabled]
}

resource "google_pubsub_subscription" "budget_to_worker" {
  project              = var.project_id
  name                 = "billing-budget-worker"
  topic                = google_pubsub_topic.budget.id
  ack_deadline_seconds = 60

  push_config {
    push_endpoint = "${google_cloud_run_v2_service.worker.uri}/internal/events/budget"
    oidc_token {
      service_account_email = google_service_account.invoker.email
      audience              = google_cloud_run_v2_service.worker.uri
    }
  }

  retry_policy {
    minimum_backoff = "10s"
    maximum_backoff = "600s"
  }

  depends_on = [google_service_account_iam_member.pubsub_token_invoker]
}

resource "google_monitoring_notification_channel" "email" {
  project      = var.project_id
  display_name = "Atrium ${var.env} alerts"
  type         = "email"
  labels = {
    email_address = var.alert_email
  }
  depends_on = [google_project_service.enabled]
}

resource "google_billing_budget" "monthly" {
  billing_account = var.billing_account
  display_name    = "atrium-${var.env}-monthly"

  budget_filter {
    projects = ["projects/${local.project_number}"]
  }

  # No currency_code: the amount is in the billing account's own currency.
  amount {
    specified_amount {
      units = tostring(var.budget_amount)
    }
  }

  threshold_rules {
    threshold_percent = 0.5
  }
  threshold_rules {
    threshold_percent = 0.9
  }
  threshold_rules {
    threshold_percent = 1.0
  }

  all_updates_rule {
    pubsub_topic                     = google_pubsub_topic.budget.id
    monitoring_notification_channels = [google_monitoring_notification_channel.email.id]
  }
}
