# High availability and disaster recovery

How FlexcityHeadquarters keeps running when part of AWS fails, and how it is rebuilt when a whole region is lost. The infrastructure is in [`ops/terraform`](../ops/terraform/README.md); the regions are explained in [INFRASTRUCTURE.md](INFRASTRUCTURE.md). Every copy stays in Canada: Montreal (`ca-central-1`) is the primary and Calgary (`ca-west-1`) holds the recovery copies.

## Targets

These are internal targets, to be confirmed by the drills below. They are not customer commitments: customer service levels are only what an order form says.

| What fails | What happens | Data loss (RPO) | Back in service (RTO) |
| --- | --- | --- | --- |
| One container or server | ECS replaces the task; the load balancer stops sending it traffic after three failed health checks (45 s) | None | Under a minute |
| One Availability Zone | The other zones' tasks carry on and ECS starts replacements there. The database fails over to its standby in another zone, typically in 60–120 seconds (AWS's figure) | None (synchronous standby) | About 2 minutes |
| A bad deployment | The ECS circuit breaker rolls back a deployment whose tasks don't become healthy; otherwise redeploy the previous image tag | None | Minutes |
| Data damaged by a mistake or a bug | Restore a copy of the database to just before the damage and copy back the affected rows (runbook C) | Back to any second within 35 days | Hours, depending on the repair |
| The whole Montreal region | Rebuild in Calgary from the copies (runbook D) | Target 15 minutes | Target 4 hours |

## What is copied where

| Data | In Montreal | Copied to Calgary |
| --- | --- | --- |
| Database | RDS Multi-AZ: a synchronous standby in a second zone; 35 days of point-in-time recovery | Automated backups and transaction logs, copied continuously, kept 14 days, encrypted with a Calgary key |
| Organizations' encryption keys | KMS multi-region key per organization (created on first use) | A replica of each key with the same alias, so restored records can still be opened |
| Platform key | KMS multi-region key | Replica, `alias/flexcity-platform` |
| App secret (database URLs, JWT secret, provider keys) | Secrets Manager | Replica (read-only until promoted) |
| Container images | ECR | Copied on every push |
| Backups bucket (dumps, archives) | S3, versioned, object-locked 35 days | Replicated, versioned, object-locked |
| Marketing site | S3 + CloudFront | Rebuilt from the repository (no customer data) |
| Infrastructure | Terraform state in S3 | The repository, plus the state bucket (create it with replication to Calgary) |

Nothing is written outside Canada, and the recovery copies are encrypted with keys created in Calgary.

## Runbooks

### A. A zone fails

Nothing to do by hand. Confirm on the dashboard and in the RDS events that:
- the database failed over;
- the services are back at their task counts;
- the outbox backlogs drain (docs/MONITORING.md).

Open connections drop during the database failover. Requests in flight get an error, and phones retry. Offline punches are queued on the phone and sent later.

### B. A deployment goes wrong

If the circuit breaker didn't roll it back, apply again with the previous `image_tag`. For that to be safe, migrations follow one rule: a release only adds to the schema (new tables, new columns, new indexes), so the previous version still runs on it. Removing or renaming something takes two releases: first stop using it, then remove it.

### C. Data damaged by a mistake or a bug

1. Note the time just before the damage (the audit log usually shows it).
2. Restore a **new** instance to that time; never restore over the live database:
   ```bash
   aws rds restore-db-instance-to-point-in-time --source-db-instance-identifier fh-production \
     --target-db-instance-identifier fh-production-restore-<date> --restore-time <UTC time> \
     --db-subnet-group-name fh-production --vpc-security-group-ids <db security group> --no-publicly-accessible
   ```
3. Compare the affected organization's rows and copy back what was lost, with the owner connection, under the organization's tenant id. Record what was restored in the audit log.
4. Delete the restored instance when done.

### D. The Montreal region is lost

The decision to fail over is made by the on-call lead once AWS confirms a regional problem expected to last longer than the recovery itself (about 4 hours). Tell customers that service is moving and that changes made in the last few minutes before the outage may need to be re-entered.

1. **Find the copies.**
   ```bash
   aws rds describe-db-instance-automated-backups --region ca-west-1 --db-instance-identifier fh-production
   aws kms describe-key --region ca-west-1 --key-id alias/flexcity-platform
   ```
   Note the backups' `DBInstanceAutomatedBackupsArn` and the platform key's ARN.
2. **Promote the secret's copy**, then update its database URLs to the new endpoint after step 4:
   ```bash
   aws secretsmanager stop-replication-to-replica --region ca-west-1 --secret-id fh-production/app
   ```
3. **Terraform state.** Use the state bucket's Calgary copy, in a new workspace for the recovery stack.
4. **Rebuild in Calgary.** Run `terraform apply` with the production values plus:
   ```hcl
   region                    = "ca-west-1"
   dr_region                 = "ca-central-1"
   recovery_mode             = true
   restore_from_backup_arn   = "<from step 1>"
   existing_platform_key_arn = "<from step 1>"
   certificate_arn           = "<an ACM certificate in ca-west-1>"
   ```
   `recovery_mode` creates nothing in Montreal and uses the copies of the images, the secret and the platform key. It also restores the database to its latest restorable time. Request the Calgary certificate ahead of time, so this step doesn't wait on validation.
5. **Secret URLs.** Point `DATABASE_URL`, `APP_DATABASE_URL` and `LISTEN_DATABASE_URL` at the restored endpoint. The restored database keeps its roles and passwords. Then force a new deployment of the services.
6. **DNS.** Point `<root_domain>` and `*.<root_domain>` at the Calgary load balancer.
7. **Check.**
   - `/readyz` is answering through the load balancer.
   - A test organization can sign in and open a sealed record (an incident narrative), which proves the key replicas work.
   - The worker is reporting in, and texts are going out.
8. **While running in Calgary,** avoid creating new organizations. Their keys would exist only in Calgary (the app makes new keys single-region in recovery mode), and their sealed records would need re-sealing after the return.

### E. Returning to Montreal

When Montreal is healthy again:
1. Plan a short maintenance window.
2. Set up automated-backup replication from the Calgary database to Montreal, or take a snapshot and copy it to Montreal.
3. Restore it in Montreal with the normal (non-recovery) configuration.
4. Point the secret and DNS back, and remove the recovery stack.

Organizations created in Calgary need their sealed records re-sealed under new multi-region keys; that one-off tool will be written if it is ever needed.

## Drills

| Drill | How often | Pass when |
| --- | --- | --- |
| Restore a point-in-time copy (runbook C, steps 1–2) and run the app's integration tests against it | Every quarter | Restored within 1 hour, every test passes |
| Database failover (`aws rds reboot-db-instance --force-failover`) in staging under the load test | Every 6 months | Service back within 2 minutes, no errors after reconnecting |
| Full region recovery (runbook D) in staging | Every year | Back in service within 4 hours; a sealed record opens in Calgary |

Record each drill's date, duration and problems found here, and fix the runbook when a step was wrong.

| Date | Drill | Result |
| --- | --- | --- |
| — | Not run yet (the infrastructure isn't built) | — |
