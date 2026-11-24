# Infrastructure (Terraform, AWS Canada)

Builds one environment of FlexcityHeadquarters in `ca-central-1` (Montreal), with recovery copies in `ca-west-1` (Calgary). Background and choices: [docs/INFRASTRUCTURE.md](../../docs/INFRASTRUCTURE.md). Recovery steps: [docs/DISASTER-RECOVERY.md](../../docs/DISASTER-RECOVERY.md).

| File | What it builds |
| --- | --- |
| `network.tf` | VPC across three zones: public subnets (load balancer, NAT), private subnets (containers), isolated database subnets (no route out); one security group per kind of task (web, API, worker, one-off jobs; only the API, worker and jobs reach the database); S3 gateway endpoint |
| `kms.tf` | Platform key (multi-region, copied to Calgary), infrastructure keys in both regions |
| `database.tf` | RDS PostgreSQL 16, Multi-AZ, encrypted, TLS only, 35 days of point-in-time recovery, optional read replica, automated backups copied to Calgary; its exported log keeps statements, never their values, for `db_log_retention_days` (30), encrypted |
| `storage.tf` | Backups bucket (versioned, object-locked, replicated to Calgary), load balancer logs, container registries, the app secret |
| `iam.tf` | Task roles: the API and worker may use and create KMS keys (KMS-generated, symmetric, for encryption only), never delete them or bypass the key-policy safety check |
| `compute.tf` | ECS Fargate: API, worker and web services, migration and database-role tasks, autoscaling on CPU and requests |
| `edge.tf` | Load balancer (HTTPS, `/api/*` to the API, health and metrics hidden), web firewalls (app and site: managed rules, rate limits, AI crawlers), the marketing site on S3 + CloudFront |
| `deploy.tf` | The GitHub Actions deploy role (OIDC, no stored keys; this repository and GitHub environment only), its guardrails, cross-account image pull for promotion |
| `alarms.tf` | CloudWatch alarms to an SNS topic encrypted under its own key (CloudWatch can publish to it), a server-error ratio per service; the API and web deployments roll back when their alarms go off |

## Checks

```bash
terraform init -backend=false
terraform validate
terraform test
```

`terraform test` plans the whole configuration against mocked AWS providers (`tests/plan.tftest.hcl`), so it needs no account. It checks:
- three zones, a Multi-AZ, encrypted, deletion-protected database with 35 days of recovery;
- the services and their health checks;
- secrets coming only from Secrets Manager;
- that regions outside Canada are refused.
- the firewalls: unique rule priorities, the AI-crawler patterns within AWS limits (and never an ordinary search engine), the site's AI-training opt-out headers.

`.terraform.lock.hcl` is committed and pins the AWS provider's checksums; `terraform init` refuses a provider package that doesn't match. It holds the `linux_amd64` checksum (what CI and the deploy workflow use). Working on another platform, add its checksums once with registry access and commit the result: `terraform providers lock -platform=linux_amd64 -platform=darwin_arm64 -platform=darwin_amd64`. Dependabot proposes provider updates together with the new lock file.

Container images are scanned on push and, with `ecr_continuous_scanning` (default `true`), re-scanned by Amazon Inspector whenever a new vulnerability is published. Inspector charges per image scanned; `false` keeps only the free scan on push.

## Crawlers and AI bots

Both firewalls block AI crawlers by `User-Agent` (case-insensitive), from the same list as the website's robots.txt: `apps/site/src/lib/aiCrawlers.json`. The app's firewall (load balancer) also blocks requests with no `User-Agent`; the site's (CloudFront, created in `us-east-1` through the `aws.us_east_1` provider, firewall rules only) adds a per-address rate limit (`site_waf_rate_limit`).

| Variable | Default | What it does |
| --- | --- | --- |
| `waf_block_ai_assistants` | `true` | Also blocks AI search and assistants (ChatGPT-User, OAI-SearchBot, PerplexityBot, Claude-User…). Set to `false` together with `ALLOW_AI_ASSISTANTS` in `apps/site/src/lib/crawlers.ts` to let them read and cite the site. Training crawlers stay blocked either way. |
| `waf_bot_control` | `false` | Adds AWS's managed Bot Control rule group (common inspection level) on pages, not `/api/*` (calendar apps, kiosks, the public API and webhooks are legitimate non-browser clients). Verified search engines are let through. It is charged per request inspected, on top of the firewall itself: see AWS WAF pricing before turning it on. |

