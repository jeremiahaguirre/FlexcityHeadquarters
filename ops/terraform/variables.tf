variable "environment" {
  description = "staging or production."
  type        = string
  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "environment must be staging or production."
  }
}

variable "region" {
  description = "Primary region. Must be in Canada."
  type        = string
  default     = "ca-central-1"
  validation {
    condition     = startswith(var.region, "ca-")
    error_message = "Customer data stays in Canada: use a ca- region."
  }
}

variable "dr_region" {
  description = "Disaster-recovery region. Must be in Canada."
  type        = string
  default     = "ca-west-1"
  validation {
    condition     = startswith(var.dr_region, "ca-")
    error_message = "Customer data stays in Canada: use a ca- region."
  }
}

variable "root_domain" {
  description = "The app's domain; organizations are subdomains of it (kelowna.<root_domain>)."
  type        = string
}

variable "certificate_arn" {
  description = "ACM certificate in var.region for <root_domain> and *.<root_domain> (load balancer)."
  type        = string
}

variable "site_domain" {
  description = "The marketing site's host name, e.g. www.<root_domain>. Empty: CloudFront's own address only."
  type        = string
  default     = ""
}

variable "site_certificate_arn" {
  description = "ACM certificate in us-east-1 for site_domain (CloudFront requires us-east-1). Needed when site_domain is set."
  type        = string
  default     = ""
}

variable "image_tag" {
  description = "Container image tag to deploy (the git commit)."
  type        = string
}

variable "az_count" {
  description = "Availability Zones to spread across (ca-central-1 has 3)."
  type        = number
  default     = 3
}

variable "nat_gateways" {
  description = "1 (cheaper; outbound traffic depends on one zone) or one per zone (az_count)."
  type        = number
  default     = 1
}

variable "api_cpu" {
  type    = number
  default = 1024
}
variable "api_memory" {
  type    = number
  default = 2048
}
variable "api_min" {
  description = "Fewest API tasks. At least 2, in different zones."
  type        = number
  default     = 2
}
variable "api_max" {
  type    = number
  default = 10
}
variable "web_min" {
  type    = number
  default = 2
}
variable "web_max" {
  type    = number
  default = 6
}
variable "worker_count" {
  description = "Worker tasks. Jobs run under advisory locks, so 2 gives a standby without double work."
  type        = number
  default     = 2
}

variable "db_instance_class" {
  type    = string
  default = "db.r6g.large"
}
variable "db_allocated_storage_gb" {
  type    = number
  default = 100
}
variable "db_max_storage_gb" {
  type    = number
  default = 1000
}
variable "db_engine_version" {
  type    = string
  default = "16"
}
variable "db_read_replica" {
  description = "Create a read replica for reports (READ_REPLICA_URL)."
  type        = bool
  default     = false
}
variable "db_backup_retention_days" {
  type    = number
  default = 35
}

variable "app_secret_keys" {
  description = <<-EOT
    Keys of the app secret (JSON in Secrets Manager, filled in by hand) passed to the API and worker.
    A task does not start if a listed key is missing, so add optional ones (TWILIO_AUTH_TOKEN,
    VAPID_PRIVATE_KEY, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, SENTRY_DSN, READ_REPLICA_URL, …)
    only once they are in the secret.
  EOT
  type        = list(string)
  default     = ["JWT_SECRET", "APP_DATABASE_URL", "LISTEN_DATABASE_URL", "METRICS_TOKEN"]
}

variable "app_environment" {
  description = "Plain (non-secret) settings for the API and worker, e.g. COMPANY_LEGAL_NAME, SMS_PROVIDER, TWILIO_ACCOUNT_SID, SMS_FROM."
  type        = map(string)
  default     = {}
}

variable "waf_rate_limit" {
  description = "Requests per 5 minutes from one address before it is blocked. High on purpose: a whole city hall can share one address at a shift change."
  type        = number
  default     = 20000
}

variable "alarm_email" {
  description = "Where infrastructure alarms are emailed (confirmed by the recipient)."
  type        = string
  default     = ""
}

variable "union_role_password" {
  description = "Also set the Union Hub role's password (FLEXCITY_UNION_PASSWORD in the app secret)."
  type        = bool
  default     = false
}

# ---- Recovery (docs/DISASTER-RECOVERY.md) ----------------------------------------------------
variable "recovery_mode" {
  description = <<-EOT
    true only when rebuilding production in the recovery region after losing the primary region:
    region = "ca-west-1", dr_region = "ca-central-1". Nothing is created in dr_region (it is the
    lost one); the database is restored from the backups copied here, and the copies of the
    platform key, the app secret and the container images already in this region are used.
  EOT
  type        = bool
  default     = false
}

variable "restore_from_backup_arn" {
  description = "Recovery: ARN of the automated backups copied to this region (aws rds describe-db-instance-automated-backups)."
  type        = string
  default     = ""
}

variable "existing_platform_key_arn" {
  description = "Recovery: ARN of the platform key's copy in this region (alias/flexcity-platform)."
  type        = string
  default     = ""
}

variable "metrics_collector_security_group" {
  description = "Security group of the Prometheus/ADOT collector allowed to scrape the API's /metrics (docs/MONITORING.md). Empty: none."
  type        = string
  default     = ""
}
