# Infrastructure: AWS in Canada

Decision (November 2026): FlexcityHeadquarters runs on **Amazon Web Services**, with every copy of customer data kept in Canada.

| Role | Region | Location | Availability Zones |
|---|---|---|---|
| Primary | `ca-central-1` (Canada Central) | Greater Montreal, Quebec | 3 |
| Disaster recovery | `ca-west-1` (Canada West) | Calgary, Alberta | 3 |

## Why these two regions

- Canadian cities and provincial public-sector privacy laws expect personal information to stay in Canada (see `docs/PIA.md` and `docs/COMPLIANCE.md`). Both regions are in Canada, so failover never moves data abroad.
- Montreal has been AWS's Canadian region since 2016 and has the widest service catalogue. Calgary (since December 2023) is far enough away for regional disasters and is a separate power and network grid.
- Three Availability Zones in each region allow Multi-AZ databases and spreading app servers across zones.

## Planned layout (to be built in the infrastructure tasks)

- **Compute:** containers on ECS Fargate for the API, the worker and the web app, spread across the three zones, behind an Application Load Balancer that checks `/healthz` (process alive). `/readyz` is for dashboards and alerts: because it queries the database, using it for the load balancer would make ECS replace every task during a database failover.
- **Scaling:** autoscaling on CPU, response time and queue depth.
- **Database:** Amazon RDS for PostgreSQL, Multi-AZ, with row-level security as today.
  - The worker and the LISTEN connection go to Postgres directly, not through a transaction pooler (see `docs/ARCHITECTURE.md`).
  - Read replicas serve reports.
- **Files and backups:** Amazon S3 with server-side encryption under customer-managed KMS keys created in Canada. Versioning and object lock protect backups.
- **Secrets:** AWS Secrets Manager (JWT secret, key-encryption keys, Twilio, metrics token).
- **Edge:** CloudFront for the website and static app files, plus AWS WAF and Shield Standard.
  - CloudFront caches at edge locations that may sit outside Canada.
  - Only public, non-personal files are cached there; app API responses that contain personal information are never cached at the edge.
