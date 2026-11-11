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

- **Compute:** containers on ECS Fargate for the API, the worker and the web app, spread across the three zones, behind an Application Load Balancer that checks `/readyz`.
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
  - Route 53 health-checked failover
  - Recovery targets (RPO/RTO) and a tested restore runbook come with the high-availability task.
- **Infrastructure as code:** Terraform, so environments (staging, production) are reproducible and reviewed like code.

## Open choices for the owner

- Budget and expected size at launch (drives instance sizes and whether a read replica is needed on day one).
- Email provider (Amazon SES in `ca-central-1` is the natural fit) and error-tracking vendor (must be hosted in Canada; see `docs/SUBPROCESSORS.md`).
- Whether CloudFront's global edge caching of public files is acceptable to customers that require strict in-Canada processing. If not, serve directly from the Montreal load balancer.

AWS (Amazon Web Services Canada) is to be added to `docs/SUBPROCESSORS.md` as the hosting provider when the infrastructure is set up.
