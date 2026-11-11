locals {
  name = "fh-${var.environment}"
  # Account-wide names (IAM, S3, CloudFront) include the region, so a recovery stack can stand
  # beside the primary in the same account.
  gname = "fh-${var.environment}-${var.region}"
  tags = {
    Project       = "FlexcityHeadquarters"
    Environment   = var.environment
    ManagedBy     = "terraform"
    DataResidency = "Canada"
  }
  azs = slice(data.aws_availability_zones.available.names, 0, var.az_count)
}

data "aws_availability_zones" "available" {
  state = "available"
}

data "aws_caller_identity" "current" {}
