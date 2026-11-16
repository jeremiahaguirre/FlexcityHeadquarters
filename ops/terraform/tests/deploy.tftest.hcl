# The GitHub Actions deploy role (ARCHITECTURE-REVIEW A8). Mocked AWS providers, as in plan.tftest.hcl:
#   terraform init -backend=false && terraform test -filter=tests/deploy.tftest.hcl
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

run "no_deploy_role_until_asked" {
  command = plan
  assert {
    condition     = length(aws_iam_role.deploy) == 0 && length(aws_iam_openid_connect_provider.github) == 0 && output.deploy_role_arn == ""
    error_message = "Without github_repository, nothing for GitHub is created."
  }
  assert {
    condition     = output.image_tag == "abc123"
    error_message = "The deployed tag is an output, for the workflow's rollback."
  }
}

run "deploy_role_only_for_this_repository_and_environment" {
  command = plan
  variables {
    github_repository = "example-org/example-repo"
  }
  assert {
    condition     = length(aws_iam_role.deploy) == 1 && length(aws_iam_openid_connect_provider.github) == 1 && aws_iam_role.deploy[0].name == "fh-production-ca-central-1-github-deploy"
    error_message = "The deploy role and GitHub's OIDC provider are created."
  }
  assert {
    condition     = contains(flatten([for s in data.aws_iam_policy_document.deploy_trust.statement : [for c in s.condition : "${c.test} ${c.variable} ${join(",", c.values)}"]]), "StringEquals token.actions.githubusercontent.com:sub repo:example-org/example-repo:environment:production") && contains(flatten([for s in data.aws_iam_policy_document.deploy_trust.statement : [for c in s.condition : "${c.test} ${c.variable} ${join(",", c.values)}"]]), "StringEquals token.actions.githubusercontent.com:aud sts.amazonaws.com")
    error_message = "Only jobs in this repository's production environment, for STS, may assume it: no branch, pull request or fork."
  }
  assert {
    condition     = alltrue([for a in ["kms:ScheduleKeyDeletion", "rds:DeleteDBInstance", "s3:DeleteBucket", "iam:CreateAccessKey", "cloudtrail:StopLogging"] : contains(flatten([for s in data.aws_iam_policy_document.deploy_guardrails.statement : s.actions if s.effect == "Deny"]), a)])
    error_message = "The deploy role can never delete keys, the database, buckets, or make long-lived keys."
  }
  assert {
    condition     = length(aws_ecr_repository_policy.pull) == 0
    error_message = "No cross-account pull unless asked."
  }
}

run "existing_oidc_provider_and_promotion" {
  command = plan
  variables {
    environment              = "staging"
    github_repository        = "example-org/example-repo"
    github_oidc_provider_arn = "arn:aws:iam::111122223333:oidc-provider/token.actions.githubusercontent.com"
    ecr_pull_account_ids     = ["444455556666"]
  }
  assert {
    condition     = length(aws_iam_openid_connect_provider.github) == 0 && contains(flatten([for s in data.aws_iam_policy_document.deploy_trust.statement : flatten([for p in s.principals : p.identifiers])]), "arn:aws:iam::111122223333:oidc-provider/token.actions.githubusercontent.com")
    error_message = "An account's existing GitHub provider is reused."
  }
  assert {
    condition     = toset(keys(aws_ecr_repository_policy.pull)) == toset(["api", "migrate", "web"])
    error_message = "Production may pull every staging image."
  }
}

run "repository_name_checked" {
  command = plan
  variables {
    github_repository = "not a repo"
  }
  expect_failures = [var.github_repository]
}
