resource "aws_ecs_cluster" "main" {
  name = local.name
  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

resource "aws_cloudwatch_log_group" "svc" {
  for_each          = toset(["api", "worker", "web", "migrate"])
  name              = "/fh/${var.environment}/${each.key}"
  retention_in_days = 90
}

locals {
  image = { for k, u in local.repo_urls : k => "${u}:${var.image_tag}" }

  # Settings the API and worker share. Secret ones come from the app secret (var.app_secret_keys).
  app_env = merge({
    NODE_ENV          = "production"
    AWS_REGION        = var.region
    KMS_KEY_ARN       = local.platform_key_arn
    ROOT_DOMAIN       = var.root_domain
    PUBLIC_APP_URL    = "https://{subdomain}.${var.root_domain}"
    MARKETING_ORIGINS = var.site_domain != "" ? "https://${var.site_domain}" : "https://www.${var.root_domain}"
    RELEASE           = var.image_tag
    WEB_CONCURRENCY   = "1" # one process per task; scale with tasks
    },
    # New organizations' keys are copied to the recovery region, except while running there
    # after losing the primary (it can't be reached; their keys stay single-region).
    var.recovery_mode ? {} : { KMS_REPLICA_REGION = var.dr_region },
  var.app_environment)

  app_secrets = [for k in var.app_secret_keys : { name = k, valueFrom = "${local.app_secret_arn}:${k}::" }]

  # The owner connection for migrations and set-up (apps/api/scripts/owner-url.mjs): the password
  # comes straight from the RDS-managed secret, which RDS rotates, so it never goes stale.
  owner_env = [
    { name = "NODE_ENV", value = "production" },
    { name = "DB_HOST", value = aws_db_instance.main.address },
    { name = "DB_PORT", value = tostring(aws_db_instance.main.port) },
    { name = "DB_NAME", value = "flexcity" },
    { name = "DB_USER", value = "fh_owner" },
    { name = "DB_SSLROOTCERT", value = "/etc/ssl/rds/global-bundle.pem" },
  ]
  owner_password = { name = "DB_PASSWORD", valueFrom = "${aws_db_instance.main.master_user_secret[0].secret_arn}:password::" }

  log = { for k in ["api", "worker", "web", "migrate"] : k => {
    logDriver = "awslogs"
    options = {
      awslogs-group         = aws_cloudwatch_log_group.svc[k].name
      awslogs-region        = var.region
      awslogs-stream-prefix = k
    }
  } }
}

resource "aws_ecs_task_definition" "api" {
  family                   = "${local.name}-api"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.api_cpu
  memory                   = var.api_memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.app.arn
  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }
  container_definitions = jsonencode([{
    name             = "api"
    image            = local.image["api"]
    essential        = true
    portMappings     = [{ containerPort = 4000, protocol = "tcp" }]
    environment      = [for k, v in merge(local.app_env, { PORT = "4000" }) : { name = k, value = v }]
    secrets          = local.app_secrets
    logConfiguration = local.log["api"]
  }])
}

resource "aws_ecs_task_definition" "worker" {
  family                   = "${local.name}-worker"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 512
  memory                   = 1024
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.app.arn
  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }
  container_definitions = jsonencode([{
    name             = "worker"
    image            = local.image["api"]
    essential        = true
    command          = ["node", "dist/worker.js"]
    environment      = [for k, v in local.app_env : { name = k, value = v }]
    secrets          = local.app_secrets
    logConfiguration = local.log["worker"]
  }])
}

# Run once per deployment, before the services update (README.md):
#   aws ecs run-task --cluster <cluster> --task-definition <migrate> --launch-type FARGATE ...
resource "aws_ecs_task_definition" "migrate" {
  family                   = "${local.name}-migrate"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 512
  memory                   = 1024
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.web.arn # no AWS permissions needed
  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }
  container_definitions = jsonencode([{
    name             = "migrate"
    image            = local.image["migrate"]
    essential        = true
    environment      = local.owner_env
    secrets          = [local.owner_password]
    logConfiguration = local.log["migrate"]
  }])
}

# Once per new environment, before the first migration: creates the app's database roles and
# sets their passwords from the app secret (apps/api/scripts/set-role-passwords.mjs).
resource "aws_ecs_task_definition" "db_roles" {
  family                   = "${local.name}-db-roles"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.web.arn
  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }
  container_definitions = jsonencode([{
    name        = "db-roles"
    image       = local.image["migrate"]
    essential   = true
    command     = ["node", "scripts/set-role-passwords.mjs"]
    environment = local.owner_env
    secrets = concat([local.owner_password], [for k in concat(["FLEXCITY_APP_PASSWORD"], var.union_role_password ? ["FLEXCITY_UNION_PASSWORD"] : []) :
    { name = k, valueFrom = "${local.app_secret_arn}:${k}::" }])
    logConfiguration = local.log["migrate"]
  }])
}

