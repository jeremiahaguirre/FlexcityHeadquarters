# Plans the whole configuration against mocked AWS providers (no account or network needed):
#   terraform init -backend=false && terraform test
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

run "production_defaults" {
  command = plan

  assert {
    condition     = length(aws_subnet.private) == 3 && length(aws_subnet.database) == 3
    error_message = "Expected three zones."
  }
  assert {
    condition     = aws_db_instance.main.multi_az && aws_db_instance.main.storage_encrypted && aws_db_instance.main.deletion_protection
    error_message = "Production database must be Multi-AZ, encrypted and protected from deletion."
  }
  assert {
    condition     = aws_db_instance.main.backup_retention_period == 35
    error_message = "35 days of point-in-time recovery expected."
  }
  assert {
    condition     = length(aws_db_instance.replica) == 0
    error_message = "No read replica unless asked."
  }
  assert {
    condition     = aws_kms_key.platform[0].multi_region && aws_kms_key.platform[0].enable_key_rotation
    error_message = "Platform key must be multi-region with rotation."
  }
  assert {
    condition     = toset(keys(aws_ecs_service.svc)) == toset(["api", "web", "worker"])
    error_message = "Expected the api, web and worker services."
  }
  assert {
    condition     = aws_ecs_service.svc["api"].desired_count == 2 && aws_ecs_service.svc["worker"].desired_count == 2
    error_message = "At least two API tasks and two workers."
  }
  assert {
    condition     = aws_lb_target_group.api.health_check[0].path == "/healthz"
    error_message = "The load balancer checks /healthz, never the database-dependent /readyz."
  }
  assert {
    condition     = length(aws_db_instance_automated_backups_replication.dr) == 1 && length(aws_ecr_replication_configuration.dr) == 1 && length(aws_s3_bucket_replication_configuration.backups) == 1
    error_message = "Backups, images and files must be copied to the recovery region."
  }
  assert {
    condition     = one(aws_secretsmanager_secret.app[0].replica).region == "ca-west-1"
    error_message = "The app secret must be copied to the recovery region."
  }
  assert {
    condition     = length(aws_db_instance.main.restore_to_point_in_time) == 0 && aws_db_instance.main.db_name == "flexcity"
    error_message = "A normal deployment creates a new database."
  }
  assert {
    condition     = local.owner_password.name == "DB_PASSWORD" && contains([for e in local.owner_env : e.name], "DB_SSLROOTCERT") && !contains(var.app_secret_keys, "DATABASE_URL")
    error_message = "Migrations take the owner password from the RDS-managed secret, never a copy."
  }
  assert {
    condition     = length(aws_nat_gateway.main) == 1
    error_message = "One NAT gateway by default."
  }
  assert {
    condition     = local.app_env["KMS_REPLICA_REGION"] == "ca-west-1" && local.app_env["NODE_ENV"] == "production" && local.app_env["PUBLIC_APP_URL"] == "https://{subdomain}.example.ca"
    error_message = "API must be told the recovery region for keys."
  }
  assert {
    condition     = toset([for x in local.app_secrets : x.name]) == toset(["JWT_SECRET", "APP_DATABASE_URL", "LISTEN_DATABASE_URL", "METRICS_TOKEN"]) && !contains(keys(local.app_env), "JWT_SECRET")
    error_message = "Secrets come from Secrets Manager, never plain environment."
  }
}

# The firewalls' rule sets reference pattern sets whose ARNs are only known after an apply, so
# the rules are checked through the locals they are built from (bot_control_* plans the optional rule).
run "firewalls" {
  command = plan

  assert {
    condition     = length(distinct(values(local.app_waf_priority))) == length(local.app_waf_priority)
    error_message = "Firewall rule priorities must be unique."
  }
  assert {
    condition     = length(local.ai_crawler_patterns) <= 10 && alltrue([for p in local.ai_crawler_patterns : length(p) <= 200]) && contains(local.ai_crawler_agents, "gptbot") && contains(local.ai_crawler_agents, "claudebot") && contains(local.ai_crawler_agents, "perplexitybot") && !contains(local.ai_crawler_agents, "googlebot") && !contains(local.ai_crawler_agents, "bingbot")
    error_message = "AI crawler patterns: training crawlers and assistants, never ordinary search engines, within AWS WAF limits."
  }
  assert {
    condition     = length(aws_wafv2_regex_pattern_set.ai_crawlers.regular_expression) == length(local.ai_crawler_patterns) && length(aws_wafv2_regex_pattern_set.ai_crawlers_site.regular_expression) == length(local.ai_crawler_patterns)
    error_message = "Both firewalls match the whole AI crawler list."
  }
  assert {
    condition     = aws_wafv2_web_acl.app.scope == "REGIONAL" && aws_wafv2_web_acl.site.scope == "CLOUDFRONT" && aws_wafv2_regex_pattern_set.ai_crawlers_site.scope == "CLOUDFRONT"
    error_message = "The load balancer's firewall is regional; the marketing site's is CloudFront's (us-east-1)."
  }
  assert {
    condition     = contains([for h in aws_cloudfront_response_headers_policy.site.custom_headers_config[0].items : "${h.header}=${h.value}"], "tdm-reservation=1") && contains([for h in aws_cloudfront_response_headers_policy.site.custom_headers_config[0].items : "${h.header}=${h.value}"], "X-Robots-Tag=noai, noimageai")
    error_message = "The site opts out of AI training (TDMRep, noai) on CloudFront too."
  }
}

