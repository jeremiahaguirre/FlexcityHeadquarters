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
  description = "Lock the AWS Backup vault in compliance mode. Irreversible once the grace period ends; false only for throwaway environments."
  type        = bool
  default     = true
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
  description = "Days each daily snapshot in the locked vault is kept (and the lock's minimum)."
  type        = number
  default     = 35
}

variable "backup_copy_vault_arn" {
  description = "ARN of an AWS Backup vault in a separate account (locked in compliance mode) that receives a copy of every daily snapshot. Empty: no cross-account copy."
  type        = string
  default     = ""
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
}

resource "aws_backup_vault" "locked" {
  count       = local.backup_enabled ? 1 : 0
  name        = "${local.name}-locked"
  kms_key_arn = aws_kms_key.data.arn
}

resource "aws_backup_vault_lock_configuration" "locked" {
  count               = local.backup_enabled && var.backup_vault_lock ? 1 : 0
  backup_vault_name   = aws_backup_vault.locked[0].name
  min_retention_days  = var.backup_retention_days
  max_retention_days  = var.backup_retention_days * 12
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
  count              = local.backup_enabled ? 1 : 0
  name               = "${local.gname}-backup"
  assume_role_policy = data.aws_iam_policy_document.backup_assume.json
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
