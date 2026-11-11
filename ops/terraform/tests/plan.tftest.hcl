# Plans the whole configuration against mocked AWS providers (no account or network needed):
#   terraform init -backend=false && terraform test
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

variables {
  environment     = "production"
  root_domain     = "example.ca"
  certificate_arn = "arn:aws:acm:ca-central-1:111122223333:certificate/abc"
  image_tag       = "abc123"
}

run "production_defaults" {
  command = plan

  assert {
    condition     = length(aws_subnet.private) == 3 && length(aws_subnet.database) == 3
    error_message = "Expected three zones."
  }
  assert {
    condition     = aws_db_instance.main.multi_az && aws_db_instance.main.storage_encrypted && aws_db_instance.main.deletion_protection
    error_message = "Production database must be Multi-AZ, encrypted and protected from deletion."
  }
  assert {
    condition     = aws_db_instance.main.backup_retention_period == 35
    error_message = "35 days of point-in-time recovery expected."
  }
  assert {
    condition     = length(aws_db_instance.replica) == 0
    error_message = "No read replica unless asked."
  }
  assert {
    condition     = aws_kms_key.platform.multi_region && aws_kms_key.platform.enable_key_rotation
    error_message = "Platform key must be multi-region with rotation."
  }
  assert {
    condition     = toset(keys(aws_ecs_service.svc)) == toset(["api", "web", "worker"])
    error_message = "Expected the api, web and worker services."
  }
  assert {
    condition     = aws_ecs_service.svc["api"].desired_count == 2 && aws_ecs_service.svc["worker"].desired_count == 2
    error_message = "At least two API tasks and two workers."
  }
  assert {
    condition     = aws_lb_target_group.api.health_check[0].path == "/readyz"
    error_message = "API health check must be /readyz."
  }
  assert {
    condition     = length(aws_nat_gateway.main) == 1
    error_message = "One NAT gateway by default."
  }
  assert {
    condition     = local.app_env["KMS_REPLICA_REGION"] == "ca-west-1" && local.app_env["NODE_ENV"] == "production" && local.app_env["PUBLIC_APP_URL"] == "https://{subdomain}.example.ca"
    error_message = "API must be told the recovery region for keys."
  }
  assert {
    condition     = toset([for x in local.app_secrets : x.name]) == toset(["JWT_SECRET", "APP_DATABASE_URL", "LISTEN_DATABASE_URL", "METRICS_TOKEN"]) && !contains(keys(local.app_env), "JWT_SECRET")
    error_message = "Secrets come from Secrets Manager, never plain environment."
  }
}

run "staging_with_replica_and_site" {
  command = plan
  variables {
    environment          = "staging"
    db_read_replica      = true
    nat_gateways         = 3
    site_domain          = "www.example.ca"
    site_certificate_arn = "arn:aws:acm:us-east-1:111122223333:certificate/def"
  }
  assert {
    condition     = length(aws_db_instance.replica) == 1 && length(aws_cloudwatch_metric_alarm.replica_lag) == 1
    error_message = "Replica and its lag alarm expected."
  }
  assert {
    condition     = !aws_db_instance.main.deletion_protection && aws_db_instance.main.skip_final_snapshot
    error_message = "Staging can be torn down."
  }
  assert {
    condition     = length(aws_nat_gateway.main) == 3
    error_message = "One NAT per zone when asked."
  }
}

run "rejects_regions_outside_canada" {
  command = plan
  variables {
    region = "us-east-1"
  }
  expect_failures = [var.region]
}

run "site_domain_needs_certificate" {
  command = plan
  variables {
    site_domain = "www.example.ca"
  }
  expect_failures = [aws_cloudfront_distribution.site]
}

run "nat_count_bounded" {
  command = plan
  variables {
    nat_gateways = 4
  }
  expect_failures = [aws_nat_gateway.main]
}
