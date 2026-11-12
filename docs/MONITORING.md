# Monitoring, alerts and runbook

How FlexcityHeadquarters is watched in production, what each alert means, and what to do when one fires.

The pieces:

| Piece | Where |
|---|---|
| Metrics endpoint | `GET /metrics` on every API process, Prometheus text format, behind `Authorization: Bearer <METRICS_TOKEN>` (404 when the token isn't set) |
| Health checks | `GET /healthz` (process alive) and `GET /readyz` (database, outbox, worker; `?strict=1` also fails on warnings). See [ARCHITECTURE.md](ARCHITECTURE.md#health-metrics-and-errors) |
| Alert rules | [`ops/monitoring/alerts.yml`](../ops/monitoring/alerts.yml), Prometheus format |
| Dashboard | [`ops/monitoring/dashboard.json`](../ops/monitoring/dashboard.json), Grafana |
| Error reports | Sentry-compatible service when `SENTRY_DSN` is set (to be chosen, Canadian-hosted; see [SUBPROCESSORS.md](SUBPROCESSORS.md)) |
| Slow queries | Logged as `[slow-query] <ms> ms: <SQL with placeholders>` (the column list shortened to `SELECT …`) and counted in `fh_db_slow_queries_total` (`SLOW_QUERY_MS`, default 500; 0 turns it off). Parameter values are never logged. |

A unit test (`apps/api/test/unit/alertRules.test.ts`) fails if an alert names a metric the API doesn't export, or links to a section of this page that doesn't exist.

## Collecting the metrics on AWS

The target is AWS `ca-central-1` ([INFRASTRUCTURE.md](INFRASTRUCTURE.md)). Two equivalent ways to scrape `/metrics`; pick one when the infrastructure is built:

- **Amazon Managed Service for Prometheus + Amazon Managed Grafana.** Run the AWS Distro for OpenTelemetry collector as a sidecar in each ECS task, scraping `localhost:<port>/metrics` with the bearer token from Secrets Manager. Load `alerts.yml` as a rule group and send alerts to Amazon SNS (email and the on-call phone).
- **CloudWatch.** The CloudWatch agent's Prometheus scraping sends the same metrics to CloudWatch; the alert thresholds below translate one-for-one to CloudWatch alarms.

Either way, give the scrape job the name `fh-api` (the `ApiDown` rule uses it), and keep metrics in `ca-central-1`. Metrics carry no personal information: labels are route patterns (never URLs or ids), status classes and outcomes.

Each API process exposes its own numbers. With `WEB_CONCURRENCY` above 1, scrape each process, or run one process per container (the plan on ECS Fargate) so one scrape covers one process.

### Blocked crawlers and bots (web firewall)

Crawler blocks happen in AWS WAF, before the API, so they are not in `/metrics`. Each firewall rule has its own CloudWatch metric (namespace `AWS/WAFV2`, metric `BlockedRequests`, dimension `Rule`): on the app's firewall (`fh-<env>`, region `ca-central-1`) `ai-crawlers`, `no-user-agent`, `rate-per-address` and, when turned on, `bot-control`; on the website's (`fh-<env>-<region>-site`, CloudFront, shown in `us-east-1` with `Region=Global`) `site-ai-crawlers` and `site-rate-per-address`. The WAF console's overview shows the same counts, and sampled requests show the user agents. No alert is needed for crawler blocks; a sudden jump in `rate-per-address` is worth a look. On Vercel, see the project's Firewall tab.

## Service targets

Starting targets for the first months, to be adjusted with real traffic:

| What | Target |
|---|---|
| Safety texts and calls (working alone, call-outs) | queued to sent within 2 minutes, every time |
| API availability | 99.5% of minutes with `/readyz` answering 200, measured monthly (an internal goal, not a customer commitment) |
| Response time | 95% of requests under 1 s; clock-in under 500 ms |
| Server errors | under 1% of requests |
| Emails, texts and events | sent within 15 minutes |

These are internal goals, not promises to customers. Customer service levels are only what an order form says.

## Runbook

Every alert links to a section here. **Page** means someone is woken up; **ticket** means it is looked at the next working day.

### Safety texts late

*Page.* A working-alone escalation, help request or call-out text has waited more than 2 minutes.

1. Check `/readyz` for the `sms_safety` channel and the worker heartbeat.
2. Check the text provider (Twilio status page) and the API logs for `sms` errors; `fh_sms_sends_total{outcome="retry"}` rising means the provider is refusing.
3. If texts can't go out, tell the affected organizations' supervisors by phone that working-alone escalations may not reach them, until fixed.
4. Once fixed, the queued texts send on their own; confirm the backlog drains to zero.

### API down

*Page.* A scrape of an API process failed for 2 minutes.

1. Check the load balancer's target health and the ECS service events.
2. Read the process's last logs (crash, out of memory, failed start-up check such as a missing secret or a non-Canadian region).
3. Restart or roll back the last deployment.

### Database unreachable

*Page.* The API can't query PostgreSQL.

1. Check the RDS instance status and recent events (failover, storage full, maintenance).
2. Check connection counts against the pool size (`DB_POOL_SIZE` × processes).
3. After a Multi-AZ failover the API reconnects by itself; if not, restart the API tasks.

### Worker missing

*Page.* The background worker is not connected, or its heartbeat is older than 5 minutes. Texts, emails, reminders, payroll jobs and webhook deliveries stop.

1. Check the worker service in ECS and its logs.
2. Restart it. Jobs are guarded by advisory locks, so starting a second worker is safe.
3. Confirm the outbox backlogs drain.

### High error rate

*Page.* More than 2% of requests answered with a server error for 10 minutes.

1. Look at the error reports (Sentry-compatible service) and logs; each error carries a request id.
2. Use the dashboard's "Errors by route" panel to find the route.
3. Roll back the latest deployment if it started with it.

### Slow requests

*Ticket.* The 95th-percentile response time has been over 1 s for 15 minutes (live notification streams are excluded).

1. Find the slow routes on the dashboard ("p95 by route").
2. Check slow queries and the event loop for the same window.
3. Check CPU and memory of the API tasks; scale out if they're saturated.

### Slow queries

*Ticket.* More than 20 queries took longer than `SLOW_QUERY_MS` in 15 minutes.

1. Search the logs for `[slow-query]`. These lines carry no request id (Prisma reports query timings outside the request), so match them by time with the slow routes on the dashboard ("p95 by route") and with request log lines from the same process.
2. Run `EXPLAIN (ANALYZE, BUFFERS)` on the query (with representative values, in a copy of the data, never with real personal information pasted into tools).
3. Add an index or change the query; record the fix in the commit.

### Event loop blocked

*Ticket.* A process's event loop is often blocked for more than 200 ms, so every request on it waits.

1. Usually a large synchronous job: a big export, PDF or report, or the scheduling assistant on a long horizon.
2. Find the route from the dashboard and logs at the same time, and move that work to the worker or split it.

### Outbox backlog

*Ticket.* Emails, texts or domain events have waited more than 15 minutes, or some gave up after all retries.

1. Check the worker (see [Worker missing](#worker-missing)).
2. For failures, read the last error recorded on the failed rows; fix the cause (provider credentials, a bad address).
3. Dead events can be retried by setting their status back to `PENDING` (see ARCHITECTURE.md, events).

### Webhooks failing

*Ticket.* Many webhook deliveries to customers' own systems failed in the last hour.

1. Check which endpoints fail (Dev console, city's Integrations usage, or the delivery records).
2. Usually the customer's endpoint is down or rejecting the signature; endpoints that keep failing are turned off automatically and the organization's admins are told.
3. Contact the customer's IT if it's one organization; investigate our side if it's many.

### Sign-in failures spike

*Ticket.* Organization sign-ins are failing at more than 30 a minute for 10 minutes (`fh_auth_failures_total`), usually password guessing or credential stuffing.

1. Break it down by `reason`: `invalid` rising alone is guessing; `blocked_ip` and `rate_limited` mean the defences are already refusing it.
2. Look in the load-balancer and WAF logs for the addresses and user agents; if a few addresses or one network carry most of it, add them to a WAF block rule (ops/terraform, by the infrastructure owner).
3. Check `auth.account_locked` and `auth.ip_blocked` in the affected organizations' audit logs; if real people are locked out (an office behind one address), tell their HR that a password reset gets them in at once.

### Account lockouts

*Ticket.* More than 10 accounts locked in 15 minutes (`fh_auth_lockouts_total`): a distributed attack on known emails.

1. Find the organizations (`auth.account_locked` in their audit logs) and whether the same accounts lock again (doubling locks).
2. Each person was emailed; tell the organizations' HR what is happening and that a reset or a passkey gets people in.
3. If one organization is targeted, consider asking it to require a second factor for everyone (Settings → Second sign-in factor).

### Credential stuffing

*Ticket.* An address was blocked after failing on 10 different accounts in 15 minutes (`fh_auth_ip_blocks_total{surface="org"}`).

1. The block lasts an hour and is recorded as `auth.ip_blocked` (with the address) in the organization's audit log.
2. Several blocks from one network or hosting provider: block it at the WAF.
3. A block of a customer's office address (many people mistyping at once is rare): confirm with the organization; it lifts by itself after an hour.

### Dev console sign-in attack

*Page.* An FH Dev console account locked, or an address failed on 3 Dev console emails (`surface="platform"`).

1. Check `PlatformAudit` (`auth.account_locked`, `auth.ip_blocked`) and ask the admin whether it was them.
2. If not: treat it as an attack on FH staff. Rotate that admin's password, confirm their passkeys, review recent `PlatformSession`s, and block the address at the WAF.

### Kiosk PIN locks

*Ticket.* Kiosk tablets paused more than 3 times in an hour after many wrong PINs (`fh_kiosk_pin_locks_total{scope="tablet"}`).

1. The organization's supervisors were told in-app; find the tablet in the audit log (`kiosk.tablet_locked`).
2. Someone may be walking through employee numbers: ask the organization to check the tablet's location and, if needed, revoke and re-pair it.

### API key guessing

*Ticket.* More than 200 public API requests with missing, unknown, revoked or expired keys in 15 minutes (`fh_api_key_auth_failures_total`).

1. Usually one customer's integration kept a revoked or expired key: find it by the `api.request` audit gaps and the load-balancer logs, and contact the organization.
2. Many addresses: guessing. Each address is already limited to 20 failures per 10 minutes; block the networks at the WAF.

### Rate limited

*Ticket.* The per-address limit is refusing more than 300 requests a minute for 10 minutes (`fh_rate_limited_total{layer=~"global_.*"}`).

1. `global_anon` is usually scraping or a flood on public pages; `global_failures` a client sending bad tokens in a loop (a broken integration or an attack).
2. If a legitimate customer is refused (a large office behind one address), raise `GLOBAL_RATE_LIMIT_AUTH` or `GLOBAL_RATE_LIMIT_ANON` for the API service and tell the owner.

### Memory high

*Ticket.* An API process has used more than 1.5 GB for 15 minutes.

1. Compare with traffic: a steady climb with flat traffic suggests a leak, so capture a heap snapshot from a staging copy.
2. Restart the task to recover, then investigate.

## Load testing

The load test (`apps/api/test/load/run.ts`, results in [SCALABILITY.md](SCALABILITY.md)) runs against the `flexcity_load` database with 31 organizations and 9,030 workers. Run it before major releases and after performance changes, with metrics on, and compare the dashboard's p95, slow-query count and event-loop delay with the last recorded run.
