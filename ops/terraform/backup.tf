# Backups that survive a compromised account (SECURITY-AUDIT SEC-71).
#
# RDS's own automated backups and their Calgary copy (database.tf) can be deleted by anyone who
# holds administrator rights in this account. This adds a daily database snapshot kept in an AWS
# Backup vault under a COMPLIANCE vault lock: once the lock's grace period (backup_vault_lock_grace_days)
# has passed, no one, not even the account's root user, can delete a recovery point before its
# retention ends, or shorten the retention or remove the lock.
#
# A copy in a separate AWS account goes further (SECURITY-OPERATIONS.md): set backup_copy_vault_arn
# to a vault there (locked the same way), and every daily snapshot is copied to it. That vault,
# its account and an SCP that denies backup:DeleteRecoveryPoint are set up by hand
# (docs/DISASTER-RECOVERY.md, "Backups in a separate account").

variable "backup_vault_lock" {
  description = "Lock the AWS Backup vault in compliance mode. IRREVERSIBLE once the grace period ends: the vault can then never be deleted while it holds recovery points. Null (the default): on in production only."
  type        = bool
  default     = null
  nullable    = true
}

variable "backup_vault_lock_grace_days" {
  description = "Days during which the vault lock can still be removed (changeable_for_days, at least 3). After that it is permanent."
  type        = number
  default     = 3
  validation {
    condition     = var.backup_vault_lock_grace_days >= 3
    error_message = "AWS Backup needs at least 3 days before a compliance lock takes effect."
  }
}

variable "backup_retention_days" {
  description = "Days each daily snapshot in the locked vault (and its cross-account copy) is kept. Must stay within the lock's permanent bounds (local.backup_lock_min_days to local.backup_lock_max_days)."
  type        = number
  default     = 35
  validation {
    condition     = var.backup_retention_days >= 35 && var.backup_retention_days <= 420
    error_message = "backup_retention_days must be between 35 and 420, the vault lock's permanent bounds."
  }
}

variable "backup_copy_vault_arn" {
  description = "ARN of an AWS Backup vault in a separate account (locked in compliance mode), in Montreal or Calgary, that receives a copy of every daily snapshot. Empty: no cross-account copy."
  type        = string
  default     = ""
  validation {
    condition     = var.backup_copy_vault_arn == "" || can(regex("^arn:aws:backup:ca-(central|west)-1:[0-9]{12}:backup-vault:[A-Za-z0-9_.-]+$", var.backup_copy_vault_arn))
    error_message = "backup_copy_vault_arn must be an AWS Backup vault in ca-central-1 or ca-west-1: the copies stay in Canada."
  }
}

variable "backup_object_lock_mode" {
  description = "Object lock mode of the backups bucket: COMPLIANCE (no one can delete a locked object early) or GOVERNANCE (users with s3:BypassGovernanceRetention can). Empty: COMPLIANCE in production, GOVERNANCE elsewhere."
  type        = string
  default     = ""
  validation {
    condition     = contains(["", "COMPLIANCE", "GOVERNANCE"], var.backup_object_lock_mode)
    error_message = "backup_object_lock_mode is COMPLIANCE, GOVERNANCE or empty."
  }
}

locals {
  backup_object_lock_mode = var.backup_object_lock_mode != "" ? var.backup_object_lock_mode : (var.environment == "production" ? "COMPLIANCE" : "GOVERNANCE")
  backup_enabled          = !var.recovery_mode
  backup_vault_lock       = var.backup_vault_lock == null ? var.environment == "production" : var.backup_vault_lock
  # The lock's bounds. PERMANENT once the grace period ends: AWS refuses any change to a compliance
  # lock after that, so they are constants, not tied to backup_retention_days (which may change
  # within them).
  backup_lock_min_days = 35
  backup_lock_max_days = 420
  # The account that holds the copy vault, which must be allowed to use the snapshots' key.
  backup_copy_account = var.backup_copy_vault_arn == "" ? "" : split(":", var.backup_copy_vault_arn)[4]
}

resource "aws_backup_vault" "locked" {
  count       = local.backup_enabled ? 1 : 0
  name        = "${local.name}-locked"
  kms_key_arn = aws_kms_key.data.arn
}

resource "aws_backup_vault_lock_configuration" "locked" {
  count               = local.backup_enabled && local.backup_vault_lock ? 1 : 0
  backup_vault_name   = aws_backup_vault.locked[0].name
  min_retention_days  = local.backup_lock_min_days
  max_retention_days  = local.backup_lock_max_days
  changeable_for_days = var.backup_vault_lock_grace_days
}

data "aws_iam_policy_document" "backup_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["backup.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "backup" {
  count                = local.backup_enabled ? 1 : 0
  name                 = "${local.gname}-backup"
  assume_role_policy   = data.aws_iam_policy_document.backup_assume.json
  permissions_boundary = local.role_boundary
}

resource "aws_iam_role_policy_attachment" "backup" {
  count      = local.backup_enabled ? 1 : 0
  role       = aws_iam_role.backup[0].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSBackupServiceRolePolicyForBackup"
}

resource "aws_backup_plan" "daily" {
  count = local.backup_enabled ? 1 : 0
  name  = "${local.name}-daily"
  rule {
    rule_name         = "daily-locked"
    target_vault_name = aws_backup_vault.locked[0].name
    # 08:30 UTC: after RDS's own backup window (07:00-08:00), between evening and morning shifts.
    schedule          = "cron(30 8 * * ? *)"
    start_window      = 60
    completion_window = 240
    lifecycle {
      delete_after = var.backup_retention_days
    }
    dynamic "copy_action" {
      for_each = var.backup_copy_vault_arn == "" ? [] : [var.backup_copy_vault_arn]
      content {
        destination_vault_arn = copy_action.value
        lifecycle {
          delete_after = var.backup_retention_days
        }
      }
    }
  }
}

resource "aws_backup_selection" "database" {
  count        = local.backup_enabled ? 1 : 0
  name         = "${local.name}-database"
  plan_id      = aws_backup_plan.daily[0].id
  iam_role_arn = aws_iam_role.backup[0].arn
  resources    = [aws_db_instance.main.arn]
}

# Failed backup and copy jobs page the on-call address like any alarm (alarms.tf allows
# backup.amazonaws.com to publish).
resource "aws_backup_vault_notifications" "locked" {
  count               = local.backup_enabled ? 1 : 0
  backup_vault_name   = aws_backup_vault.locked[0].name
  sns_topic_arn       = aws_sns_topic.alarms.arn
  backup_vault_events = ["BACKUP_JOB_FAILED", "COPY_JOB_FAILED"]
}
