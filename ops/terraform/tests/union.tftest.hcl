# The Union Hub as its own service (ARCHITECTURE-REVIEW A27; SECURITY-AUDIT SEC-61).
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


run "embedded_by_default" {
  command = plan
  assert {
    condition     = length(aws_ecs_service.union) == 0 && length(aws_lb_listener_rule.union) == 0 && !contains(keys(local.app_env), "UNION_HUB_MODE")
    error_message = "Without union_hub_separate, nothing changes."
  }
}

run "union_hub_as_its_own_service" {
  command = plan
  variables {
    union_hub_separate = true
  }
  assert {
    condition     = aws_ecs_service.union[0].desired_count == 2 && aws_lb_listener_rule.union[0].priority < aws_lb_listener_rule.api.priority
    error_message = "Its own service, and /api/union/* is routed to it before /api/* reaches the main API (A27)."
  }
  assert {
    condition     = contains(one(one(aws_lb_listener_rule.union[0].condition).path_pattern).values, "/api/union/*")
    error_message = "The Union Hub's rule covers /api/union/*."
  }
  assert {
    condition     = local.union_command == ["node", "dist/unionServer.js"] && aws_ecs_task_definition.union[0].family == "fh-production-union"
    error_message = "The union task runs the Union Hub server."
  }
  assert {
    condition     = contains([for s in local.union_secrets : s.name], "UNION_DATABASE_URL") && !contains([for s in local.app_secrets : s.name], "UNION_DATABASE_URL")
    error_message = "Only the Union Hub task gets the union database role (SEC-61)."
  }
  assert {
    condition     = local.app_env["UNION_HUB_MODE"] == "separate"
    error_message = "The API and worker run in separate mode (they refuse UNION_DATABASE_URL)."
  }
  assert {
    condition     = anytrue([for s in data.aws_iam_policy_document.app_no_union_keys.statement : s.effect == "Deny" && contains(s.actions, "kms:Decrypt") && contains([for c in s.condition : c.variable], "aws:ResourceTag/fh:union-local")])
    error_message = "The app role can't open a union local's key."
  }
  assert {
    condition     = aws_vpc_security_group_ingress_rule.union_alb[0].from_port == 4100 && aws_vpc_security_group_ingress_rule.db_union[0].to_port == 5432
    error_message = "The Union Hub takes the load balancer only, and reaches the database."
  }
}
