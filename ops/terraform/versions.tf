terraform {
  required_version = ">= 1.6.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "5.100.0"
    }
  }
  # State in S3 in Canada, with locking. Create the bucket and table once by hand, then uncomment.
  # backend "s3" {
  #   bucket         = "fh-terraform-state-<account-id>"
  #   key            = "production/terraform.tfstate"
  #   region         = "ca-central-1"
  #   dynamodb_table = "fh-terraform-locks"
  #   encrypt        = true
  # }
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
