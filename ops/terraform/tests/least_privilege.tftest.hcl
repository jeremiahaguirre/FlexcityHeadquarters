# Least privilege for the tasks, the app's KMS rights and the database log (SECURITY-AUDIT SEC-42,
# SEC-52, SEC-53). Mocked AWS providers, as in plan.tftest.hcl:
#   terraform init -backend=false && terraform test -filter=tests/least_privilege.tftest.hcl
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

run "one_security_group_per_kind_of_task" {
  command = plan
  assert {
    condition     = [for k in ["api", "web", "worker"] : local.services[k].sg_name] == ["fh-production-api", "fh-production-web", "fh-production-worker"]
    error_message = "The API, web and worker services each have their own security group (SEC-53)."
  }
  assert {
    condition     = toset(keys(aws_vpc_security_group_ingress_rule.db_from)) == toset(["api", "worker", "jobs"])
    error_message = "Only the API, worker and one-off tasks reach the database, never the web tasks."
  }
  assert {
    condition     = aws_vpc_security_group_egress_rule.web_https.from_port == 443 && aws_vpc_security_group_egress_rule.web_https.to_port == 443 && aws_vpc_security_group_egress_rule.web_api.from_port == 4000
    error_message = "The web tasks may only call the API and HTTPS."
  }
  assert {
    condition     = aws_vpc_security_group_ingress_rule.api_web.from_port == 4000 && aws_vpc_security_group_ingress_rule.api_alb.from_port == 4000 && aws_vpc_security_group_ingress_rule.web_alb.from_port == 3000
    error_message = "The API takes the load balancer and the web tasks; the web tasks take the load balancer only."
  }
  assert {
    condition     = aws_vpc_security_group_egress_rule.jobs_db.to_port == 5432 && aws_vpc_security_group_egress_rule.jobs_https.to_port == 443
    error_message = "One-off tasks reach the database and HTTPS only."
  }
}

run "app_creates_only_keys_like_its_own" {
  command = plan
  assert {
    condition = alltrue([
      for s in data.aws_iam_policy_document.app.statement : s.sid != "CreateOrganizationKeys" || (
        contains([for c in s.condition : "${c.test} ${c.variable} ${join(",", c.values)}"], "StringEquals kms:KeySpec SYMMETRIC_DEFAULT") &&
        contains([for c in s.condition : "${c.test} ${c.variable} ${join(",", c.values)}"], "StringEquals kms:KeyUsage ENCRYPT_DECRYPT") &&
        contains([for c in s.condition : "${c.test} ${c.variable} ${join(",", c.values)}"], "StringEqualsIfExists kms:KeyOrigin AWS_KMS")
      )
    ])
    error_message = "CreateKey only for KMS-generated symmetric encryption keys (SEC-52)."
  }
  assert {
    condition     = anytrue([for s in data.aws_iam_policy_document.app.statement : s.effect == "Deny" && contains(s.actions, "kms:CreateKey") && contains([for c in s.condition : c.variable], "kms:BypassPolicyLockoutSafetyCheck")])
    error_message = "The app can never bypass the key policy lockout safety check."
  }
  assert {
    condition     = strcontains(aws_cloudwatch_event_rule.kms_create_key_with_policy.event_pattern, "\"CreateKey\"") && strcontains(aws_cloudwatch_event_rule.kms_create_key_with_policy.event_pattern, "\"policy\"")
    error_message = "A CreateKey carrying a custom key policy raises an alarm."
  }
}

run "database_log_without_values" {
  command = plan
  assert {
    condition     = contains([for p in aws_db_parameter_group.main.parameter : "${p.name}=${p.value}"], "log_parameter_max_length=0") && contains([for p in aws_db_parameter_group.main.parameter : "${p.name}=${p.value}"], "log_parameter_max_length_on_error=0")
    error_message = "The slow-statement log never carries bound values (SEC-42)."
  }
  assert {
    condition     = aws_cloudwatch_log_group.postgresql.name == "/aws/rds/instance/fh-production/postgresql" && aws_cloudwatch_log_group.postgresql.retention_in_days == 30
    error_message = "The exported database log is managed here, with a retention period."
  }
  assert {
    condition     = aws_kms_key.logs.enable_key_rotation && anytrue([for s in data.aws_iam_policy_document.logs_key.statement : contains(flatten([for p in s.principals : p.identifiers]), "logs.ca-central-1.amazonaws.com")])
    error_message = "Log groups are encrypted under a key CloudWatch Logs may use."
  }
}
