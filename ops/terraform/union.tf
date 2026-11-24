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
#   (ops/terraform/README.md, "Union Hub"). The hub's role, the other way round, may use only those keys;
# - the hub holds neither the main database's app role nor the access-token signing secret: it asks
#   the main API, at its private address (API_URL), to check each request's sign-in
#   (apps/api/src/lib/unionAccess.ts), and refuses to start in production if handed either;
# - its own execution role, which can read the union secret and nothing else; no other task's can;
# - its own alarms (no healthy task, share of server errors), which also roll back a deployment.

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
  # The union role only. No APP_DATABASE_URL and no JWT_SECRET: the main API checks sign-ins.
  union_secrets = !local.union_enabled ? [] : [{ name = "UNION_DATABASE_URL", valueFrom = "${local.union_secret_arn}:UNION_DATABASE_URL::" }]
  # The API's private address (compute.tf), and the service's own settings. Not the API's
  # environment: nothing in it is the hub's business.
  union_env = merge({
    NODE_ENV         = "production"
    AWS_REGION       = var.region
    FLEXCITY_SERVICE = "union"
    UNION_PORT       = "4100"
    UNION_HUB_MODE   = "separate"
    API_URL          = local.web_env["API_URL"]
    KMS_KEY_ARN      = local.app_env["KMS_KEY_ARN"]
  }, { for k in ["KMS_REPLICA_REGION"] : k => local.app_env[k] if contains(keys(local.app_env), k) })
}

# The union task's own execution role: it pulls the image, writes its log and reads the union
# secret. The shared execution role (API, worker, web, migrations) can't read that secret, so no
# other task definition can be given UNION_DATABASE_URL; this role can't read the app secret.
resource "aws_iam_role" "union_execution" {
  count                = local.union_enabled ? 1 : 0
  name                 = "${local.gname}-union-execution"
  assume_role_policy   = data.aws_iam_policy_document.ecs_assume.json
  permissions_boundary = local.role_boundary
}

resource "aws_iam_role_policy_attachment" "union_execution" {
  count      = local.union_enabled ? 1 : 0
  role       = aws_iam_role.union_execution[0].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_iam_policy_document" "union_execution_secret" {
  count = local.union_enabled ? 1 : 0
  statement {
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [local.union_secret_arn]
  }
  statement {
    actions   = ["kms:Decrypt"]
    resources = local.secret_key_arns
  }
}

resource "aws_iam_role_policy" "union_execution_secret" {
  count  = local.union_enabled ? 1 : 0
  name   = "union-secret"
  role   = aws_iam_role.union_execution[0].id
  policy = data.aws_iam_policy_document.union_execution_secret[0].json
}

# The hub's own task role: it may use a union local's key (tagged fh:union-local), to seal and open
# its records; no other key (not the platform's, not a city's), and it never creates, deletes or
# re-points one.
resource "aws_iam_role" "union" {
  count                = local.union_enabled ? 1 : 0
  name                 = "${local.gname}-union"
  assume_role_policy   = data.aws_iam_policy_document.ecs_assume.json
  permissions_boundary = local.role_boundary
}

data "aws_iam_policy_document" "union" {
  statement {
    sid       = "UseUnionLocalKeys"
    actions   = ["kms:GenerateDataKey", "kms:Decrypt", "kms:DescribeKey"]
    resources = local.key_arns
    condition {
      test     = "StringEquals"
      variable = "aws:ResourceTag/fh:union-local"
      values   = ["true"]
    }
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
  execution_role_arn       = aws_iam_role.union_execution[0].arn
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
    environment  = [for k, v in local.union_env : { name = k, value = v }]
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

# The hub asks the main API to check each sign-in (API_URL, port 4000).
resource "aws_vpc_security_group_ingress_rule" "api_union" {
  count                        = local.union_enabled ? 1 : 0
  description                  = "Union Hub to API (sign-in checks)"
  security_group_id            = aws_security_group.api.id
  referenced_security_group_id = aws_security_group.union[0].id
  from_port                    = 4000
  to_port                      = 4000
  ip_protocol                  = "tcp"
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
  # Tasks that pass /healthz but answer with server errors, or none healthy: stop and roll back.
  alarms {
    enable      = true
    rollback    = true
    alarm_names = [aws_cloudwatch_metric_alarm.error_ratio["union"].alarm_name, aws_cloudwatch_metric_alarm.main["union-unhealthy"].alarm_name]
  }
  load_balancer {
    target_group_arn = aws_lb_target_group.union[0].arn
    container_name   = "union"
    container_port   = 4100
  }
}