run "bot_control_and_assistants_allowed" {
  command = plan
  variables {
    waf_bot_control         = true
    waf_block_ai_assistants = false
  }
  assert {
    condition     = contains(local.ai_crawler_agents, "gptbot") && !contains(local.ai_crawler_agents, "perplexitybot") && !contains(local.ai_crawler_agents, "chatgpt-user")
    error_message = "Allowing AI assistants keeps training crawlers blocked."
  }
}

run "staging_with_replica_and_site" {
  command = plan
  variables {
    environment          = "staging"
    db_read_replica      = true
    nat_gateways         = 3
    site_domain          = "www.example.ca"
    site_certificate_arn = "arn:aws:acm:us-east-1:111122223333:certificate/def"
  }
  assert {
    condition     = length(aws_db_instance.replica) == 1 && length(aws_cloudwatch_metric_alarm.replica_lag) == 1
    error_message = "Replica and its lag alarm expected."
  }
  assert {
    condition     = !aws_db_instance.main.deletion_protection && aws_db_instance.main.skip_final_snapshot
    error_message = "Staging can be torn down."
  }
  assert {
    condition     = length(aws_nat_gateway.main) == 3
    error_message = "One NAT per zone when asked."
  }
}

run "rejects_regions_outside_canada" {
  command = plan
  variables {
    region = "us-east-1"
  }
  expect_failures = [var.region]
}

run "site_domain_needs_certificate" {
  command = plan
  variables {
    site_domain = "www.example.ca"
  }
  expect_failures = [aws_cloudfront_distribution.site]
}

run "nat_count_bounded" {
  command = plan
  variables {
    nat_gateways = 4
  }
  expect_failures = [aws_nat_gateway.main]
}

run "recovery_in_calgary" {
  command = plan
  variables {
    region                    = "ca-west-1"
    dr_region                 = "ca-central-1"
    recovery_mode             = true
    restore_from_backup_arn   = "arn:aws:rds:ca-west-1:111122223333:auto-backup:ab-1"
    existing_platform_key_arn = "arn:aws:kms:ca-west-1:111122223333:key/mrk-1"
  }
  assert {
    condition     = length(aws_kms_key.platform) == 0 && length(aws_kms_key.data_dr) == 0 && length(aws_s3_bucket.backups_dr) == 0 && length(aws_db_instance_automated_backups_replication.dr) == 0
    error_message = "Nothing may be created in the lost region."
  }
  assert {
    condition     = length(aws_ecr_repository.repo) == 0 && length(aws_secretsmanager_secret.app) == 0
    error_message = "Recovery uses the copied images and secret."
  }
  assert {
    condition     = one(aws_db_instance.main.restore_to_point_in_time).source_db_instance_automated_backups_arn == "arn:aws:rds:ca-west-1:111122223333:auto-backup:ab-1"
    error_message = "The database is restored from the copied backups."
  }
  assert {
    condition     = local.app_env["KMS_KEY_ARN"] == "arn:aws:kms:ca-west-1:111122223333:key/mrk-1" && !contains(keys(local.app_env), "KMS_REPLICA_REGION")
    error_message = "Recovery uses the platform key's copy and makes new keys single-region."
  }
  assert {
    condition     = startswith(aws_iam_role.app.name, "fh-production-ca-west-1-")
    error_message = "Account-wide names include the region."
  }
}

run "recovery_needs_backup_and_key" {
  command = plan
  variables {
    region        = "ca-west-1"
    dr_region     = "ca-central-1"
    recovery_mode = true
  }
  expect_failures = [aws_db_instance.main]
}
