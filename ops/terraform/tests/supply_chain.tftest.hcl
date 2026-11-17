# Supply chain (SECURITY-AUDIT SEC-55): pushed images are re-scanned as new CVEs are published.
# Mocked AWS providers, as in plan.tftest.hcl:
#   terraform init -backend=false && terraform test -filter=tests/supply_chain.tftest.hcl
mock_provider "aws" {
  mock_data "aws_availability_zones" {
    defaults = { names = ["ca-central-1a", "ca-central-1b", "ca-central-1d"] }
  }
  mock_data "aws_caller_identity" {
    defaults = { account_id = "111122223333" }
  }
  mock_data "aws_elb_service_account" {
    defaults = { arn = "arn:aws:iam::985666609251:root" }
  }
  mock_data "aws_iam_policy_document" {
    defaults = { json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}" }
  }
  mock_resource "aws_db_instance" {
    defaults = { master_user_secret = [{ secret_arn = "arn:aws:secretsmanager:ca-central-1:111122223333:secret:rds", kms_key_id = "k", secret_status = "active" }] }
  }
}

mock_provider "aws" {
  alias = "dr"
}

mock_provider "aws" {
  alias = "us_east_1"
}

variables {
  environment     = "production"
  root_domain     = "example.ca"
  certificate_arn = "arn:aws:acm:ca-central-1:111122223333:certificate/abc"
  image_tag       = "abc123"
}

run "images_rescanned_continuously" {
  command = plan
  assert {
    condition     = aws_ecr_registry_scanning_configuration.main[0].scan_type == "ENHANCED" && one(aws_ecr_registry_scanning_configuration.main[0].rule).scan_frequency == "CONTINUOUS_SCAN"
    error_message = "Container images are re-scanned continuously, not only on push."
  }
  assert {
    condition     = one(one(aws_ecr_registry_scanning_configuration.main[0].rule).repository_filter).filter == "fh-production-*"
    error_message = "Continuous scanning covers this environment's repositories."
  }
}

run "continuous_scanning_can_be_turned_off" {
  command = plan
  variables {
    ecr_continuous_scanning = false
  }
  assert {
    condition     = length(aws_ecr_registry_scanning_configuration.main) == 0 && aws_ecr_repository.repo["api"].image_scanning_configuration[0].scan_on_push
    error_message = "Without continuous scanning, images are still scanned on push."
  }
}
