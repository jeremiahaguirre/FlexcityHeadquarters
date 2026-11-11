# Infrastructure alarms. Application alerts (safety texts, outbox, error rate) are Prometheus
# rules in ops/monitoring/alerts.yml, scraped from the API (docs/MONITORING.md).
resource "aws_sns_topic" "alarms" {
  name              = "${local.name}-alarms"
  kms_master_key_id = "alias/aws/sns"
}

resource "aws_sns_topic_subscription" "email" {
  count     = var.alarm_email != "" ? 1 : 0
  topic_arn = aws_sns_topic.alarms.arn
  protocol  = "email"
  endpoint  = var.alarm_email
}

locals {
  alarms = {
    alb-5xx = {
      namespace = "AWS/ApplicationELB", metric = "HTTPCode_Target_5XX_Count", stat = "Sum", threshold = 50, op = "GreaterThanThreshold", periods = 2
      dims      = { LoadBalancer = aws_lb.main.arn_suffix }
      text      = "More than 50 server errors a minute from the app"
    }
    api-unhealthy = {
      namespace = "AWS/ApplicationELB", metric = "HealthyHostCount", stat = "Minimum", threshold = 1, op = "LessThanThreshold", periods = 2
      dims      = { LoadBalancer = aws_lb.main.arn_suffix, TargetGroup = aws_lb_target_group.api.arn_suffix }
      text      = "No healthy API task behind the load balancer"
    }
    web-unhealthy = {
      namespace = "AWS/ApplicationELB", metric = "HealthyHostCount", stat = "Minimum", threshold = 1, op = "LessThanThreshold", periods = 2
      dims      = { LoadBalancer = aws_lb.main.arn_suffix, TargetGroup = aws_lb_target_group.web.arn_suffix }
      text      = "No healthy web task behind the load balancer"
    }
    db-cpu = {
      namespace = "AWS/RDS", metric = "CPUUtilization", stat = "Average", threshold = 80, op = "GreaterThanThreshold", periods = 10
      dims      = { DBInstanceIdentifier = aws_db_instance.main.identifier }
      text      = "Database CPU above 80% for 10 minutes"
    }
    db-storage = {
      namespace = "AWS/RDS", metric = "FreeStorageSpace", stat = "Minimum", threshold = 10737418240, op = "LessThanThreshold", periods = 5
      dims      = { DBInstanceIdentifier = aws_db_instance.main.identifier }
      text      = "Database has less than 10 GB free (storage grows automatically up to db_max_storage_gb)"
    }
  }
}

resource "aws_cloudwatch_metric_alarm" "main" {
  for_each            = local.alarms
  alarm_name          = "${local.name}-${each.key}"
  alarm_description   = each.value.text
  namespace           = each.value.namespace
  metric_name         = each.value.metric
  statistic           = each.value.stat
  period              = 60
  evaluation_periods  = each.value.periods
  threshold           = each.value.threshold
  comparison_operator = each.value.op
  dimensions          = each.value.dims
  treat_missing_data  = "breaching"
  alarm_actions       = [aws_sns_topic.alarms.arn]
  ok_actions          = [aws_sns_topic.alarms.arn]
}

resource "aws_cloudwatch_metric_alarm" "replica_lag" {
  count               = var.db_read_replica ? 1 : 0
  alarm_name          = "${local.name}-replica-lag"
  alarm_description   = "Read replica more than 60 s behind: reports may show stale data"
  namespace           = "AWS/RDS"
  metric_name         = "ReplicaLag"
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 5
  threshold           = 60
  comparison_operator = "GreaterThanThreshold"
  dimensions          = { DBInstanceIdentifier = aws_db_instance.replica[0].identifier }
  alarm_actions       = [aws_sns_topic.alarms.arn]
  ok_actions          = [aws_sns_topic.alarms.arn]
}
