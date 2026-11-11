# Infrastructure (Terraform, AWS Canada)

Builds one environment of FlexcityHeadquarters in `ca-central-1` (Montreal), with recovery copies in `ca-west-1` (Calgary). Background and choices: [docs/INFRASTRUCTURE.md](../../docs/INFRASTRUCTURE.md). Recovery steps: [docs/DISASTER-RECOVERY.md](../../docs/DISASTER-RECOVERY.md).

| File | What it builds |
| --- | --- |
| `network.tf` | VPC across three zones: public subnets (load balancer, NAT), private subnets (containers), isolated database subnets (no route out); security groups; S3 gateway endpoint |
| `kms.tf` | Platform key (multi-region, copied to Calgary), infrastructure keys in both regions |
| `database.tf` | RDS PostgreSQL 16, Multi-AZ, encrypted, TLS only, 35 days of point-in-time recovery, optional read replica, automated backups copied to Calgary |
| `storage.tf` | Backups bucket (versioned, object-locked, replicated to Calgary), load balancer logs, container registries, the app secret |
| `iam.tf` | Task roles: the API and worker may use and create KMS keys, never delete them |
| `compute.tf` | ECS Fargate: API, worker and web services, migration and database-role tasks, autoscaling on CPU and requests |
| `edge.tf` | Load balancer (HTTPS, `/api/*` to the API, health and metrics hidden), web firewall, the marketing site on S3 + CloudFront |
| `alarms.tf` | CloudWatch alarms to an SNS topic |

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

Commit a lock file generated with registry access: `terraform providers lock -platform=linux_amd64 -platform=darwin_arm64`.

## First deployment of an environment

Use a **separate AWS account per environment** (staging, production). The API may use any KMS key in its account, which is safe only when every key there is FlexcityHeadquarters' own (`iam.tf`).

1. **State.** Create an S3 bucket and a DynamoDB table for Terraform state in `ca-central-1`, then uncomment the `backend "s3"` block in `versions.tf`.
2. **Certificates.** In ACM, request a certificate in `ca-central-1` for `<root_domain>` and `*.<root_domain>` (DNS validation). For the marketing site on its own host name, request one in `us-east-1` (CloudFront only accepts certificates from there).
3. **Apply.** Copy `example.tfvars` to `production.tfvars`, fill it in, then run `terraform apply -var-file=production.tfvars`.
4. **Images.** Build and push the three images with the tag you deploy (the git commit):
   ```bash
   docker build --target api -t <ecr api>:<tag> .
   docker build --target migrate -t <ecr migrate>:<tag> .
   docker build --target web --build-arg API_URL=http://localhost:4000 --build-arg NEXT_PUBLIC_SITE_URL=https://www.<root_domain> -t <ecr web>:<tag> .
   ```
   The load balancer sends `/api/*` straight to the API, so the web app's own `/api` rewrite (`API_URL`) is a fallback that production doesn't use.
5. **The app secret** (`<env>/app` in Secrets Manager, JSON). Write it from a secure workstation, never into Terraform or the repository:

   | Key | Value |
   | --- | --- |
   | `FLEXCITY_APP_PASSWORD` | A new random password (32+ characters) for the app role |
   | `APP_DATABASE_URL` | `postgresql://flexcity_app:<that password, URL-encoded>@<endpoint>:5432/flexcity?sslmode=verify-full&sslrootcert=/etc/ssl/rds/global-bundle.pem` |
   | `LISTEN_DATABASE_URL` | The same as `APP_DATABASE_URL` (direct to the database, never through a transaction pooler) |
   | `JWT_SECRET` | 64 random bytes, base64 |
   | `METRICS_TOKEN` | 32 random characters; also given to the metrics collector |

   Database URLs are always written in this standard form. `pg` verifies the certificate and host name from it. For Prisma, which doesn't understand `verify-full`, the app translates it to Prisma's own settings (`apps/api/src/lib/dbUrl.ts`). In production the API refuses to start without `sslmode=verify-full` (or `verify-ca`) and an `sslrootcert`.

   The owner (`fh_owner`) password is **not** copied into this secret: RDS manages and rotates it. The migration and database-role tasks read it from the RDS secret and build the connection themselves (`apps/api/scripts/owner-url.mjs`).

   Optional keys can be added later: `TWILIO_AUTH_TOKEN`, `VAPID_PRIVATE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `SENTRY_DSN`, `READ_REPLICA_URL`, `FLEXCITY_UNION_PASSWORD`. Add each one to `app_secret_keys` (or set `union_role_password`) and apply. A task won't start if a key it names is missing.
6. **Database roles, then migrations.** Run as one-off tasks in the private subnets with the app security group (all values are Terraform outputs):
   ```bash
   aws ecs run-task --cluster <cluster> --launch-type FARGATE --task-definition <db_roles_task_definition> \
     --network-configuration 'awsvpcConfiguration={subnets=[<private_subnets>],securityGroups=[<app_security_group>]}'
   aws ecs run-task --cluster <cluster> --launch-type FARGATE --task-definition <migrate_task_definition> \
     --network-configuration 'awsvpcConfiguration={subnets=[<private_subnets>],securityGroups=[<app_security_group>]}'
   ```
7. **DNS.** Point `<root_domain>` and `*.<root_domain>` at the load balancer, and the site's host name at the CloudFront distribution (Route 53 alias records).
8. **Marketing site.** Run `npm run build -w apps/site` with `NEXT_PUBLIC_SITE_URL` set, then `aws s3 sync apps/site/out s3://<site_bucket> --delete` and invalidate the distribution.
9. **First Dev console administrator.** Run `npm run platform:admin` as a one-off task from the migration image with a command override; it uses the same owner connection.
10. **Metrics.** Give the collector's security group as `metrics_collector_security_group`, so it can scrape `/metrics` on port 4000 (docs/MONITORING.md).

## Every deployment

Push images tagged with the new commit, run the migration task, then apply with the new `image_tag`. ECS replaces tasks a few at a time, and the circuit breaker rolls back a deployment whose tasks don't become healthy.

## What it does not create

- Route 53 zones and records.
- The ACM certificates.
- The Terraform state bucket.
- AWS Organizations, CloudTrail and GuardDuty: enable them account-wide, once.
- The metrics collector (docs/MONITORING.md).
- The marketing-site build itself.
