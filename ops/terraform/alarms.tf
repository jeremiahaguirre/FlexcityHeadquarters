# Infrastructure alarms. Application alerts (safety texts, outbox, error rate) are Prometheus
# rules in ops/monitoring/alerts.yml, scraped from the API (docs/MONITORING.md).

# The topic is encrypted under a key of our own: CloudWatch alarms cannot publish to a topic under
# the AWS-managed alias/aws/sns key, whose policy can't grant cloudwatch.amazonaws.com, so with it
# no alarm was ever delivered (SECURITY-AUDIT SEC-50).
data "aws_iam_policy_document" "alarms_key" {
  statement {
    sid       = "AccountAdministers"
    actions   = ["kms:*"]
    resources = ["*"]
    principals {
      type        = "AWS"
      identifiers = ["arn:aws:iam::${data.aws_caller_identity.current.account_id}:root"]
    }
  }
  statement {
    sid       = "CloudWatchAlarmsPublish"
    actions   = ["kms:Decrypt", "kms:GenerateDataKey*"]
    resources = ["*"]
    principals {
      type        = "Service"
      identifiers = ["cloudwatch.amazonaws.com", "events.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }
  }
}

resource "aws_kms_key" "alarms" {
  description         = "FlexcityHeadquarters alarm notifications (${var.environment})"
  enable_key_rotation = true
  policy              = data.aws_iam_policy_document.alarms_key.json
}

resource "aws_kms_alias" "alarms" {
  name          = "alias/${local.name}-alarms"
  target_key_id = aws_kms_key.alarms.key_id
}

resource "aws_sns_topic" "alarms" {
  name              = "${local.name}-alarms"
  kms_master_key_id = aws_kms_alias.alarms.name
}

# Only this account's CloudWatch alarms may publish (and the account itself, for a test message).
data "aws_iam_policy_document" "alarms_topic" {
  statement {
    sid       = "CloudWatchAlarms"
    actions   = ["sns:Publish"]
    resources = [aws_sns_topic.alarms.arn]
    principals {
      type        = "Service"
      identifiers = ["cloudwatch.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }
    condition {
      test     = "ArnLike"
      variable = "aws:SourceArn"
      values   = ["arn:aws:cloudwatch:${var.region}:${data.aws_caller_identity.current.account_id}:alarm:${local.name}-*"]
    }
  }
  statement {
    sid       = "SecurityEvents"
    actions   = ["sns:Publish"]
    resources = [aws_sns_topic.alarms.arn]
    principals {
      type        = "Service"
      identifiers = ["events.amazonaws.com"]
    }
    condition {
      test     = "ArnEquals"
      variable = "aws:SourceArn"
      values   = [aws_cloudwatch_event_rule.kms_create_key_with_policy.arn]
    }
  }
  statement {
    sid       = "Account"
    actions   = ["sns:Publish", "sns:Subscribe", "sns:GetTopicAttributes", "sns:SetTopicAttributes", "sns:ListSubscriptionsByTopic"]
    resources = [aws_sns_topic.alarms.arn]
    principals {
      type        = "AWS"
      identifiers = ["arn:aws:iam::${data.aws_caller_identity.current.account_id}:root"]
    }
  }
}

resource "aws_sns_topic_policy" "alarms" {
  arn    = aws_sns_topic.alarms.arn
  policy = data.aws_iam_policy_document.alarms_topic.json
}

resource "aws_sns_topic_subscription" "email" {
  count     = var.alarm_email != "" ? 1 : 0
  topic_arn = aws_sns_topic.alarms.arn
  protocol  = "email"
  endpoint  = var.alarm_email
}

locals {
  # missing: what an empty minute means. The load balancer publishes its 5xx count only for minutes
  # that had one, so for alb-5xx an empty minute is a good minute (notBreaching); before, "breaching"
  # held the alarm in ALARM during normal operation, so a real spike changed nothing and notified
  # no one (SEC-51). A missing health count or database metric does mean something is wrong.
  alarms = {
    alb-5xx = {
      namespace = "AWS/ApplicationELB", metric = "HTTPCode_Target_5XX_Count", stat = "Sum", threshold = 50, op = "GreaterThanThreshold", periods = 2, missing = "notBreaching"
      dims      = { LoadBalancer = aws_lb.main.arn_suffix }
      text      = "More than 50 server errors a minute from the app"
    }
    api-unhealthy = {
      namespace = "AWS/ApplicationELB", metric = "HealthyHostCount", stat = "Minimum", threshold = 1, op = "LessThanThreshold", periods = 2, missing = "breaching"
      dims      = { LoadBalancer = aws_lb.main.arn_suffix, TargetGroup = aws_lb_target_group.api.arn_suffix }
      text      = "No healthy API task behind the load balancer"
    }
    web-unhealthy = {
      namespace = "AWS/ApplicationELB", metric = "HealthyHostCount", stat = "Minimum", threshold = 1, op = "LessThanThreshold", periods = 2, missing = "breaching"
      dims      = { LoadBalancer = aws_lb.main.arn_suffix, TargetGroup = aws_lb_target_group.web.arn_suffix }
      text      = "No healthy web task behind the load balancer"
    }
    db-cpu = {
      namespace = "AWS/RDS", metric = "CPUUtilization", stat = "Average", threshold = 80, op = "GreaterThanThreshold", periods = 10, missing = "breaching"
      dims      = { DBInstanceIdentifier = aws_db_instance.main.identifier }
      text      = "Database CPU above 80% for 10 minutes"
    }
    db-storage = {
      namespace = "AWS/RDS", metric = "FreeStorageSpace", stat = "Minimum", threshold = 10737418240, op = "LessThanThreshold", periods = 5, missing = "breaching"
      dims      = { DBInstanceIdentifier = aws_db_instance.main.identifier }
      text      = "Database has less than 10 GB free (storage grows automatically up to db_max_storage_gb)"
    }
  }

  # Share of requests a service answered with a server error (its own 5xx, per target group; the
  # load balancer's own 502/503/504 have no per-service metric, and tasks too broken to answer
  # trip the *-unhealthy alarms and the circuit breaker instead). Quiet minutes
  # (fewer than error_ratio_min_requests) count as healthy, so a handful of requests at night
  # can't page anyone. These two also stop and roll back a deployment (compute.tf).
  ratio_alarms = {
    api = aws_lb_target_group.api.arn_suffix
    web = aws_lb_target_group.web.arn_suffix
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
  treat_missing_data  = each.value.missing
  alarm_actions       = [aws_sns_topic.alarms.arn]
  ok_actions          = [aws_sns_topic.alarms.arn]
}

resource "aws_cloudwatch_metric_alarm" "error_ratio" {
  for_each            = local.ratio_alarms
  alarm_name          = "${local.name}-${each.key}-5xx-ratio"
  alarm_description   = "More than ${var.error_ratio_percent}% of ${each.key} requests failed with a server error (3 of 5 minutes). Also rolls back an ECS deployment in progress."
  comparison_operator = "GreaterThanThreshold"
  threshold           = var.error_ratio_percent
  evaluation_periods  = 5
  datapoints_to_alarm = 3
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alarms.arn]
  ok_actions          = [aws_sns_topic.alarms.arn]

  metric_query {
    id          = "ratio"
    expression  = "IF(requests >= ${var.error_ratio_min_requests}, 100 * FILL(target5xx, 0) / requests, 0)"
    label       = "Server errors (%)"
    return_data = true
  }
  metric_query {
    id = "requests"
    metric {
      namespace   = "AWS/ApplicationELB"
      metric_name = "RequestCount"
      stat        = "Sum"
      period      = 60
      dimensions  = { LoadBalancer = aws_lb.main.arn_suffix, TargetGroup = each.value }
    }
  }
  metric_query {
    id = "target5xx"
    metric {
      namespace   = "AWS/ApplicationELB"
      metric_name = "HTTPCode_Target_5XX_Count"
      stat        = "Sum"
      period      = 60
      dimensions  = { LoadBalancer = aws_lb.main.arn_suffix, TargetGroup = each.value }
    }
  }
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

# The app creates organization keys with the default key policy (the account administers them).
# A key the app role creates with a policy of its own could hand the key to someone else, and IAM
# conditions can't refuse it, so it raises an alarm (SECURITY-AUDIT SEC-52). Both ways count:
# CreateKey with a Policy, and ReplicateKey with a Policy (logged as ReplicateKey here and as
# CreateKey in the recovery region). Needs CloudTrail management events in the account (README.md,
# "What it does not create"). EventBridge only sees its own region's events, so the recovery region
# has the same rule, forwarding to this region's default bus, where this rule (which matches
# events from any region) sends them to the alarm topic.
locals {
  kms_policy_event_pattern = jsonencode({
    source        = ["aws.kms"]
    "detail-type" = ["AWS API Call via CloudTrail"]
    detail = {
      eventSource       = ["kms.amazonaws.com"]
      eventName         = ["CreateKey", "ReplicateKey"]
      userIdentity      = { sessionContext = { sessionIssuer = { arn = ["arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/${aws_iam_role.app.name}"] } } }
      requestParameters = { policy = [{ exists = true }] }
    }
  })
}

resource "aws_cloudwatch_event_rule" "kms_create_key_with_policy" {
  name          = "${local.name}-kms-createkey-with-policy"
  description   = "The app role created or replicated a KMS key with a custom key policy"
  event_pattern = local.kms_policy_event_pattern
}

resource "aws_cloudwatch_event_rule" "kms_create_key_with_policy_dr" {
  count         = var.recovery_mode ? 0 : 1
  provider      = aws.dr
  name          = "${local.name}-kms-createkey-with-policy"
  description   = "The app role created or replicated a KMS key with a custom key policy (recovery region; forwarded to ${var.region})"
  event_pattern = local.kms_policy_event_pattern
}

data "aws_iam_policy_document" "events_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["events.amazonaws.com"]
    }
  }
}

# Lets the recovery region's rule put the events on this region's default bus.
resource "aws_iam_role" "events_forward" {
  count              = var.recovery_mode ? 0 : 1
  name               = "${local.gname}-events-forward"
  assume_role_policy = data.aws_iam_policy_document.events_assume.json
}

resource "aws_iam_role_policy" "events_forward" {
  count = var.recovery_mode ? 0 : 1
  role  = aws_iam_role.events_forward[0].id
  policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Action = "events:PutEvents", Resource = "arn:aws:events:${var.region}:${data.aws_caller_identity.current.account_id}:event-bus/default" }]
  })
}

resource "aws_cloudwatch_event_target" "kms_create_key_with_policy_dr" {
  count    = var.recovery_mode ? 0 : 1
  provider = aws.dr
  rule     = aws_cloudwatch_event_rule.kms_create_key_with_policy_dr[0].name
  arn      = "arn:aws:events:${var.region}:${data.aws_caller_identity.current.account_id}:event-bus/default"
  role_arn = aws_iam_role.events_forward[0].arn
}

resource "aws_cloudwatch_event_target" "kms_create_key_with_policy" {
  rule = aws_cloudwatch_event_rule.kms_create_key_with_policy.name
  arn  = aws_sns_topic.alarms.arn
}
