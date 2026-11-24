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
  assert {
    condition     = !contains(keys(aws_cloudwatch_metric_alarm.main), "union-unhealthy") && !contains(keys(aws_cloudwatch_metric_alarm.error_ratio), "union") && length(aws_iam_role.union_execution) == 0
    error_message = "No union alarms or roles without the separate hub."
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
    condition     = aws_vpc_security_group_ingress_rule.union_alb[0].from_port == 4100 && aws_vpc_security_group_ingress_rule.db_union[0].to_port == 5432 && aws_vpc_security_group_ingress_rule.api_union[0].from_port == 4000
    error_message = "The Union Hub takes the load balancer only, and reaches the database and the API."
  }
  # Review of #75.
  assert {
    condition     = [for s in local.union_secrets : s.name] == ["UNION_DATABASE_URL"] && !contains(keys(local.union_env), "APP_DATABASE_URL") && !contains(keys(local.union_env), "JWT_SECRET")
    error_message = "The hub gets the union role only: neither the app role nor the token secret (high finding)."
  }
  assert {
    condition     = local.union_env["API_URL"] == "http://api.fh-production.internal:4000" && local.union_env["FLEXCITY_SERVICE"] == "union"
    error_message = "The hub asks the main API, at its private address, to check sign-ins."
  }
  assert {
    condition     = alltrue([for st in data.aws_iam_policy_document.union.statement : anytrue([for c in st.condition : c.variable == "aws:ResourceTag/fh:union-local" && c.test == "StringEquals" && toset(c.values) == toset(["true"])])])
    error_message = "The hub's role may use union locals' keys only (medium finding)."
  }
  assert {
    condition     = contains(keys(aws_cloudwatch_metric_alarm.main), "union-unhealthy") && contains(keys(aws_cloudwatch_metric_alarm.error_ratio), "union") && one(aws_ecs_service.union[0].alarms).rollback && length(one(aws_ecs_service.union[0].alarms).alarm_names) == 2
    error_message = "The hub has its own alarms, which roll back a deployment (medium finding)."
  }
  assert {
    condition     = aws_iam_role.union_execution[0].name == "fh-production-ca-central-1-union-execution" && length(data.aws_iam_policy_document.union_execution_secret[0].statement) == 2
    error_message = "The union task has its own execution role (low finding)."
  }
}

# The deploy pipeline (#58): every role carries the environment's permissions boundary, or the
# deploy workflow can't create it.
run "union_roles_carry_the_deploy_boundary" {
  command = plan
  variables {
    union_hub_separate = true
    github_repository  = "example-org/example-repo"
  }
  assert {
    condition     = alltrue([for b in [aws_iam_role.union_execution[0].permissions_boundary, aws_iam_role.union[0].permissions_boundary] : b == "arn:aws:iam::111122223333:policy/fh-production-ca-central-1-deploy-boundary"])
    error_message = "The union task and execution roles carry the deploy boundary."
  }
}

run "union_roles_without_deployments" {
  command = plan
  variables {
    union_hub_separate = true
  }
  assert {
    condition     = aws_iam_role.union_execution[0].permissions_boundary == null && aws_iam_role.union[0].permissions_boundary == null
    error_message = "Without github_repository, no boundary is set (as for the other roles)."
  }
}
