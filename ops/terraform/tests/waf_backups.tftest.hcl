# The app firewall inspects and logs; backups survive a compromised account (SECURITY-AUDIT SEC-72, SEC-71).
# Mocked AWS providers, as in plan.tftest.hcl.
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


run "firewall_inspects_and_logs" {
  command = plan
  assert {
    condition     = length([for r in aws_wafv2_web_acl.app.rule : r if r.name == "common" && try(length(one(one(r.statement).managed_rule_group_statement).rule_action_override), -1) == 0]) == 1
    error_message = "Outside the API, the common rule set blocks oversized bodies (no size override) (SEC-72)."
  }
  assert {
    condition     = length([for r in aws_wafv2_web_acl.app.rule : r if r.name == "common-api" && try(one(one(r.statement).managed_rule_group_statement).rule_action_override[0].name, "") == "SizeRestrictions_BODY"]) == 1
    error_message = "Only the API counts oversized bodies (uploads), and it limits them itself."
  }
  assert {
    condition     = length([for r in aws_wafv2_web_acl.app.rule : r if r.name == "sql-injection" && try(length(one(r.override_action).count), 0) == 1]) == 1
    error_message = "The SQL injection rules are counted (logged) by default."
  }
  assert {
    condition     = startswith(aws_cloudwatch_log_group.waf.name, "aws-waf-logs-") && aws_cloudwatch_log_group.waf.retention_in_days == 90
    error_message = "The firewall logs to a log group AWS accepts, kept 90 days."
  }
  assert {
    condition     = toset([for f in aws_wafv2_web_acl_logging_configuration.app.redacted_fields : one(f.single_header).name]) == toset(["authorization", "cookie", "x-kiosk-token"])
    error_message = "Credentials never reach the firewall log."
  }
  assert {
    condition     = one(aws_wafv2_web_acl_logging_configuration.app.logging_filter).default_behavior == "DROP"
    error_message = "Only blocked and counted requests are logged."
  }
}

run "sqli_can_block" {
  command = plan
  variables {
    waf_sqli_block = true
  }
  assert {
    condition     = length([for r in aws_wafv2_web_acl.app.rule : r if r.name == "sql-injection" && try(length(one(r.override_action).none), 0) == 1]) == 1
    error_message = "waf_sqli_block = true makes the SQL injection rules block."
  }
}

run "backups_survive_a_compromised_account" {
  command = plan
  assert {
    condition     = aws_backup_vault_lock_configuration.locked[0].min_retention_days == 35 && aws_backup_vault_lock_configuration.locked[0].changeable_for_days == 3
    error_message = "Daily snapshots go to a vault under a compliance lock (SEC-71)."
  }
  assert {
    condition     = one(aws_backup_plan.daily[0].rule).target_vault_name == "fh-production-locked" && length(one(aws_backup_plan.daily[0].rule).copy_action) == 0
    error_message = "The daily plan targets the locked vault; no cross-account copy unless asked."
  }
  assert {
    condition     = one(one(aws_s3_bucket_object_lock_configuration.backups.rule).default_retention).mode == "COMPLIANCE"
    error_message = "Production backups in S3 are locked in compliance mode."
  }
}

run "staging_and_cross_account_copy" {
  command = plan
  variables {
    environment           = "staging"
    backup_copy_vault_arn = "arn:aws:backup:ca-central-1:444455556666:backup-vault:fh-copies"
  }
  assert {
    condition     = one(one(aws_s3_bucket_object_lock_configuration.backups.rule).default_retention).mode == "GOVERNANCE"
    error_message = "Staging keeps governance mode so it can be torn down."
  }
  assert {
    condition     = one(one(aws_backup_plan.daily[0].rule).copy_action).destination_vault_arn == "arn:aws:backup:ca-central-1:444455556666:backup-vault:fh-copies"
    error_message = "Every daily snapshot is copied to the other account's vault."
  }
}
