variable "project_id" {
  type        = string
  description = "Google Cloud project for this environment."
}

variable "env" {
  type        = string
  description = "Environment name."
  validation {
    condition     = contains(["dev", "staging", "prod"], var.env)
    error_message = "env must be dev, staging or prod."
  }
}

variable "region" {
  type    = string
  default = "us-central1"
}

variable "billing_account" {
  type        = string
  description = "Billing account ID used for the budget."
}

variable "budget_amount" {
  type        = number
  description = "Monthly budget in the billing account's currency; alerts at 50/90/100%, and 100% trips the AI kill switch."
}

variable "github_repository" {
  type        = string
  description = "owner/name of the GitHub repository allowed to deploy via Workload Identity Federation."
}

variable "app_origins" {
  type        = list(string)
  description = "Origins allowed to call the API and upload to Cloud Storage (Capacitor + web dev/staging)."
}

variable "api_min_instances" {
  type    = number
  default = 0
}

variable "api_max_instances" {
  type    = number
  default = 10
}

variable "worker_max_instances" {
  type    = number
  default = 10
}

variable "deletion_protection" {
  type        = bool
  description = "Protect Firestore, buckets and Cloud Run services from terraform destroy."
}

variable "recording_retention_days" {
  type    = number
  default = 365
}

variable "alert_email" {
  type        = string
  description = "Email address for monitoring alerts and budget notifications."
}

variable "ios_bundle_id" {
  type        = string
  description = "iOS bundle ID; must match capacitor.config.ts and the Apple Developer account."
  default     = "com.atriumcoach.app"
}

variable "apple_team_id" {
  type        = string
  description = "Apple Developer Team ID; enables App Attest for App Check when set."
  default     = ""
}

variable "app_check_enforced" {
  type        = bool
  description = "Reject API calls and Firestore reads without a valid App Check token."
}

variable "app_config" {
  type        = map(string)
  description = "Non-secret application settings passed to both Cloud Run services (models, limits, flags)."
  default     = {}
}

variable "livetalking_secret" {
  type        = string
  sensitive   = true
  description = "Shared secret with the LiveTalking face server that renders the interviewers. Set FACE_VMS (zone/name,... started on demand) or LIVETALKING_URL (a fixed server) in app_config too. Empty means no face: interviews run on audio alone."
  default     = ""
}

variable "revenuecat_enabled" {
  type        = bool
  description = "Paid plans through RevenueCat: the API reads the revenuecat-api-key and revenuecat-webhook-secret secrets (created outside Terraform). False means the billing webhook answers 503."
  default     = false
}
