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
