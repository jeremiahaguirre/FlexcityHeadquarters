# Alarms that are delivered and roll back bad releases (SECURITY-AUDIT SEC-50, SEC-51;
# ARCHITECTURE-REVIEW A13, A14). Mocked AWS providers, as in plan.tftest.hcl:
#   terraform init -backend=false && terraform test -filter=tests/alarms.tftest.hcl
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

run "alarms_are_delivered" {
  command = plan
  assert {
    condition     = aws_sns_topic.alarms.kms_master_key_id == "alias/fh-production-alarms"
    error_message = "CloudWatch alarms cannot publish to a topic under the AWS-managed SNS key (SEC-50)."
  }
  assert {
    condition     = anytrue([for s in data.aws_iam_policy_document.alarms_key.statement : contains(flatten([for p in s.principals : p.identifiers]), "cloudwatch.amazonaws.com") && contains(s.actions, "kms:GenerateDataKey*") && contains(s.actions, "kms:Decrypt")])
    error_message = "The topic's key must let CloudWatch encrypt notifications."
  }
  assert {
    condition     = aws_kms_key.alarms.enable_key_rotation
    error_message = "The alarm key rotates."
  }
  assert {
    condition     = anytrue([for s in data.aws_iam_policy_document.alarms_topic.statement : contains(s.actions, "sns:Publish") && contains(flatten([for p in s.principals : p.identifiers]), "cloudwatch.amazonaws.com")])
    error_message = "The topic policy lets this account's CloudWatch alarms publish."
  }
}

run "missing_data" {
  command = plan
  assert {
    condition     = aws_cloudwatch_metric_alarm.main["alb-5xx"].treat_missing_data == "notBreaching"
    error_message = "The ALB publishes 5xx only for minutes that had one: an empty minute is healthy (SEC-51)."
  }
  assert {
    condition     = aws_cloudwatch_metric_alarm.main["api-unhealthy"].treat_missing_data == "breaching" && aws_cloudwatch_metric_alarm.main["db-storage"].treat_missing_data == "breaching"
    error_message = "A missing health or database metric still alarms."
  }
}

run "error_ratio_alarms" {
  command = plan
  assert {
    condition     = toset(keys(aws_cloudwatch_metric_alarm.error_ratio)) == toset(["api", "web"])
    error_message = "One server-error ratio alarm per service behind the load balancer (A13)."
  }
  assert {
    condition     = aws_cloudwatch_metric_alarm.error_ratio["api"].threshold == 5 && aws_cloudwatch_metric_alarm.error_ratio["api"].treat_missing_data == "notBreaching" && aws_cloudwatch_metric_alarm.error_ratio["api"].datapoints_to_alarm == 3
    error_message = "5% of requests in 3 of 5 minutes; quiet minutes are healthy."
  }
  assert {
    condition     = strcontains(one([for q in aws_cloudwatch_metric_alarm.error_ratio["api"].metric_query : q.expression if q.return_data == true]), "requests >= 20")
    error_message = "Too few requests in a minute never alarm."
  }
}

run "deployments_roll_back_on_alarm" {
  command = plan
  assert {
    condition     = one(aws_ecs_service.svc["api"].alarms).enable && one(aws_ecs_service.svc["api"].alarms).rollback && contains(one(aws_ecs_service.svc["api"].alarms).alarm_names, "fh-production-api-5xx-ratio")
    error_message = "An API release that fails requests is rolled back (A14)."
  }
  assert {
    condition     = one(aws_ecs_service.svc["web"].alarms).rollback && contains(one(aws_ecs_service.svc["web"].alarms).alarm_names, "fh-production-web-unhealthy")
    error_message = "A web release that fails is rolled back."
  }
  assert {
    condition     = length(aws_ecs_service.svc["worker"].alarms) == 0 && one(aws_ecs_service.svc["worker"].deployment_circuit_breaker).rollback
    error_message = "The worker keeps the circuit breaker only."
  }
}
