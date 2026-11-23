# Keys created here. Each organization's own key (alias/flexcity-tenant-<id>) is created by the
# API on first use (apps/api/src/services/crypto), multi-region and copied to var.dr_region.
#
# Use a dedicated AWS account for each environment: the API may use any KMS key in its account
# and regions (see iam.tf), which is safe only when every key there belongs to FlexcityHeadquarters.

# The platform key (KMS_KEY_ARN, alias/flexcity-platform): FH's own sealed values, such as
# pre-authorized debit details for billing.
resource "aws_kms_key" "platform" {
  count               = var.recovery_mode ? 0 : 1
  description         = "FlexcityHeadquarters platform key (${var.environment})"
  multi_region        = true
  enable_key_rotation = true
}

resource "aws_kms_alias" "platform" {
  count         = var.recovery_mode ? 0 : 1
  name          = "alias/flexcity-platform"
  target_key_id = aws_kms_key.platform[0].key_id
}

resource "aws_kms_replica_key" "platform_dr" {
  count           = var.recovery_mode ? 0 : 1
  provider        = aws.dr
  description     = "FlexcityHeadquarters platform key (${var.environment}), recovery copy"
  primary_key_arn = aws_kms_key.platform[0].arn
}

resource "aws_kms_alias" "platform_dr" {
  count         = var.recovery_mode ? 0 : 1
  provider      = aws.dr
  name          = "alias/flexcity-platform"
  target_key_id = aws_kms_replica_key.platform_dr[0].key_id
}

# The Dev console's Trust evidence files are sealed under alias/flexcity-trust
# (apps/api/src/routes/platform/trust.ts): FH's own records, so the platform key, under a second
# name that could later point at a key of its own. The API never creates these aliases itself.
resource "aws_kms_alias" "trust" {
  count         = var.recovery_mode ? 0 : 1
  name          = "alias/flexcity-trust"
  target_key_id = aws_kms_key.platform[0].key_id
}

resource "aws_kms_alias" "trust_dr" {
  count         = var.recovery_mode ? 0 : 1
  provider      = aws.dr
  name          = "alias/flexcity-trust"
  target_key_id = aws_kms_replica_key.platform_dr[0].key_id
}

# Infrastructure keys: database, backups bucket, secrets, container images.
# The policy is the default one (the account administers the key through IAM), plus, when daily
# snapshots are copied to another account (backup.tf), what that account needs to copy them:
# AWS Backup's snapshots stay encrypted under this key, so without it every copy job fails.
data "aws_iam_policy_document" "data_key" {
  statement {
    sid       = "AccountAdministers"
    actions   = ["kms:*"]
    resources = ["*"]
    principals {
      type        = "AWS"
      identifiers = ["arn:aws:iam::${data.aws_caller_identity.current.account_id}:root"]
    }
  }
  dynamic "statement" {
    for_each = local.backup_copy_account == "" ? [] : [local.backup_copy_account]
    content {
      sid       = "BackupCopyAccountUses"
      actions   = ["kms:Decrypt", "kms:DescribeKey"]
      resources = ["*"]
      principals {
        type        = "AWS"
        identifiers = ["arn:aws:iam::${statement.value}:root"]
      }
    }
  }
  dynamic "statement" {
    for_each = local.backup_copy_account == "" ? [] : [local.backup_copy_account]
    content {
      sid       = "BackupCopyAccountGrants"
      actions   = ["kms:CreateGrant"]
      resources = ["*"]
      principals {
        type        = "AWS"
        identifiers = ["arn:aws:iam::${statement.value}:root"]
      }
      condition {
        test     = "Bool"
        variable = "kms:GrantIsForAWSResource"
        values   = ["true"]
      }
    }
  }
}

resource "aws_kms_key" "data" {
  description         = "FlexcityHeadquarters database, backups and secrets (${var.environment})"
  enable_key_rotation = true
  policy              = data.aws_iam_policy_document.data_key.json
}

resource "aws_kms_alias" "data" {
  name          = "alias/${local.name}-data"
  target_key_id = aws_kms_key.data.key_id
}

# Encrypts the database backups and bucket copies kept in the recovery region.
resource "aws_kms_key" "data_dr" {
  count               = var.recovery_mode ? 0 : 1
  provider            = aws.dr
  description         = "FlexcityHeadquarters recovery copies (${var.environment})"
  enable_key_rotation = true
}

resource "aws_kms_alias" "data_dr" {
  count         = var.recovery_mode ? 0 : 1
  provider      = aws.dr
  name          = "alias/${local.name}-recovery"
  target_key_id = aws_kms_key.data_dr[0].key_id
}

# Recovery: the primary stack's key for its copies in this region (the replicated app secret).
data "aws_kms_alias" "recovery" {
  count = var.recovery_mode ? 1 : 0
  name  = "alias/${local.name}-recovery"
}

locals {
  platform_key_arn = var.recovery_mode ? var.existing_platform_key_arn : aws_kms_key.platform[0].arn
}

# CloudWatch log groups (the database's exported log, the tasks' logs).
data "aws_iam_policy_document" "logs_key" {
  statement {
    sid       = "AccountAdministers"
    actions   = ["kms:*"]
    resources = ["*"]
    principals {
      type        = "AWS"
      identifiers = ["arn:aws:iam::${data.aws_caller_identity.current.account_id}:root"]
    }
  }
  statement {
    sid       = "CloudWatchLogs"
    actions   = ["kms:Encrypt", "kms:Decrypt", "kms:ReEncrypt*", "kms:GenerateDataKey*", "kms:Describe*"]
    resources = ["*"]
    principals {
      type        = "Service"
      identifiers = ["logs.${var.region}.amazonaws.com"]
    }
    condition {
      test     = "ArnLike"
      variable = "kms:EncryptionContext:aws:logs:arn"
      values   = ["arn:aws:logs:${var.region}:${data.aws_caller_identity.current.account_id}:log-group:*"]
    }
  }
}

resource "aws_kms_key" "logs" {
  description         = "FlexcityHeadquarters CloudWatch logs (${var.environment})"
  enable_key_rotation = true
  policy              = data.aws_iam_policy_document.logs_key.json
}

resource "aws_kms_alias" "logs" {
  name          = "alias/${local.name}-logs"
  target_key_id = aws_kms_key.logs.key_id
}
