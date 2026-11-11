# Backups and archives (database dumps, exports kept for an organization after offboarding):
# versioned, object-locked, encrypted with our key, never public, replicated to Calgary.
resource "aws_s3_bucket" "backups" {
  bucket              = "${local.gname}-backups-${data.aws_caller_identity.current.account_id}"
  object_lock_enabled = true
}

resource "aws_s3_bucket_versioning" "backups" {
  bucket = aws_s3_bucket.backups.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_object_lock_configuration" "backups" {
  bucket = aws_s3_bucket.backups.id
  rule {
    default_retention {
      mode = "GOVERNANCE"
      days = 35
    }
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "backups" {
  bucket = aws_s3_bucket.backups.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.data.arn
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "backups" {
  bucket                  = aws_s3_bucket.backups.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "backups" {
  bucket = aws_s3_bucket.backups.id
  rule {
    id     = "expire-old-versions"
    status = "Enabled"
    filter {}
    noncurrent_version_expiration {
      noncurrent_days = 90
    }
  }
}

resource "aws_s3_bucket" "backups_dr" {
  count               = var.recovery_mode ? 0 : 1
  provider            = aws.dr
  bucket              = "${local.gname}-backups-dr-${data.aws_caller_identity.current.account_id}"
  object_lock_enabled = true
}

resource "aws_s3_bucket_versioning" "backups_dr" {
  count    = var.recovery_mode ? 0 : 1
  provider = aws.dr
  bucket   = aws_s3_bucket.backups_dr[0].id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "backups_dr" {
  count    = var.recovery_mode ? 0 : 1
  provider = aws.dr
  bucket   = aws_s3_bucket.backups_dr[0].id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.data_dr[0].arn
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "backups_dr" {
  count                   = var.recovery_mode ? 0 : 1
  provider                = aws.dr
  bucket                  = aws_s3_bucket.backups_dr[0].id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

data "aws_iam_policy_document" "replication_assume" {
  count = var.recovery_mode ? 0 : 1
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["s3.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "replication" {
  count              = var.recovery_mode ? 0 : 1
  name               = "${local.gname}-s3-replication"
  assume_role_policy = data.aws_iam_policy_document.replication_assume[0].json
}

data "aws_iam_policy_document" "replication" {
  count = var.recovery_mode ? 0 : 1
  statement {
    actions   = ["s3:GetReplicationConfiguration", "s3:ListBucket"]
    resources = [aws_s3_bucket.backups.arn]
  }
  statement {
    actions   = ["s3:GetObjectVersionForReplication", "s3:GetObjectVersionAcl", "s3:GetObjectVersionTagging", "s3:GetObjectRetention", "s3:GetObjectLegalHold"]
    resources = ["${aws_s3_bucket.backups.arn}/*"]
  }
  statement {
    actions   = ["s3:ReplicateObject", "s3:ReplicateDelete", "s3:ReplicateTags", "s3:ObjectOwnerOverrideToBucketOwner"]
    resources = ["${aws_s3_bucket.backups_dr[0].arn}/*"]
  }
  statement {
    actions   = ["kms:Decrypt"]
    resources = [aws_kms_key.data.arn]
  }
  statement {
    actions   = ["kms:Encrypt", "kms:GenerateDataKey"]
    resources = [aws_kms_key.data_dr[0].arn]
  }
}

resource "aws_iam_role_policy" "replication" {
  count  = var.recovery_mode ? 0 : 1
  role   = aws_iam_role.replication[0].id
  policy = data.aws_iam_policy_document.replication[0].json
}

resource "aws_s3_bucket_replication_configuration" "backups" {
  count      = var.recovery_mode ? 0 : 1
  bucket     = aws_s3_bucket.backups.id
  role       = aws_iam_role.replication[0].arn
  depends_on = [aws_s3_bucket_versioning.backups, aws_s3_bucket_versioning.backups_dr[0]]
  rule {
    id     = "to-calgary"
    status = "Enabled"
    filter {}
    delete_marker_replication {
      status = "Disabled"
    }
    source_selection_criteria {
      sse_kms_encrypted_objects {
        status = "Enabled"
      }
    }
    destination {
      bucket        = aws_s3_bucket.backups_dr[0].arn
      storage_class = "STANDARD_IA"
      encryption_configuration {
        replica_kms_key_id = aws_kms_key.data_dr[0].arn
      }
    }
  }
}

# Load balancer access logs (no request bodies; addresses and paths), 90 days.
resource "aws_s3_bucket" "logs" {
  bucket = "${local.gname}-lb-logs-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket_server_side_encryption_configuration" "logs" {
  bucket = aws_s3_bucket.logs.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256" # load balancer logs can't use a KMS key
    }
  }
}

resource "aws_s3_bucket_public_access_block" "logs" {
  bucket                  = aws_s3_bucket.logs.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "logs" {
  bucket = aws_s3_bucket.logs.id
  rule {
    id     = "expire"
    status = "Enabled"
    filter {}
    expiration {
      days = 90
    }
  }
}

data "aws_elb_service_account" "main" {}

data "aws_iam_policy_document" "logs" {
  statement {
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.logs.arn}/alb/AWSLogs/${data.aws_caller_identity.current.account_id}/*"]
    principals {
      type        = "AWS"
      identifiers = [data.aws_elb_service_account.main.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "logs" {
  bucket = aws_s3_bucket.logs.id
  policy = data.aws_iam_policy_document.logs.json
}

# Container images: scanned on push, tags never overwritten.
resource "aws_ecr_repository" "repo" {
  for_each             = var.recovery_mode ? toset([]) : toset(["api", "web", "migrate"])
  name                 = "${local.name}-${each.key}"
  image_tag_mutability = "IMMUTABLE"
  image_scanning_configuration {
    scan_on_push = true
  }
  encryption_configuration {
    encryption_type = "KMS"
    kms_key         = aws_kms_key.data.arn
  }
}

# Images are copied to the recovery region as they are pushed.
resource "aws_ecr_replication_configuration" "dr" {
  count = var.recovery_mode ? 0 : 1
  replication_configuration {
    rule {
      destination {
        region      = var.dr_region
        registry_id = data.aws_caller_identity.current.account_id
      }
      repository_filter {
        filter      = "${local.name}-"
        filter_type = "PREFIX_MATCH"
      }
    }
  }
}

# Recovery: the copies already in this region.
data "aws_ecr_repository" "replicated" {
  for_each = var.recovery_mode ? toset(["api", "web", "migrate"]) : toset([])
  name     = "${local.name}-${each.key}"
}

locals {
  repo_urls = merge({ for k, r in aws_ecr_repository.repo : k => r.repository_url }, { for k, r in data.aws_ecr_repository.replicated : k => r.repository_url })
}

resource "aws_ecr_lifecycle_policy" "repo" {
  for_each   = aws_ecr_repository.repo
  repository = each.value.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep the last 50 images"
      selection    = { tagStatus = "any", countType = "imageCountMoreThan", countNumber = 50 }
      action       = { type = "expire" }
    }]
  })
}

# The app's settings that are secret, as one JSON object filled in by hand (never in Terraform
# state): JWT_SECRET, APP_DATABASE_URL, LISTEN_DATABASE_URL, METRICS_TOKEN, DATABASE_URL (owner,
# for migrations), and the optional provider keys. See ops/terraform/README.md.
# Copied to the recovery region (read-only there until promoted).
resource "aws_secretsmanager_secret" "app" {
  count      = var.recovery_mode ? 0 : 1
  name       = "${local.name}/app"
  kms_key_id = aws_kms_key.data.arn
  replica {
    region     = var.dr_region
    kms_key_id = aws_kms_key.data_dr[0].arn
  }
}

# Recovery: the copy already in this region.
data "aws_secretsmanager_secret" "app" {
  count = var.recovery_mode ? 1 : 0
  name  = "${local.name}/app"
}

locals {
  app_secret_arn = var.recovery_mode ? data.aws_secretsmanager_secret.app[0].arn : aws_secretsmanager_secret.app[0].arn
  # Keys that can open the app secret here: ours, and in recovery the primary stack's copy key.
  secret_key_arns = var.recovery_mode ? [aws_kms_key.data.arn, data.aws_kms_alias.recovery[0].target_key_arn] : [aws_kms_key.data.arn]
}
