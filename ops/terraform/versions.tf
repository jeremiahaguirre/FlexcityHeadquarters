terraform {
  required_version = ">= 1.6.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "5.100.0"
    }
  }
  # State in S3 in Canada, encrypted and versioned, with a DynamoDB lock: the bucket and table come
  # from ops/terraform/bootstrap (once per account). The settings are given at init, per
  # environment: terraform init -backend-config=backend/production.s3.tfbackend
  # (backend/example.s3.tfbackend; in CI, the <ENV>_TF_BACKEND repository variable). Checks that
  # need no state use terraform init -backend=false.
  backend "s3" {}
}

# Everything with customer data: Canada Central (Montreal).
provider "aws" {
  region = var.region
  default_tags {
    tags = local.tags
  }
}

# Disaster recovery copies: Canada West (Calgary).
provider "aws" {
  alias  = "dr"
  region = var.dr_region
  default_tags {
    tags = local.tags
  }
}

# CloudFront's web firewall is global and must be created in us-east-1. Only firewall rules live
# there (no customer data): the marketing site's AI-crawler block and rate limit (edge.tf).
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"
  default_tags {
    tags = local.tags
  }
}
