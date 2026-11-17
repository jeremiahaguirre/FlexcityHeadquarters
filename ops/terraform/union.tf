# The Union Hub as its own service (ARCHITECTURE-REVIEW A27; SECURITY-AUDIT SEC-61).
#
# apps/api/src/unionServer.ts answers /api/union/* only and is the only process given the union
# database role. With union_hub_separate = true:
# - its own ECS service, task role, security group and log group, from the API image
#   (`node dist/unionServer.js`, port 4100), behind the load balancer's /api/union/* rule;
# - the API and worker run with UNION_HUB_MODE=separate (they refuse to start if handed
#   UNION_DATABASE_URL), and UNION_DATABASE_URL lives in a secret of its own that only the union
#   task's definition references;
# - the app role is denied the union locals' keys (KMS keys tagged fh:union-local), so a flaw or a
#   stolen credential in the main API can't open union data. Tag each local's key when creating it
#   (ops/terraform/README.md, "Union Hub").
# Still shared with the main API (an owner decision, SEC-61): the access-token signing secret
# (JWT_SECRET; HS256), which the hub needs to check sign-ins. Moving to asymmetric tokens would
# give the hub a public key only.

variable "union_hub_separate" {
  description = "Run the Union Hub as its own service (its own role, secret, network and /api/union/* rule) and keep the API away from union data."
  type        = bool
  default     = false
}

variable "union_count" {
  description = "Union Hub tasks (with union_hub_separate)."
  type        = number
  default     = 2
}

locals {
  union_enabled = var.union_hub_separate
  union_command = ["node", "dist/unionServer.js"]
}

# UNION_DATABASE_URL (the flexcity_union role, sslmode=verify-full), filled in by hand like the app secret.
resource "aws_secretsmanager_secret" "union" {
  count      = local.union_enabled && !var.recovery_mode ? 1 : 0
  name       = "${local.name}/union"
  kms_key_id = aws_kms_key.data.arn
  replica {
    region     = var.dr_region
    kms_key_id = aws_kms_key.data_dr[0].arn
  }
}

data "aws_secretsmanager_secret" "union" {
  count = local.union_enabled && var.recovery_mode ? 1 : 0
  name  = "${local.name}/union"
}

locals {
  union_secret_arn = !local.union_enabled ? "" : (var.recovery_mode ? data.aws_secretsmanager_secret.union[0].arn : aws_secretsmanager_secret.union[0].arn)
  # The hub checks sign-ins through the main database's app role, with the same token secret.
  union_secrets = !local.union_enabled ? [] : concat(
    [for k in ["JWT_SECRET", "APP_DATABASE_URL"] : { name = k, valueFrom = "${local.app_secret_arn}:${k}::" }],
    [{ name = "UNION_DATABASE_URL", valueFrom = "${local.union_secret_arn}:UNION_DATABASE_URL::" }],
  )
}

# ECS reads the union secret into the union task only (the execution role is shared by every task;
# no other task definition names this secret).
data "aws_iam_policy_document" "execution_union_secret" {
  count = local.union_enabled ? 1 : 0
  statement {
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [local.union_secret_arn]
  }
}

resource "aws_iam_role_policy" "execution_union_secret" {
  count  = local.union_enabled ? 1 : 0
  name   = "union-secret"
  role   = aws_iam_role.execution.id
  policy = data.aws_iam_policy_document.execution_union_secret[0].json
}

