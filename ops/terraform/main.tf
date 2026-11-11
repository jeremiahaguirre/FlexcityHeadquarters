locals {
  name = "fh-${var.environment}"
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
