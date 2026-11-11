output "load_balancer_dns" {
  description = "Point <root_domain> and *.<root_domain> here (an alias record in Route 53)."
  value       = aws_lb.main.dns_name
}

output "site_distribution_domain" {
  description = "Point the marketing site's host name here."
  value       = aws_cloudfront_distribution.site.domain_name
}

output "site_bucket" {
  value = aws_s3_bucket.site.bucket
}

output "ecr_repositories" {
  value = local.repo_urls
}

output "database_endpoint" {
  value = aws_db_instance.main.address
}

output "database_replica_endpoint" {
  value = var.db_read_replica ? aws_db_instance.replica[0].address : null
}

output "database_master_secret_arn" {
  description = "RDS-managed owner password (for roles.sql and DATABASE_URL)."
  value       = aws_db_instance.main.master_user_secret[0].secret_arn
}

output "app_secret_arn" {
  value = local.app_secret_arn
}

output "platform_key_arn" {
  value = local.platform_key_arn
}

output "cluster" {
  value = aws_ecs_cluster.main.name
}

output "migrate_task_definition" {
  value = aws_ecs_task_definition.migrate.arn
}

output "private_subnets" {
  value = aws_subnet.private[*].id
}

output "app_security_group" {
  value = aws_security_group.app.id
}

output "db_roles_task_definition" {
  value = aws_ecs_task_definition.db_roles.arn
}
