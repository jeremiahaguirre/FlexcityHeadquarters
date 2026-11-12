# ---- Load balancer for the app (every organization's subdomain) ------------------------------
resource "aws_lb" "main" {
  name                       = local.name
  load_balancer_type         = "application"
  subnets                    = aws_subnet.public[*].id
  security_groups            = [aws_security_group.alb.id]
  drop_invalid_header_fields = true
  idle_timeout               = 120 # the live notification stream sends a keep-alive every 25 s
  enable_deletion_protection = var.environment == "production"
  access_logs {
    bucket  = aws_s3_bucket.logs.id
    prefix  = "alb"
    enabled = true
  }
  depends_on = [aws_s3_bucket_policy.logs]
}

resource "aws_lb_target_group" "api" {
  name                 = "${local.name}-api"
  port                 = 4000
  protocol             = "HTTP"
  target_type          = "ip"
  vpc_id               = aws_vpc.main.id
  deregistration_delay = 30
  # /healthz: the process answers. Not /readyz, which queries the database: during a pool
  # exhaustion or a Multi-AZ failover every task would fail it, and ECS would replace the whole
  # fleet in the middle of the spike. Database health is watched by alerts (docs/MONITORING.md).
  health_check {
    path                = "/healthz"
    matcher             = "200"
    interval            = 15
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
}

resource "aws_lb_target_group" "web" {
  name                 = "${local.name}-web"
  port                 = 3000
  protocol             = "HTTP"
  target_type          = "ip"
  vpc_id               = aws_vpc.main.id
  deregistration_delay = 30
  health_check {
    path                = "/login"
    matcher             = "200"
    interval            = 15
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"
  default_action {
    type = "redirect"
    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.main.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.certificate_arn
  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.web.arn
  }
}

# Health and metrics are never answered from the internet: the load balancer's health checks go
# to the tasks directly, and a metrics collector scrapes them inside the VPC (metrics_collector_security_group).
resource "aws_lb_listener_rule" "ops_hidden" {
  listener_arn = aws_lb_listener.https.arn
  priority     = 10
  condition {
    path_pattern {
      values = ["/healthz", "/readyz", "/metrics"]
    }
  }
  action {
    type = "fixed-response"
    fixed_response {
      content_type = "text/plain"
      message_body = "Not found"
      status_code  = "404"
    }
  }
}

resource "aws_lb_listener_rule" "api" {
  listener_arn = aws_lb_listener.https.arn
  priority     = 20
  condition {
    path_pattern {
      values = ["/api/*"]
    }
  }
  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }
}

# ---- AI crawlers (one list for the website's robots.txt, the app's and these firewalls) ------
locals {
  ai_crawlers       = jsondecode(file("${path.module}/../../apps/site/src/lib/aiCrawlers.json"))
  ai_crawler_agents = distinct([for a in concat(local.ai_crawlers.training, var.waf_block_ai_assistants ? local.ai_crawlers.assistants : []) : lower(a)])
  # Matched against the lower-cased User-Agent. A pattern set holds at most 10 patterns of 200 characters.
  ai_crawler_patterns = [for chunk in chunklist(local.ai_crawler_agents, 5) : join("|", chunk)]

  # The app firewall's rules, in evaluation order (each priority used once; tests/plan.tftest.hcl).
  app_waf_priority = {
    ip_reputation    = 1
    common           = 2
    known_bad_inputs = 3
    rate_per_address = 4
    ai_crawlers      = 5
    no_user_agent    = 6
    bot_control      = 7
  }
}

resource "aws_wafv2_regex_pattern_set" "ai_crawlers" {
  name  = "${local.name}-ai-crawlers"
  scope = "REGIONAL"
  dynamic "regular_expression" {
    for_each = local.ai_crawler_patterns
    content {
      regex_string = regular_expression.value
    }
  }
  lifecycle {
    precondition {
      condition     = length(local.ai_crawler_patterns) <= 10 && alltrue([for p in local.ai_crawler_patterns : length(p) <= 200 && can(regex("^[a-z0-9 |-]+$", p))])
      error_message = "AI crawler patterns must be plain names, at most 10 patterns of 200 characters (AWS WAF limits)."
    }
  }
}

# ---- Web firewall on the load balancer -----------------------------------------------------
resource "aws_wafv2_web_acl" "app" {
  name  = local.name
  scope = "REGIONAL"
  default_action {
    allow {}
  }
  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = local.name
    sampled_requests_enabled   = true
  }

  rule {
    name     = "ip-reputation"
    priority = local.app_waf_priority.ip_reputation
    override_action {
      none {}
    }
    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesAmazonIpReputationList"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "ip-reputation"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "common"
    priority = local.app_waf_priority.common
    override_action {
      none {}
    }
    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesCommonRuleSet"
        # Document uploads (up to 10 MB) and drawn signatures are larger than this rule's 8 KB
        # limit; the API sets its own body limits per route (apps/api/src/app.ts).
        rule_action_override {
          name = "SizeRestrictions_BODY"
          action_to_use {
            count {}
          }
        }
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "common"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "known-bad-inputs"
    priority = local.app_waf_priority.known_bad_inputs
    override_action {
      none {}
    }
    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesKnownBadInputsRuleSet"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "known-bad-inputs"
      sampled_requests_enabled   = true
    }
  }

  # A backstop against floods. The API has its own, finer limits (sign-in, kiosk PINs, public API keys).
  rule {
    name     = "rate-per-address"
    priority = local.app_waf_priority.rate_per_address
    action {
      block {}
    }
    statement {
      rate_based_statement {
        limit                 = var.waf_rate_limit
        aggregate_key_type    = "IP"
        evaluation_window_sec = 300
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "rate-per-address"
      sampled_requests_enabled   = true
    }
  }

  # AI training crawlers (and, unless waf_block_ai_assistants is false, AI assistants) by user agent.
  # robots.txt only asks; this enforces it. Blocked counts: metric "ai-crawlers" (docs/MONITORING.md).
  rule {
    name     = "ai-crawlers"
    priority = local.app_waf_priority.ai_crawlers
    action {
      block {}
    }
    statement {
      regex_pattern_set_reference_statement {
        arn = aws_wafv2_regex_pattern_set.ai_crawlers.arn
        field_to_match {
          single_header {
            name = "user-agent"
          }
        }
        text_transformation {
          priority = 0
          type     = "LOWERCASE"
        }
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "ai-crawlers"
      sampled_requests_enabled   = true
    }
  }

  # Browsers, phones, calendar apps, kiosks and webhooks all send a User-Agent; scripts that hide it don't.
  rule {
    name     = "no-user-agent"
    priority = local.app_waf_priority.no_user_agent
    action {
      block {}
    }
    statement {
      and_statement {
        statement {
          not_statement {
            statement {
              size_constraint_statement {
                comparison_operator = "GT"
                size                = 0
                field_to_match {
                  single_header {
                    name = "user-agent"
                  }
                }
                text_transformation {
                  priority = 0
                  type     = "NONE"
                }
              }
            }
          }
        }
        statement {
          not_statement {
            statement {
              regex_match_statement {
                regex_string = "^/(healthz|readyz)$"
                field_to_match {
                  uri_path {}
                }
                text_transformation {
                  priority = 0
                  type     = "NONE"
                }
              }
            }
          }
        }
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "no-user-agent"
      sampled_requests_enabled   = true
    }
  }

  # AWS Bot Control (optional, charged per request inspected): blocks unverified bots and
  # automation on pages; verified search engines are let through. /api/* is left out, because
  # calendar apps, kiosks, the public API and payment webhooks are legitimate non-browser clients.
  dynamic "rule" {
    for_each = var.waf_bot_control ? [1] : []
    content {
      name     = "bot-control"
      priority = local.app_waf_priority.bot_control
      override_action {
        none {}
      }
      statement {
        managed_rule_group_statement {
          vendor_name = "AWS"
          name        = "AWSManagedRulesBotControlRuleSet"
          managed_rule_group_configs {
            aws_managed_rules_bot_control_rule_set {
              inspection_level = "COMMON"
            }
          }
          scope_down_statement {
            not_statement {
              statement {
                byte_match_statement {
                  search_string         = "/api/"
                  positional_constraint = "STARTS_WITH"
                  field_to_match {
                    uri_path {}
                  }
                  text_transformation {
                    priority = 0
                    type     = "NONE"
                  }
                }
              }
            }
          }
        }
      }
      visibility_config {
        cloudwatch_metrics_enabled = true
        metric_name                = "bot-control"
        sampled_requests_enabled   = true
      }
    }
  }
}

resource "aws_wafv2_web_acl_association" "app" {
  resource_arn = aws_lb.main.arn
  web_acl_arn  = aws_wafv2_web_acl.app.arn
}

# ---- Marketing site: static files in S3 (Montreal), served by CloudFront -----------------------
# Only public pages are cached at CloudFront's edge (which may be outside Canada); no personal
# information goes through it. The app itself is served from the Montreal load balancer only.
resource "aws_s3_bucket" "site" {
  bucket = "${local.gname}-site-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket_public_access_block" "site" {
  bucket                  = aws_s3_bucket.site.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_cloudfront_origin_access_control" "site" {
  name                              = "${local.gname}-site"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# The site is exported with trailing slashes (/en/plans/ is /en/plans/index.html).
resource "aws_cloudfront_function" "index" {
  name    = "${local.gname}-index"
  runtime = "cloudfront-js-2.0"
  publish = true
  code    = <<-JS
    function handler(event) {
      var r = event.request;
      if (r.uri.endsWith('/')) r.uri += 'index.html';
      else if (r.uri.split('/').pop().indexOf('.') === -1) r.uri += '/index.html';
      return r;
    }
  JS
}

resource "aws_cloudfront_response_headers_policy" "site" {
  name = "${local.gname}-site"
  security_headers_config {
    strict_transport_security {
      access_control_max_age_sec = 31536000
      include_subdomains         = true
      override                   = true
    }
    content_type_options {
      override = true
    }
    frame_options {
      frame_option = "DENY"
      override     = true
    }
    referrer_policy {
      referrer_policy = "strict-origin-when-cross-origin"
      override        = true
    }
  }
  # The same AI-training opt-out the site sends on Vercel (apps/site/vercel.json); search indexing stays allowed.
  custom_headers_config {
    items {
      header   = "X-Robots-Tag"
      value    = "noai, noimageai"
      override = true
    }
    items {
      header   = "tdm-reservation"
      value    = "1"
      override = true
    }
  }
}

# CloudFront's firewall: AI crawlers by user agent, and a flood backstop. Global, so it is created
# in us-east-1 (versions.tf); it holds rules only.
resource "aws_wafv2_regex_pattern_set" "ai_crawlers_site" {
  provider = aws.us_east_1
  name     = "${local.gname}-site-ai-crawlers"
  scope    = "CLOUDFRONT"
  dynamic "regular_expression" {
    for_each = local.ai_crawler_patterns
    content {
      regex_string = regular_expression.value
    }
  }
}

resource "aws_wafv2_web_acl" "site" {
  provider = aws.us_east_1
  name     = "${local.gname}-site"
  scope    = "CLOUDFRONT"
  default_action {
    allow {}
  }
  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${local.gname}-site"
    sampled_requests_enabled   = true
  }

  rule {
    name     = "ai-crawlers"
    priority = 1
    action {
      block {}
    }
    statement {
      regex_pattern_set_reference_statement {
        arn = aws_wafv2_regex_pattern_set.ai_crawlers_site.arn
        field_to_match {
          single_header {
            name = "user-agent"
          }
        }
        text_transformation {
          priority = 0
          type     = "LOWERCASE"
        }
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "site-ai-crawlers"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "rate-per-address"
    priority = 2
    action {
      block {}
    }
    statement {
      rate_based_statement {
        limit                 = var.site_waf_rate_limit
        aggregate_key_type    = "IP"
        evaluation_window_sec = 300
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "site-rate-per-address"
      sampled_requests_enabled   = true
    }
  }
}

resource "aws_cloudfront_distribution" "site" {
  enabled             = true
  is_ipv6_enabled     = true
  comment             = "FlexcityHeadquarters marketing site (${var.environment})"
  default_root_object = "index.html"
  price_class         = "PriceClass_100"
  aliases             = var.site_domain != "" ? [var.site_domain] : []
  web_acl_id          = aws_wafv2_web_acl.site.arn

  origin {
    domain_name              = aws_s3_bucket.site.bucket_regional_domain_name
    origin_id                = "site"
    origin_access_control_id = aws_cloudfront_origin_access_control.site.id
  }

  default_cache_behavior {
    target_origin_id           = "site"
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = "658327ea-f89d-4fab-a63d-7e88639e58f6" # AWS managed: CachingOptimized
    response_headers_policy_id = aws_cloudfront_response_headers_policy.site.id
    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.index.arn
    }
  }

  custom_error_response {
    error_code         = 403
    response_code      = 404
    response_page_path = "/404.html"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  lifecycle {
    precondition {
      condition     = var.site_domain == "" || var.site_certificate_arn != ""
      error_message = "site_certificate_arn (in us-east-1) is required when site_domain is set."
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = var.site_domain == ""
    acm_certificate_arn            = var.site_domain != "" ? var.site_certificate_arn : null
    ssl_support_method             = var.site_domain != "" ? "sni-only" : null
    minimum_protocol_version       = var.site_domain != "" ? "TLSv1.2_2021" : null
  }
}

data "aws_iam_policy_document" "site" {
  statement {
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.site.arn}/*"]
    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.site.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "site" {
  bucket = aws_s3_bucket.site.id
  policy = data.aws_iam_policy_document.site.json
}
