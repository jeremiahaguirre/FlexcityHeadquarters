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

1. Search the logs for `[slow-query]`; each line has the request id of the request that ran it.
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

### Memory high

*Ticket.* An API process has used more than 1.5 GB for 15 minutes.

1. Compare with traffic: a steady climb with flat traffic suggests a leak, so capture a heap snapshot from a staging copy.
2. Restart the task to recover, then investigate.

## Load testing

The load test (`apps/api/test/load/run.ts`, results in [SCALABILITY.md](SCALABILITY.md)) runs against the `flexcity_load` database with 31 organizations and 9,030 workers. Run it before major releases and after performance changes, with metrics on, and compare the dashboard's p95, slow-query count and event-loop delay with the last recorded run.
