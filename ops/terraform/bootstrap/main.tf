# Once per AWS account, before the first `terraform apply` of ops/terraform: the bucket and lock
# table that hold that account's Terraform state (docs/DEPLOYING.md, "First deployment").
#
#   cd ops/terraform/bootstrap
#   terraform init && terraform apply
#   terraform output -raw backend_config > ../backend/<env>.s3.tfbackend
#
# This configuration keeps its own (tiny) state locally; it has no secrets. Keep the file, or
# re-import the two resources if it is lost.
terraform {
  required_version = ">= 1.6.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "5.100.0"
    }
  }
}

variable "region" {
  description = "Where the state lives. Must be in Canada."
  type        = string
  default     = "ca-central-1"
  validation {
    condition     = startswith(var.region, "ca-")
    error_message = "State stays in Canada: use a ca- region."
  }
}

provider "aws" {
  region = var.region
  default_tags {
    tags = { Project = "FlexcityHeadquarters", ManagedBy = "terraform", DataResidency = "Canada" }
  }
}

data "aws_caller_identity" "current" {}

# Versioned (every state kept, so a bad apply can be undone), encrypted, never public.
resource "aws_s3_bucket" "state" {
  bucket = "fh-terraform-state-${data.aws_caller_identity.current.account_id}"
  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_versioning" "state" {
  bucket = aws_s3_bucket.state.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "state" {
  bucket = aws_s3_bucket.state.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "aws:kms"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "state" {
  bucket                  = aws_s3_bucket.state.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "state" {
  bucket = aws_s3_bucket.state.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

# Old state versions are kept 90 days.
resource "aws_s3_bucket_lifecycle_configuration" "state" {
  bucket = aws_s3_bucket.state.id
  rule {
    id     = "old-versions"
    status = "Enabled"
    filter {}
    noncurrent_version_expiration {
      noncurrent_days = 90
    }
  }
}

# TLS only.
data "aws_iam_policy_document" "state" {
  statement {
    sid       = "TlsOnly"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.state.arn, "${aws_s3_bucket.state.arn}/*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "state" {
  bucket = aws_s3_bucket.state.id
  policy = data.aws_iam_policy_document.state.json
}

resource "aws_dynamodb_table" "locks" {
  name         = "fh-terraform-locks"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "LockID"
  attribute {
    name = "LockID"
    type = "S"
  }
  server_side_encryption {
    enabled = true
  }
  point_in_time_recovery {
    enabled = true
  }
  lifecycle {
    prevent_destroy = true
  }
}

output "backend_config" {
  description = "The backend settings for ops/terraform (key: one per environment; replace <env>)."
  value       = <<-EOT
    bucket         = "${aws_s3_bucket.state.bucket}"
    key            = "<env>/terraform.tfstate"
    region         = "${var.region}"
    dynamodb_table = "${aws_dynamodb_table.locks.name}"
    encrypt        = true
  EOT
}
