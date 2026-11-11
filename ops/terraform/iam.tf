data "aws_iam_policy_document" "ecs_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

# Used by ECS itself: pull images, write logs, read the app secret into the container.
resource "aws_iam_role" "execution" {
  name               = "${local.gname}-ecs-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

resource "aws_iam_role_policy_attachment" "execution" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_iam_policy_document" "execution_secrets" {
  statement {
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [local.app_secret_arn, aws_db_instance.main.master_user_secret[0].secret_arn]
  }
  statement {
    actions   = ["kms:Decrypt"]
    resources = local.secret_key_arns
  }
}

resource "aws_iam_role_policy" "execution_secrets" {
  role   = aws_iam_role.execution.id
  policy = data.aws_iam_policy_document.execution_secrets.json
}

# The API and worker: seal and open records with KMS, and create each organization's key on first
# use (apps/api/src/services/crypto). They can never delete, disable or re-point a key, or change
# a key policy. GenerateDataKey and Decrypt cover every key in the account's two regions rather
# than matching aliases or tags, because KMS takes up to five minutes to honour a new alias or tag
# in a permission, which would fail an organization's first sealed record. That is why each
# environment gets its own AWS account (kms.tf).
resource "aws_iam_role" "app" {
  name               = "${local.gname}-app"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

locals {
  key_arns   = ["arn:aws:kms:${var.region}:${data.aws_caller_identity.current.account_id}:key/*", "arn:aws:kms:${var.dr_region}:${data.aws_caller_identity.current.account_id}:key/*"]
  alias_arns = ["arn:aws:kms:${var.region}:${data.aws_caller_identity.current.account_id}:alias/flexcity-tenant-*", "arn:aws:kms:${var.dr_region}:${data.aws_caller_identity.current.account_id}:alias/flexcity-tenant-*"]
}

data "aws_iam_policy_document" "app" {
  statement {
    sid       = "UseKeys"
    actions   = ["kms:GenerateDataKey", "kms:Decrypt", "kms:DescribeKey"]
    resources = local.key_arns
  }
  statement {
    sid       = "CreateOrganizationKeys"
    actions   = ["kms:CreateKey"]
    resources = ["*"]
    # Key material only ever in Canada: the two regions of this deployment.
    condition {
      test     = "StringEquals"
      variable = "aws:RequestedRegion"
      values   = [var.region, var.dr_region]
    }
  }
  statement {
    sid       = "TagOrganizationKeys"
    actions   = ["kms:TagResource"]
    resources = local.key_arns
    condition {
      test     = "ForAllValues:StringEquals"
      variable = "aws:TagKeys"
      values   = ["fh:tenant", "Project", "fh:unused"]
    }
  }
  statement {
    sid       = "RotateOrganizationKeys"
    actions   = ["kms:EnableKeyRotation"]
    resources = local.key_arns
  }
  statement {
    sid       = "CopyOrganizationKeysToRecovery"
    actions   = ["kms:ReplicateKey"]
    resources = local.key_arns
    condition {
      test     = "StringEquals"
      variable = "kms:ReplicaRegion"
      values   = [var.dr_region]
    }
  }
  statement {
    sid       = "NameOrganizationKeys"
    actions   = ["kms:CreateAlias"]
    resources = concat(local.key_arns, local.alias_arns)
  }
}

resource "aws_iam_role_policy" "app" {
  role   = aws_iam_role.app.id
  policy = data.aws_iam_policy_document.app.json
}

# The web app needs no AWS permissions.
resource "aws_iam_role" "web" {
  name               = "${local.gname}-web"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}
