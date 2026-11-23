# Continuous deployment from GitHub Actions (.github/workflows/deploy.yml), with no stored AWS keys:
# the workflow gets short-lived credentials through GitHub's OpenID Connect provider, and only a
# job of the deploy workflow on main, running in this environment's GitHub environment ("staging"
# or "production") of var.github_repository, may assume the role. Empty github_repository:
# nothing is created.
#
# The role runs `terraform apply`, which manages IAM, KMS, the network and the database, so it
# needs administrator rights in this account (one account per environment, README.md). What
# protects it:
# - the trust policy below: this repository, this GitHub environment, the deploy workflow file on
#   refs/heads/main (the job_workflow_ref claim, in the repository's customized OIDC subject, which
#   the owner sets once: docs/DEPLOYING.md), GitHub's audience;
# - required reviewers on the production environment in GitHub;
# - explicit denials of the irreversible actions a deployment never needs, in a permissions
#   boundary that every role this module creates carries, and that any role the deploy role
#   creates or changes must carry too: a new role can't be used to get around them.
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
  # The OIDC subject with the repository's customized claims (repo, context, job_workflow_ref):
  # only the deploy workflow, from main, in this environment.
  deploy_subject = "repo:${var.github_repository}:environment:${var.environment}:job_workflow_ref:${var.github_repository}/.github/workflows/deploy.yml@refs/heads/main"
  # Every role in this module carries it when deployments are on (null otherwise).
  deploy_boundary_name = "${local.gname}-deploy-boundary"
  deploy_boundary_arn  = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:policy/${local.deploy_boundary_name}"
  # Built from the policy's name (known when planning), which also orders every role after it.
  role_boundary = local.deploy_enabled ? "arn:aws:iam::${data.aws_caller_identity.current.account_id}:policy/${aws_iam_policy.deploy_boundary[0].name}" : null
  # Irreversible or out-of-scope actions a deployment never needs.
  never_actions = [
    "kms:ScheduleKeyDeletion", "kms:DisableKey",
    "rds:DeleteDBInstance", "rds:DeleteDBCluster", "rds:DeleteDBSnapshot", "rds:DeleteDBInstanceAutomatedBackup",
    "s3:DeleteBucket", "s3:BypassGovernanceRetention", "s3:DeleteObjectVersion",
    "secretsmanager:DeleteSecret", "ecr:DeleteRepository",
    "iam:CreateUser", "iam:CreateAccessKey", "iam:CreateLoginProfile",
    "organizations:*", "account:*", "cloudtrail:StopLogging", "cloudtrail:DeleteTrail",
  ]
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
    # Only the deploy workflow, from main, in this GitHub environment of this repository: a
    # workflow pushed on another branch that names the environment gets another subject, and
    # production's required reviewers stand between a merge and production.
    condition {
      test     = "StringEquals"
      variable = "${local.github_oidc_url}:sub"
      values   = [local.deploy_subject]
    }
  }
}

resource "aws_iam_role" "deploy" {
  count              = local.deploy_enabled ? 1 : 0
  name               = "${local.gname}-github-deploy"
  description        = "GitHub Actions deployments of ${var.github_repository} (${var.environment})"
  assume_role_policy = data.aws_iam_policy_document.deploy_trust.json
  # Two hours: a production run (promote, migrate, apply, a 10-minute watch, then possibly a
  # rollback apply) must still hold valid credentials for its rollback.
  max_session_duration = 7200
  permissions_boundary = local.role_boundary
}

# The permissions boundary: everything, except the irreversible actions, and except making or
# changing a role that doesn't carry this same boundary. With AdministratorAccess the deploy role
# could otherwise create a role without any of these denials (or loosen an existing one, such as a
# task role) and act through it. Roles this module creates carry it (local.role_boundary), so the
# deploy role can still manage them.
data "aws_iam_policy_document" "deploy_boundary" {
  statement {
    sid       = "Everything"
    actions   = ["*"]
    resources = ["*"]
  }
  statement {
    sid       = "NeverDestroyDataOrKeys"
    effect    = "Deny"
    actions   = local.never_actions
    resources = ["*"]
  }
  statement {
    sid       = "RolesKeepTheBoundary"
    effect    = "Deny"
    actions   = ["iam:CreateRole", "iam:PutRolePermissionsBoundary", "iam:AttachRolePolicy", "iam:PutRolePolicy"]
    resources = ["*"]
    condition {
      test     = "StringNotEquals"
      variable = "iam:PermissionsBoundary"
      values   = [local.deploy_boundary_arn]
    }
  }
  statement {
    sid       = "NoRoleLosesTheBoundary"
    effect    = "Deny"
    actions   = ["iam:DeleteRolePermissionsBoundary"]
    resources = ["*"]
  }
  # Trust policies: only of this environment's own roles, which carry the boundary (an existing
  # role without it, such as an organization's access role, can't be made to trust the deploy role).
  statement {
    sid           = "TrustOnlyOwnRoles"
    effect        = "Deny"
    actions       = ["iam:UpdateAssumeRolePolicy"]
    not_resources = ["arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/${local.gname}-*"]
  }
  statement {
    sid       = "BoundaryStaysAsIs"
    effect    = "Deny"
    actions   = ["iam:CreatePolicyVersion", "iam:DeletePolicy", "iam:DeletePolicyVersion", "iam:SetDefaultPolicyVersion"]
    resources = [local.deploy_boundary_arn]
  }
}

resource "aws_iam_policy" "deploy_boundary" {
  count       = local.deploy_enabled ? 1 : 0
  name        = local.deploy_boundary_name
  description = "Permissions boundary of every role in this environment: no irreversible actions, no role without this boundary (deploy.tf)."
  policy      = data.aws_iam_policy_document.deploy_boundary.json
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
    sid       = "NeverDestroyDataOrKeys"
    effect    = "Deny"
    actions   = local.never_actions
    resources = ["*"]
  }
  # The role can't loosen itself: not its policies, its trust, its boundary, or the GitHub provider
  # it trusts. Changes to the deploy role are made by hand, like its first apply (docs/DEPLOYING.md).
  statement {
    sid    = "CannotChangeItself"
    effect = "Deny"
    actions = [
      "iam:PutRolePolicy", "iam:DeleteRolePolicy", "iam:AttachRolePolicy", "iam:DetachRolePolicy",
      "iam:UpdateAssumeRolePolicy", "iam:UpdateRole", "iam:DeleteRole", "iam:TagRole", "iam:UntagRole",
      "iam:PutRolePermissionsBoundary", "iam:DeleteRolePermissionsBoundary",
    ]
    resources = ["arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/${local.gname}-github-deploy"]
  }
  statement {
    sid       = "CannotChangeWhoMayDeploy"
    effect    = "Deny"
    actions   = ["iam:CreateOpenIDConnectProvider", "iam:DeleteOpenIDConnectProvider", "iam:UpdateOpenIDConnectProviderThumbprint", "iam:AddClientIDToOpenIDConnectProvider", "iam:RemoveClientIDFromOpenIDConnectProvider", "iam:TagOpenIDConnectProvider"]
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

output "deployment_alarm_names" {
  description = "The alarms that roll a deployment back (alarms.tf); the deploy workflow keeps watching them after the services are stable."
  value       = flatten(values(local.deployment_alarms))
}

output "service_task_definitions" {
  description = "The task definition each service should run after this apply: the deploy workflow treats any other (an ECS rollback) as a failed release."
  value       = { for k, s in local.services : k => s.task }
}

output "image_tag" {
  description = "The image tag this environment runs (the deploy workflow rolls back to it if a release fails its checks)."
  value       = var.image_tag
}