# The hub's own task role: it may use KMS keys (a union local's key, to seal and open its records),
# never create, delete or re-point one.
resource "aws_iam_role" "union" {
  count              = local.union_enabled ? 1 : 0
  name               = "${local.gname}-union"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

data "aws_iam_policy_document" "union" {
  statement {
    sid       = "UseKeys"
    actions   = ["kms:GenerateDataKey", "kms:Decrypt", "kms:DescribeKey"]
    resources = local.key_arns
  }
}

resource "aws_iam_role_policy" "union" {
  count  = local.union_enabled ? 1 : 0
  role   = aws_iam_role.union[0].id
  policy = data.aws_iam_policy_document.union.json
}

# The main API and worker can't use a union local's key.
data "aws_iam_policy_document" "app_no_union_keys" {
  statement {
    sid       = "NoUnionLocalKeys"
    effect    = "Deny"
    actions   = ["kms:Decrypt", "kms:GenerateDataKey", "kms:ReEncrypt*", "kms:CreateGrant"]
    resources = local.key_arns
    condition {
      test     = "StringEquals"
      variable = "aws:ResourceTag/fh:union-local"
      values   = ["true"]
    }
  }
}

resource "aws_iam_role_policy" "app_no_union_keys" {
  count  = local.union_enabled ? 1 : 0
  name   = "no-union-keys"
  role   = aws_iam_role.app.id
  policy = data.aws_iam_policy_document.app_no_union_keys.json
}

resource "aws_cloudwatch_log_group" "union" {
  count             = local.union_enabled ? 1 : 0
  name              = "/fh/${var.environment}/union"
  retention_in_days = 90
}

resource "aws_ecs_task_definition" "union" {
  count                    = local.union_enabled ? 1 : 0
  family                   = "${local.name}-union"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 512
  memory                   = 1024
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.union[0].arn
  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }
  container_definitions = jsonencode([{
    name         = "union"
    image        = local.image["api"]
    essential    = true
    command      = local.union_command
    portMappings = [{ containerPort = 4100, protocol = "tcp" }]
    environment  = [for k, v in merge(local.app_env, { UNION_PORT = "4100", UNION_HUB_MODE = "separate" }) : { name = k, value = v }]
    secrets      = local.union_secrets
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.union[0].name
        awslogs-region        = var.region
        awslogs-stream-prefix = "union"
      }
    }
  }])
}

resource "aws_security_group" "union" {
  count       = local.union_enabled ? 1 : 0
  name        = "${local.name}-union"
  description = "Union Hub tasks: from the load balancer only"
  vpc_id      = aws_vpc.main.id
}

resource "aws_vpc_security_group_ingress_rule" "union_alb" {
  count                        = local.union_enabled ? 1 : 0
  description                  = "Load balancer to the Union Hub"
  security_group_id            = aws_security_group.union[0].id
  referenced_security_group_id = aws_security_group.alb.id
  from_port                    = 4100
  to_port                      = 4100
  ip_protocol                  = "tcp"
}

# The database, AWS services (KMS, logs, images, secrets): everything out, as for the API.
resource "aws_vpc_security_group_egress_rule" "union_out" {
  count             = local.union_enabled ? 1 : 0
  security_group_id = aws_security_group.union[0].id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}

resource "aws_vpc_security_group_ingress_rule" "db_union" {
  count                        = local.union_enabled ? 1 : 0
  description                  = "PostgreSQL from the Union Hub"
  security_group_id            = aws_security_group.db.id
  referenced_security_group_id = aws_security_group.union[0].id
  from_port                    = 5432
  to_port                      = 5432
  ip_protocol                  = "tcp"
}

resource "aws_lb_target_group" "union" {
  count                = local.union_enabled ? 1 : 0
  name                 = "${local.name}-union"
  port                 = 4100
  protocol             = "HTTP"
  target_type          = "ip"
  vpc_id               = aws_vpc.main.id
  deregistration_delay = 30
  health_check {
    path                = "/healthz"
    matcher             = "200"
    interval            = 15
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
}

# Before the /api/* rule (priority 20): union requests never reach the main API.
resource "aws_lb_listener_rule" "union" {
  count        = local.union_enabled ? 1 : 0
  listener_arn = aws_lb_listener.https.arn
  priority     = 15
  condition {
    path_pattern {
      values = ["/api/union", "/api/union/*"]
    }
  }
  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.union[0].arn
  }
}

resource "aws_ecs_service" "union" {
  count                              = local.union_enabled ? 1 : 0
  name                               = "union"
  cluster                            = aws_ecs_cluster.main.id
  task_definition                    = aws_ecs_task_definition.union[0].arn
  desired_count                      = var.union_count
  launch_type                        = "FARGATE"
  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200
  health_check_grace_period_seconds  = 60
  propagate_tags                     = "SERVICE"
  enable_ecs_managed_tags            = true
  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.union[0].id]
    assign_public_ip = false
  }
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }
  load_balancer {
    target_group_arn = aws_lb_target_group.union[0].arn
    container_name   = "union"
    container_port   = 4100
  }
}
