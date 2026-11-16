# Continuous deployment from GitHub Actions (.github/workflows/deploy.yml), with no stored AWS keys:
# the workflow gets short-lived credentials through GitHub's OpenID Connect provider, and only a
# job running in this environment's GitHub environment ("staging" or "production") of
# var.github_repository may assume the role. Empty github_repository: nothing is created.
#
# The role runs `terraform apply`, which manages IAM, KMS, the network and the database, so it
# needs administrator rights in this account (one account per environment, README.md). What
# protects it: the trust policy below (this repository, this GitHub environment, GitHub's
# audience), required reviewers on the production environment in GitHub, and explicit denials
# of the irreversible actions a deployment never needs.
variable "github_repository" {
  description = "owner/name of the GitHub repository allowed to deploy this environment (OIDC). Empty: no deploy role."
  type        = string
  default     = ""
  validation {
    condition     = var.github_repository == "" || can(regex("^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$", var.github_repository))
    error_message = "github_repository is owner/name."
  }
}

variable "github_oidc_provider_arn" {
  description = "ARN of an existing token.actions.githubusercontent.com OIDC provider in this account (an account has at most one). Empty: create it."
  type        = string
  default     = ""
}

variable "ecr_pull_account_ids" {
  description = "Other AWS accounts allowed to pull this environment's images: on staging, the production account, so production deploys the exact images staging tested."
  type        = list(string)
  default     = []
}

locals {
  deploy_enabled      = var.github_repository != ""
  github_oidc_url     = "token.actions.githubusercontent.com"
  github_provider_arn = var.github_oidc_provider_arn != "" ? var.github_oidc_provider_arn : try(aws_iam_openid_connect_provider.github[0].arn, "")
}

resource "aws_iam_openid_connect_provider" "github" {
  count          = local.deploy_enabled && var.github_oidc_provider_arn == "" ? 1 : 0
  url            = "https://${local.github_oidc_url}"
  client_id_list = ["sts.amazonaws.com"]
  # AWS validates GitHub's certificate itself; the thumbprint is still required by the API.
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1", "1c58a3a8518e8759bf075b76b750d4f2df264fcd"]
}

data "aws_iam_policy_document" "deploy_trust" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [local.github_provider_arn]
    }
    condition {
      test     = "StringEquals"
      variable = "${local.github_oidc_url}:aud"
      values   = ["sts.amazonaws.com"]
    }
    # Only a job that runs in this GitHub environment of this repository: production's required
    # reviewers therefore stand between a merge and production.
    condition {
      test     = "StringEquals"
      variable = "${local.github_oidc_url}:sub"
      values   = ["repo:${var.github_repository}:environment:${var.environment}"]
    }
  }
}

resource "aws_iam_role" "deploy" {
  count                = local.deploy_enabled ? 1 : 0
  name                 = "${local.gname}-github-deploy"
  description          = "GitHub Actions deployments of ${var.github_repository} (${var.environment})"
  assume_role_policy   = data.aws_iam_policy_document.deploy_trust.json
  max_session_duration = 3600
}

resource "aws_iam_role_policy_attachment" "deploy_admin" {
  count      = local.deploy_enabled ? 1 : 0
  role       = aws_iam_role.deploy[0].name
  policy_arn = "arn:aws:iam::aws:policy/AdministratorAccess"
}

# Irreversible or out-of-scope actions a deployment never needs, denied even though the role
# can otherwise change anything Terraform manages. A plan that would replace the database or
# delete a key, bucket or secret fails instead of running: that change is made by hand.
data "aws_iam_policy_document" "deploy_guardrails" {
  statement {
    sid    = "NeverDestroyDataOrKeys"
    effect = "Deny"
    actions = [
      "kms:ScheduleKeyDeletion", "kms:DisableKey",
      "rds:DeleteDBInstance", "rds:DeleteDBCluster", "rds:DeleteDBSnapshot", "rds:DeleteDBInstanceAutomatedBackup",
      "s3:DeleteBucket", "s3:BypassGovernanceRetention", "s3:DeleteObjectVersion",
      "secretsmanager:DeleteSecret", "ecr:DeleteRepository",
      "iam:CreateUser", "iam:CreateAccessKey", "iam:CreateLoginProfile",
      "organizations:*", "account:*", "cloudtrail:StopLogging", "cloudtrail:DeleteTrail",
    ]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "deploy_guardrails" {
  count  = local.deploy_enabled ? 1 : 0
  name   = "guardrails"
  role   = aws_iam_role.deploy[0].id
  policy = data.aws_iam_policy_document.deploy_guardrails.json
}

# Production pulls the images staging built and tested (the same digests), from staging's registry.
data "aws_iam_policy_document" "ecr_pull" {
  count = length(var.ecr_pull_account_ids) > 0 ? 1 : 0
  statement {
    sid     = "PromoteToOtherEnvironments"
    actions = ["ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer", "ecr:BatchCheckLayerAvailability", "ecr:DescribeImages"]
    principals {
      type        = "AWS"
      identifiers = [for a in var.ecr_pull_account_ids : "arn:aws:iam::${a}:root"]
    }
  }
}

resource "aws_ecr_repository_policy" "pull" {
  for_each   = length(var.ecr_pull_account_ids) > 0 ? aws_ecr_repository.repo : {}
  repository = each.value.name
  policy     = data.aws_iam_policy_document.ecr_pull[0].json
}

output "deploy_role_arn" {
  description = "The GitHub Actions deploy role: STAGING_AWS_ROLE_ARN or PRODUCTION_AWS_ROLE_ARN (docs/DEPLOYING.md)."
  value       = try(aws_iam_role.deploy[0].arn, "")
}

output "image_tag" {
  description = "The image tag this environment runs (the deploy workflow rolls back to it if a release fails its checks)."
  value       = var.image_tag
}