A user agent can be faked, so this stops honest and lazy crawlers, not a determined scraper; the rate limits and Bot Control cover more. Blocked requests are counted in CloudWatch (docs/MONITORING.md).

## First deployment of an environment

Use a **separate AWS account per environment** (staging, production). The API may use any KMS key in its account, which is safe only when every key there is FlexcityHeadquarters' own (`iam.tf`).

1. **State.** Create the state bucket and lock table with `ops/terraform/bootstrap` (once per account), and write the environment's `backend/<env>.s3.tfbackend` (docs/DEPLOYING.md). Then `terraform init -backend-config=backend/<env>.s3.tfbackend`. Checks that need no state keep using `terraform init -backend=false`.
2. **Certificates.** In ACM, request a certificate in `ca-central-1` for `<root_domain>` and `*.<root_domain>` (DNS validation). For the marketing site on its own host name, request one in `us-east-1` (CloudFront only accepts certificates from there).
3. **Apply.** Copy `example.tfvars` to `production.tfvars`, fill it in, then run `terraform apply -var-file=production.tfvars`.
4. **Images.** Build and push the three images with the tag you deploy (the git commit):
   ```bash
   docker build --target api -t <ecr api>:<tag> .
   docker build --target migrate -t <ecr migrate>:<tag> .
   docker build --target web --build-arg NEXT_PUBLIC_RELEASE=<tag> --build-arg NEXT_PUBLIC_SITE_URL=https://www.<root_domain> -t <ecr web>:<tag> .
   ```
   `NEXT_PUBLIC_RELEASE` must be the same tag as `image_tag` (the API's `RELEASE`), or open pages keep seeing a "new version" (docs/RELEASES.md). Build from the committed tree (`git archive <tag> | docker build … -`) so nothing uncommitted gets in.
   The load balancer sends `/api/*` straight to the API, so the web app's build-time `/api` rewrite is a fallback that production doesn't use. Its server-rendered pages (an organization's branding, its job postings) do call the API, at `API_URL` set in the web task (`http://api.<name>.internal:4000`, Cloud Map).
5. **The app secret** (`<env>/app` in Secrets Manager, JSON). Write it from a secure workstation, never into Terraform or the repository:

   | Key | Value |
   | --- | --- |
   | `FLEXCITY_APP_PASSWORD` | A new random password (32+ characters) for the app role |
   | `APP_DATABASE_URL` | `postgresql://flexcity_app:<that password, URL-encoded>@<endpoint>:5432/flexcity?sslmode=verify-full&sslrootcert=/etc/ssl/rds/global-bundle.pem` |
   | `LISTEN_DATABASE_URL` | The same as `APP_DATABASE_URL` (direct to the database, never through a transaction pooler) |
   | `JWT_SECRET` | 64 random bytes, base64 |
   | `METRICS_TOKEN` | 32 random characters; also given to the metrics collector |

   Database URLs are always written in this standard form. `pg` verifies the certificate and host name from it; the app connects only through `pg` (Prisma 7's driver adapter). Only the Prisma CLI used for migrations doesn't understand `verify-full`, so `prisma.config.ts` translates the URL to Prisma's own settings for it (`apps/api/src/lib/dbUrl.ts`). In production the API refuses to start without `sslmode=verify-full` and an `sslrootcert`, and refuses Prisma 5 URL parameters that `pg` would ignore (`connect_timeout`, `schema`, `pgbouncer`, `statement_cache_size`, `socket_timeout`).

   The owner (`fh_owner`) password is **not** copied into this secret: RDS manages and rotates it. The migration and database-role tasks read it from the RDS secret and build the connection themselves (`apps/api/scripts/owner-url.mjs`).

   Optional keys can be added later: `INTERNAL_API_TOKEN` (48 random characters: the web tasks send it on their server-side calls, so the API rate-limits those on their own budget instead of the anonymous one every sign-in page shares; the web task gets it too once it is in `app_secret_keys`), `TWILIO_AUTH_TOKEN`, `VAPID_PRIVATE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `SENTRY_DSN`, `READ_REPLICA_URL`, `FLEXCITY_UNION_PASSWORD`. Add each one to `app_secret_keys` (or set `union_role_password`) and apply. A task won't start if a key it names is missing.
6. **Database roles, then migrations.** Run as one-off tasks in the private subnets with the jobs security group (all values are Terraform outputs):
   ```bash
   aws ecs run-task --cluster <cluster> --launch-type FARGATE --task-definition <db_roles_task_definition> \
     --network-configuration 'awsvpcConfiguration={subnets=[<private_subnets>],securityGroups=[<jobs_security_group>]}'
   aws ecs run-task --cluster <cluster> --launch-type FARGATE --task-definition <migrate_task_definition> \
     --network-configuration 'awsvpcConfiguration={subnets=[<private_subnets>],securityGroups=[<jobs_security_group>]}'
   ```
7. **DNS.** Point `<root_domain>` and `*.<root_domain>` at the load balancer, and the site's host name at the CloudFront distribution (Route 53 alias records).
8. **Marketing site.** Run `npm run build -w apps/site` with `NEXT_PUBLIC_SITE_URL` set, then `aws s3 sync apps/site/out s3://<site_bucket> --delete` and invalidate the distribution.
9. **First Dev console administrator.** Run `npm run platform:admin -- <email> "<name>"` (with `PLATFORM_ADMIN_PASSWORD`) as a one-off task from the migration image with a command override; it uses the same owner connection (`DB_*`), as does `npm run tenant:purge`.
10. **Metrics.** Give the collector's security group as `metrics_collector_security_group`, so it can scrape `/metrics` on port 4000 (docs/MONITORING.md).

## Every deployment

`.github/workflows/deploy.yml` does this for every commit of `main` that passed CI, staging first, then production after approval ([docs/DEPLOYING.md](../../docs/DEPLOYING.md)). By hand: push images tagged with the new commit (the web built with the same `NEXT_PUBLIC_RELEASE`), run the migration task, then apply with the new `image_tag`. Tasks stop gracefully on SIGTERM. A full rehearsal of all this on one machine: docs/INFRASTRUCTURE.md, "Production rehearsal". ECS replaces tasks a few at a time, and the circuit breaker rolls back a deployment whose tasks don't become healthy.

## Alarms

Alarms go to the `<env>-alarms` SNS topic, encrypted under `alias/<env>-alarms`, a key whose policy lets CloudWatch publish (the AWS-managed `alias/aws/sns` key can't, so nothing would be delivered). Set `alarm_email` and confirm the subscription email. Then test delivery once per environment:

```bash
aws cloudwatch set-alarm-state --alarm-name <env>-api-5xx-ratio --state-value ALARM --state-reason "Delivery test"
```

The email should arrive within a minute; the alarm returns to OK on its own at the next evaluation.

| Alarm | Fires when | Also rolls back a deployment |
| --- | --- | --- |
| `<env>-api-5xx-ratio`, `<env>-web-5xx-ratio` | more than `error_ratio_percent` (5) % of that service's requests are server errors in 3 of 5 minutes; minutes with fewer than `error_ratio_min_requests` (20) requests count as healthy | yes, that service's |
| `<env>-api-unhealthy`, `<env>-web-unhealthy` | no healthy task behind the load balancer for 2 minutes | yes, that service's |
| `<env>-alb-5xx` | more than 50 server errors a minute (an empty minute is healthy: the load balancer only publishes minutes that had one) | no |
| `<env>-db-cpu`, `<env>-db-storage`, `<env>-replica-lag` | database CPU, free storage, replica lag | no |
| `<env>-kms-createkey-with-policy` (EventBridge rule) | the app role creates a KMS key with a custom key policy, which could hand the key to another account; needs CloudTrail management events in the account | no |

ECS watches each service's alarms while a deployment runs and rolls back to the previous task definition if one goes off. The circuit breaker still rolls back tasks that never become healthy, and it is the worker's only automatic rollback.

## What it does not create

- Route 53 zones and records.
- The ACM certificates.
- The Terraform state bucket and lock table (`bootstrap/`, applied once per account).
- AWS Organizations, CloudTrail and GuardDuty: enable them account-wide, once.
- The metrics collector (docs/MONITORING.md).
- The marketing-site build itself.
