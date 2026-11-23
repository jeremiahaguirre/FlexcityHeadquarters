# One VPC across the zones: public subnets for the load balancer and NAT, private subnets for the
# containers, isolated subnets (no internet route) for the database.
resource "aws_vpc" "main" {
  cidr_block           = "10.40.0.0/16"
  enable_dns_hostnames = true
  enable_dns_support   = true
  tags                 = { Name = local.name }
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
}

resource "aws_subnet" "public" {
  count                   = var.az_count
  vpc_id                  = aws_vpc.main.id
  availability_zone       = local.azs[count.index]
  cidr_block              = cidrsubnet(aws_vpc.main.cidr_block, 8, count.index)
  map_public_ip_on_launch = false
  tags                    = { Name = "${local.name}-public-${local.azs[count.index]}" }
}

resource "aws_subnet" "private" {
  count             = var.az_count
  vpc_id            = aws_vpc.main.id
  availability_zone = local.azs[count.index]
  cidr_block        = cidrsubnet(aws_vpc.main.cidr_block, 8, 10 + count.index)
  tags              = { Name = "${local.name}-private-${local.azs[count.index]}" }
}

resource "aws_subnet" "database" {
  count             = var.az_count
  vpc_id            = aws_vpc.main.id
  availability_zone = local.azs[count.index]
  cidr_block        = cidrsubnet(aws_vpc.main.cidr_block, 8, 20 + count.index)
  tags              = { Name = "${local.name}-db-${local.azs[count.index]}" }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }
}

resource "aws_route_table_association" "public" {
  count          = var.az_count
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

resource "aws_eip" "nat" {
  count  = var.nat_gateways
  domain = "vpc"
}

resource "aws_nat_gateway" "main" {
  count         = var.nat_gateways
  allocation_id = aws_eip.nat[count.index].id
  subnet_id     = aws_subnet.public[count.index].id
  depends_on    = [aws_internet_gateway.main]
  lifecycle {
    precondition {
      condition     = var.nat_gateways >= 1 && var.nat_gateways <= var.az_count
      error_message = "nat_gateways must be between 1 and az_count."
    }
  }
}

resource "aws_route_table" "private" {
  count  = var.az_count
  vpc_id = aws_vpc.main.id
  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.main[count.index % var.nat_gateways].id
  }
}

resource "aws_route_table_association" "private" {
  count          = var.az_count
  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private[count.index].id
}

# The database subnets have no route out at all.
resource "aws_route_table" "database" {
  vpc_id = aws_vpc.main.id
}

resource "aws_route_table_association" "database" {
  count          = var.az_count
  subnet_id      = aws_subnet.database[count.index].id
  route_table_id = aws_route_table.database.id
}

# S3 traffic stays inside AWS (no NAT charges, no internet path).
resource "aws_vpc_endpoint" "s3" {
  vpc_id            = aws_vpc.main.id
  service_name      = "com.amazonaws.${var.region}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = aws_route_table.private[*].id
}

resource "aws_security_group" "alb" {
  name        = "${local.name}-alb"
  description = "Load balancer: HTTPS from anywhere"
  vpc_id      = aws_vpc.main.id
}

resource "aws_vpc_security_group_ingress_rule" "alb_https" {
  security_group_id = aws_security_group.alb.id
  cidr_ipv4         = "0.0.0.0/0"
  from_port         = 443
  to_port           = 443
  ip_protocol       = "tcp"
}

resource "aws_vpc_security_group_ingress_rule" "alb_http" {
  description       = "Redirected to HTTPS"
  security_group_id = aws_security_group.alb.id
  cidr_ipv4         = "0.0.0.0/0"
  from_port         = 80
  to_port           = 80
  ip_protocol       = "tcp"
}

resource "aws_vpc_security_group_egress_rule" "alb_out" {
  security_group_id = aws_security_group.alb.id
  cidr_ipv4         = aws_vpc.main.cidr_block
  ip_protocol       = "-1"
}

# One security group per kind of task, each allowed only what it needs (SECURITY-AUDIT SEC-53).
# Before, one group covered every task, so the internet-facing web tasks could reach PostgreSQL and
# call the API directly (past the firewall and the load balancer's ops-path block).
#
# Fargate pulls images, writes logs and reads secrets through the task's own network interface, so
# every group keeps HTTPS out to AWS's public endpoints (through the NAT; S3 through its gateway
# endpoint). Amazon's VPC DNS resolver is not filtered by security groups.
resource "aws_security_group" "web" {
  name        = "${local.name}-web"
  description = "Web tasks: from the load balancer; out to the API and HTTPS only, never the database"
  vpc_id      = aws_vpc.main.id
}