- **Disaster recovery to `ca-west-1`:**
  - the database copied to Calgary (cross-region replica or automated snapshot copies)
  - S3 cross-region replication
  - keys available in both regions
  - DNS switched to Calgary by the recovery runbook (a deliberate decision, not automatic, so a short Montreal outage doesn't start a restore)
  - Recovery targets, what is copied where, and the runbooks: [DISASTER-RECOVERY.md](DISASTER-RECOVERY.md).
- **Infrastructure as code:** Terraform in [`ops/terraform`](../ops/terraform/README.md), so environments (staging, production) are reproducible and reviewed like code; container images from the root `Dockerfile`.

## Open choices for the owner

- Budget and expected size at launch (drives instance sizes and whether a read replica is needed on day one).
- Email provider (Amazon SES in `ca-central-1` is the natural fit) and error-tracking vendor (must be hosted in Canada; see `docs/SUBPROCESSORS.md`).
- Whether CloudFront's global edge caching of public files is acceptable to customers that require strict in-Canada processing. If not, serve directly from the Montreal load balancer.

AWS (Amazon Web Services Canada) is to be added to `docs/SUBPROCESSORS.md` as the hosting provider when the infrastructure is set up.

## Production rehearsal

Run on one machine with Docker on 12 November 2026 (commits `7cab268` to `c7e031c`), to find what only breaks in production before the first AWS deployment. Everything ran the way the task definitions in `ops/terraform/compute.tf` run it. The production images were built from the committed tree (`git archive HEAD | docker build … -`). Configuration was `NODE_ENV=production` and the environment variables from `local.app_env`. The stand-ins were:

| AWS piece | Stand-in |
| --- | --- |
| RDS PostgreSQL | `postgres:16` with TLS only (`hostnossl … reject`, like `rds.force_ssl=1`), with a throwaway CA and a server certificate for the host name `db`. The master user `fh_owner` is **not** a superuser: it has CREATEROLE and CREATEDB and owns the `flexcity` database, like an RDS master user. |
| KMS | `nsmithuk/local-kms`, seeded with the platform key and `alias/flexcity-platform`. The API reaches it with the AWS SDK's standard `AWS_ENDPOINT_URL_KMS`. |
| ALB | nginx. Port 80 sends a 301 to HTTPS. On 443, `/healthz`, `/readyz` and `/metrics` answer 404, `/api/*` goes to the API tasks and everything else goes to the web task. Client addresses are appended to `X-Forwarded-For` and `X-Forwarded-Proto: https` is set. |
| Cloud Map `api.<name>.internal` | A Docker network alias `api` shared by both API containers. |
| Secrets Manager | An env file. |

**Commands** (`$OWNER_ENV` = `-e NODE_ENV=production -e DB_HOST=db -e DB_NAME=flexcity -e DB_USER=fh_owner -e DB_PASSWORD=… -e DB_SSLROOTCERT=<CA>`, as in `local.owner_env`):

```bash
# images, one tag for both (the API's RELEASE and the web build's NEXT_PUBLIC_RELEASE must match)
TAG=$(git rev-parse --short HEAD)
for t in api migrate; do git archive HEAD | docker build --target $t -t fh-$t:$TAG -; done
git archive HEAD | docker build --target web --build-arg NEXT_PUBLIC_RELEASE=$TAG \
  --build-arg NEXT_PUBLIC_SITE_URL=https://www.<root_domain> -t fh-web:$TAG -
# one-off tasks, in order
docker run --rm $OWNER_ENV -e FLEXCITY_APP_PASSWORD=… -e FLEXCITY_UNION_PASSWORD=… fh-migrate:$TAG node scripts/set-role-passwords.mjs  # db-roles
docker run --rm $OWNER_ENV fh-migrate:$TAG                                    # migrate: prisma migrate deploy, then rls.sql and union_hub.sql
docker run --rm $OWNER_ENV -e PLATFORM_ADMIN_PASSWORD=… fh-migrate:$TAG npm run platform:admin -- ops@<domain> "Name"
# services (app env = local.app_env + the app secret; the web gets NODE_ENV, ROOT_DOMAIN and API_URL=http://api.<name>.internal:4000)
docker run -d --name api1 --network-alias api --env-file app.env fh-api:$TAG     # and api2
docker run -d --name worker --env-file app.env fh-api:$TAG node dist/worker.js
docker run -d --name web -e NODE_ENV=production -e ROOT_DOMAIN=<root_domain> -e API_URL=http://api:4000 fh-web:$TAG
# rolling restart, one API task at a time, as ECS and the ALB do it: take the task out of the
# load balancer's pool and reload it, wait out the deregistration delay, then
docker stop -t 30 api1    # SIGTERM; the task finishes its requests and ends its live streams
# start the replacement, wait for /healthz to answer 200, put it back in the pool, then do api2
```

**What passed**

- **Images.** All three built from the committed tree with `NODE_IMAGE` pinned.
- **Database certificate checks.** `verify-full` against the rehearsal CA was accepted. A different CA was refused, both by Prisma (P1011) and by `pg`. A host name not in the certificate was refused too.
  Since the Prisma 7 upgrade (November 2026) the API's queries go through `pg` (the driver adapter in `apps/api/src/lib/prismaClient.ts`), which reads the same `sslmode=verify-full&sslrootcert=…` URL; only the migration task's Prisma CLI still gets the translated spelling (`prisma.config.ts`). Re-checked locally against a Postgres with its own test CA: the right CA connects, a different CA and a host name not in the certificate are refused, by the app and by the Prisma CLI (`prisma migrate status`) alike. The API image no longer carries a Prisma engine binary; the migrate image still runs Prisma's schema engine (it needs OpenSSL, still in the base image).
- **One-off tasks.** `db-roles`, then `migrate` (every migration, then RLS and the union schema), ran as a non-superuser owner. Both are safe to run again.
- **Health endpoints.** `/healthz` and `/readyz` (also with `?strict=1`) answer 200 on the tasks. Through the load balancer they answer 404. `/metrics` answers 401 without the token, and with it returns `fh_database_up 1` and `fh_worker_connected 1`.
- **Organization set-up.**
  1. Dev console: password, then a passkey (`PLATFORM_MFA=required`).
  2. Create an organization with its first HR administrator.
  3. The worker sent the invitation.
  4. HR set a password from the invitation, set up a passkey (HR requires one) and signed the consent agreement.
- **Day-to-day features.**
  - HR added a position and invited a staff member. The worker delivered the email.
  - The staff member clocked in and out.
  - HR sent a message. It reached the staff member's live stream on the other API task (through `pg_notify`), and the staff member read it.
  - HR created and published an anonymous survey to 5 or more people, and it was answered.
- **Security headers.** Pages and API answers carry `X-Robots-Tag` (noindex, noai), HSTS, CSP, `X-Frame-Options: DENY`, `nosniff` and `X-FH-Version`.
- **Rate limits.** 300 anonymous requests got 429 with `Retry-After` once the per-process bucket was empty. A made-up `X-Forwarded-For` didn't help, because `trust proxy 1` takes the address the load balancer appended.
- **Lockouts.** Wrong passwords from one network locked that network out. Many networks (direct to a task, as from inside the VPC) locked the whole account, and the worker sent the "sign-in paused" email.
- **Database restart.** The API answered again within about 1 s. Live streams reconnected and carried the next change. The worker exits when its lock connection drops; ECS (here `--restart on-failure`) starts a fresh one, and its heartbeat came back in `/readyz`.
- **Stopping cleanly.** On SIGTERM, the worker and API exit 0 in under a second (they used to sit out the full stop timeout before being killed).
- **Zero-downtime rolling restart.** Both API tasks were replaced one at a time while 6 parallel clients sent signed-in and public requests for 60 s: 5,246 answers, **0 failures**. The 429s were the per-address limit, because every client came from one address. The live stream on a replaced task was ended and reopened on the other task.
- **New version prompt.** The web build in `/version.json` and the API's `X-FH-Version` agreed. After the web was redeployed with a new tag and the API rolled to the same `RELEASE`, an open page showed "A new version is ready".
- **Start-up refusals.** Each of the following made the process refuse to start, and the exit code is now 1:
  - `JWT_SECRET` missing;
  - a short `METRICS_TOKEN`;
  - `sslmode=require`;
  - `verify-full` without `sslrootcert`;
  - a plain `LISTEN_DATABASE_URL`;
  - `AWS_REGION=us-east-1`;
  - `KMS_REPLICA_REGION=us-west-2`;
  - no `KMS_KEY_ARN`;
  - the owner used as the app role;
  - the wrong CA.
- **Owner scripts.** `tenant:purge` (dry run) and `platform:admin` ran with the migration task's `DB_*` settings.

**What broke, and the fixes** (each with a test where one fits):

1. **Nothing worked for organizations on RDS.** `FORCE ROW LEVEL SECURITY` also binds the table owner when it isn't a superuser. Every `SECURITY DEFINER` function therefore returned no rows: the organization lookup at sign-in, the worker's list of organizations (no email was ever sent), the outbox backlog in `/readyz`, and API keys. `tenant:purge` saw nothing either. `db/rls.sql` now gives the owner an `owner_all` policy, which gives it nothing new because it can switch RLS off anyway (`rls-coverage.test.ts`).
2. **Every organization page said "We couldn't find this organization".** Two causes:
   - The web server calls the API itself for branding and job postings, and the task had no `API_URL`. It now has one: `api.<name>.internal` through Cloud Map, with a security-group rule from app to app on port 4000.
   - The production API ignores `x-tenant-subdomain`. The web now sends the organization's host as `X-Forwarded-Host` (`tenant.test.ts`, and a `terraform test` assertion).
3. **`alias/flexcity-trust` didn't exist.** Trust evidence is sealed under that alias, but Terraform never created it. `kms.tf` now creates it in both regions.
4. **Messaging refusals answered 500 in production builds only.** `tsc` put the class fields before a `super()` that sits inside an `if`, and the dev and test runner (esbuild) didn't. Fixed, and `buildSafety.test.ts` now looks for that pattern.
5. **SIGTERM was ignored, so deployments and scale-ins cut requests and jobs at the stop timeout.**
   - The API now drains its requests, ends its live streams and exits (`lib/shutdown.ts`).
   - The worker finishes its running jobs, then exits.
   - The web image runs `next` directly rather than through `npx`.
6. **A refused start-up exited with code 0**, so it didn't count as a failure. It now exits with 1.
7. **`platform:admin` and `tenant:purge` needed `DATABASE_URL`.** The task only has the `DB_*` parts, so they now use `owner-url.mjs`.
8. **Trust alert emails linked to `http://localhost:3000`.** They now link to the Dev console's address, taken from `PUBLIC_APP_URL`.

**Only verifiable on AWS:**
- **Rehearsal stand-ins.**
  - RDS's own master user. If it has more rights than the stand-in, the owner policy is still harmless.
  - Multi-AZ failover timing.
  - The RDS CA bundle checksum and certificate host names.
  - Multi-region KMS keys and `ReplicateKey`, which local-kms lacks, so the rehearsal ran without `KMS_REPLICA_REGION`.
  - IAM and KMS key policies.
  - The ALB's real deregistration, health checks and `drop_invalid_header_fields`.
- **AWS services the rehearsal didn't touch.**
  - WAF rules.
  - Cloud Map DNS from Fargate.
  - Secrets Manager injection.
  - CloudWatch alarms.
  - S3 and cross-region copies.
  - CloudFront.

**Fixed since the rehearsal:**
- **Passkey set-up is kept after a refresh.** Setting up a first passkey gave the second factor to that page's access token only, because the refresh cookie is scoped to `/api/auth`. The web now sends it to `POST /api/auth/passkeys`, which marks the session; a refresh racing the second factor no longer drops it either (test/integration/secondFactorSession.test.ts).

**Open before launch:**
- **No email provider.** Production uses the console mailer, which marks invitations, resets and lockout emails as sent while their contents go nowhere. A real provider is a launch blocker (see "Open choices").
- **The API's per-address limit is per process.** With two tasks it allows about twice the configured rate. The WAF limit is the fleet-wide one.