resource "aws_ecs_task_definition" "web" {
  family                   = "${local.name}-web"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 512
  memory                   = 1024
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.web.arn
  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }
  container_definitions = jsonencode([{
    name             = "web"
    image            = local.image["web"]
    essential        = true
    portMappings     = [{ containerPort = 3000, protocol = "tcp" }]
    environment      = [for k, v in local.web_env : { name = k, value = v }]
    logConfiguration = local.log["web"]
  }])
}

# A private DNS name for the API tasks (api.<name>.internal), kept current by ECS, for the web
# app's server-side calls.
resource "aws_service_discovery_private_dns_namespace" "internal" {
  name = "${local.name}.internal" # API_URL in local.web_env
  vpc  = aws_vpc.main.id
}

resource "aws_service_discovery_service" "api" {
  name = "api"
  dns_config {
    namespace_id   = aws_service_discovery_private_dns_namespace.internal.id
    routing_policy = "MULTIVALUE"
    dns_records {
      type = "A"
      ttl  = 10
    }
  }
  health_check_custom_config {}
}

locals {
  # API_URL: server-rendered pages (an organization's branding, its job postings) call the API
  # directly at its private name, not through the public load balancer (apps/web/src/lib/tenant.ts).
  web_env = { NODE_ENV = "production", ROOT_DOMAIN = var.root_domain, API_URL = "http://api.${local.name}.internal:4000" }
  services = {
    api    = { task = aws_ecs_task_definition.api.arn, count = var.api_min, port = 4000, tg = aws_lb_target_group.api.arn }
    web    = { task = aws_ecs_task_definition.web.arn, count = var.web_min, port = 3000, tg = aws_lb_target_group.web.arn }
    worker = { task = aws_ecs_task_definition.worker.arn, count = var.worker_count, port = null, tg = null }
  }
}

resource "aws_ecs_service" "svc" {
  for_each                           = local.services
  name                               = each.key
  cluster                            = aws_ecs_cluster.main.id
  task_definition                    = each.value.task
  desired_count                      = each.value.count
  launch_type                        = "FARGATE"
  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200
  health_check_grace_period_seconds  = each.value.tg == null ? null : 60
  propagate_tags                     = "SERVICE"
  enable_ecs_managed_tags            = true

  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.app.id]
    assign_public_ip = false
  }

  # A deployment whose tasks don't become healthy is rolled back automatically.
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  dynamic "service_registries" {
    for_each = each.key == "api" ? [aws_service_discovery_service.api.arn] : []
    content {
      registry_arn = service_registries.value
    }
  }

  dynamic "load_balancer" {
    for_each = each.value.tg == null ? [] : [each.value]
    content {
      target_group_arn = load_balancer.value.tg
      container_name   = each.key
      container_port   = load_balancer.value.port
    }
  }

  # Autoscaling owns the count after the first deployment.
  lifecycle {
    ignore_changes = [desired_count]
  }

  depends_on = [aws_lb_listener.https]
}

# Scale on CPU and on requests per task, whichever asks for more.
locals {
  scaled = {
    api = { min = var.api_min, max = var.api_max, tg = aws_lb_target_group.api.arn_suffix }
    web = { min = var.web_min, max = var.web_max, tg = aws_lb_target_group.web.arn_suffix }
  }
}

resource "aws_appautoscaling_target" "svc" {
  for_each           = local.scaled
  service_namespace  = "ecs"
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.svc[each.key].name}"
  scalable_dimension = "ecs:service:DesiredCount"
  min_capacity       = each.value.min
  max_capacity       = each.value.max
}

resource "aws_appautoscaling_policy" "cpu" {
  for_each           = local.scaled
  name               = "${local.name}-${each.key}-cpu"
  policy_type        = "TargetTrackingScaling"
  service_namespace  = aws_appautoscaling_target.svc[each.key].service_namespace
  resource_id        = aws_appautoscaling_target.svc[each.key].resource_id
  scalable_dimension = aws_appautoscaling_target.svc[each.key].scalable_dimension
  target_tracking_scaling_policy_configuration {
    target_value       = 60
    scale_in_cooldown  = 300
    scale_out_cooldown = 60
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
  }
}

resource "aws_appautoscaling_policy" "requests" {
  for_each           = local.scaled
  name               = "${local.name}-${each.key}-requests"
  policy_type        = "TargetTrackingScaling"
  service_namespace  = aws_appautoscaling_target.svc[each.key].service_namespace
  resource_id        = aws_appautoscaling_target.svc[each.key].resource_id
  scalable_dimension = aws_appautoscaling_target.svc[each.key].scalable_dimension
  target_tracking_scaling_policy_configuration {
    target_value       = 3000 # requests per task per minute
    scale_in_cooldown  = 300
    scale_out_cooldown = 60
    predefined_metric_specification {
      predefined_metric_type = "ALBRequestCountPerTarget"
      resource_label         = "${aws_lb.main.arn_suffix}/${each.value.tg}"
    }
  }
}