resource "aws_security_group" "api" {
  name        = "${local.name}-api"
  description = "API tasks: from the load balancer and the web tasks"
  vpc_id      = aws_vpc.main.id
}

resource "aws_security_group" "worker" {
  name        = "${local.name}-worker"
  description = "Worker tasks: nothing in"
  vpc_id      = aws_vpc.main.id
}

resource "aws_security_group" "jobs" {
  name        = "${local.name}-jobs"
  description = "One-off tasks (migrations, database roles, operator scripts): nothing in; the database and HTTPS out"
  vpc_id      = aws_vpc.main.id
}

# ---- In ---------------------------------------------------------------------------------------
resource "aws_vpc_security_group_ingress_rule" "api_alb" {
  description                  = "Load balancer to API"
  security_group_id            = aws_security_group.api.id
  referenced_security_group_id = aws_security_group.alb.id
  from_port                    = 4000
  to_port                      = 4000
  ip_protocol                  = "tcp"
}

# The web tasks' server-side calls to the API (api.<name>.internal:4000, compute.tf).
resource "aws_vpc_security_group_ingress_rule" "api_web" {
  description                  = "Web app server to API"
  security_group_id            = aws_security_group.api.id
  referenced_security_group_id = aws_security_group.web.id
  from_port                    = 4000
  to_port                      = 4000
  ip_protocol                  = "tcp"
}

resource "aws_vpc_security_group_ingress_rule" "api_metrics" {
  count                        = var.metrics_collector_security_group == "" ? 0 : 1
  description                  = "Prometheus scrape of /metrics"
  security_group_id            = aws_security_group.api.id
  referenced_security_group_id = var.metrics_collector_security_group
  from_port                    = 4000
  to_port                      = 4000
  ip_protocol                  = "tcp"
}

resource "aws_vpc_security_group_ingress_rule" "web_alb" {
  description                  = "Load balancer to web"
  security_group_id            = aws_security_group.web.id
  referenced_security_group_id = aws_security_group.alb.id
  from_port                    = 3000
  to_port                      = 3000
  ip_protocol                  = "tcp"
}

# ---- Out --------------------------------------------------------------------------------------
# The API and worker call the database, AWS services and the providers (Twilio, push services,
# Environment Canada weather, customers' webhooks, banks' SFTP for payroll files), on ports the
# customers choose: everything out.
resource "aws_vpc_security_group_egress_rule" "api_out" {
  security_group_id = aws_security_group.api.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}

resource "aws_vpc_security_group_egress_rule" "worker_out" {
  security_group_id = aws_security_group.worker.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}

# The web tasks: the API, and HTTPS for their image, logs and secrets. No database, no other ports.
resource "aws_vpc_security_group_egress_rule" "web_api" {
  description                  = "Web app server to API"
  security_group_id            = aws_security_group.web.id
  referenced_security_group_id = aws_security_group.api.id
  from_port                    = 4000
  to_port                      = 4000
  ip_protocol                  = "tcp"
}

resource "aws_vpc_security_group_egress_rule" "web_https" {
  description       = "HTTPS: image pull, logs, secrets"
  security_group_id = aws_security_group.web.id
  cidr_ipv4         = "0.0.0.0/0"
  from_port         = 443
  to_port           = 443
  ip_protocol       = "tcp"
}

resource "aws_vpc_security_group_egress_rule" "jobs_db" {
  description                  = "Migrations and set-up scripts to PostgreSQL"
  security_group_id            = aws_security_group.jobs.id
  referenced_security_group_id = aws_security_group.db.id
  from_port                    = 5432
  to_port                      = 5432
  ip_protocol                  = "tcp"
}

resource "aws_vpc_security_group_egress_rule" "jobs_https" {
  description       = "HTTPS: image pull, logs, secrets, KMS"
  security_group_id = aws_security_group.jobs.id
  cidr_ipv4         = "0.0.0.0/0"
  from_port         = 443
  to_port           = 443
  ip_protocol       = "tcp"
}

resource "aws_security_group" "db" {
  name        = "${local.name}-db"
  description = "PostgreSQL from the API, worker and one-off tasks only"
  vpc_id      = aws_vpc.main.id
}

# The database: from the API, the worker and the one-off tasks. Never from the web tasks.
resource "aws_vpc_security_group_ingress_rule" "db_from" {
  for_each                     = { api = aws_security_group.api.id, worker = aws_security_group.worker.id, jobs = aws_security_group.jobs.id }
  description                  = "PostgreSQL from ${each.key} tasks"
  security_group_id            = aws_security_group.db.id
  referenced_security_group_id = each.value
  from_port                    = 5432
  to_port                      = 5432
  ip_protocol                  = "tcp"
}
