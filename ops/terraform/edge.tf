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
  # /readyz fails only when the database is unreachable; a late outbox or a missing worker is a
  # warning there, so the load balancer never drops every task for those (docs/MONITORING.md).
  health_check {
    path                = "/readyz"
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

# Health and metrics answer only to the load balancer's own checks and the metrics collector
# inside the VPC, never from the internet.
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
    priority = 1
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
    priority = 2
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
    priority = 3
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
    priority = 4
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
}

resource "aws_cloudfront_distribution" "site" {
  enabled             = true
  is_ipv6_enabled     = true
  comment             = "FlexcityHeadquarters marketing site (${var.environment})"
  default_root_object = "index.html"
  price_class         = "PriceClass_100"
  aliases             = var.site_domain != "" ? [var.site_domain] : []

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
