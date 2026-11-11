# Scalability and load tests

How FH behaves with one small city and with 30 large ones at once, and how to size a deployment. Measured on 10 November 2026.

## What was tested

`apps/api/test/load/seed.ts` seeds a separate database (`flexcity_load`) with:

- **Small:** 1 city, 30 workers.
- **Big:** 30 cities, 300 workers each (9,000 workers).

Each city has facilities, positions, two weeks of shifts, punches, open shifts and payroll set-up. `apps/api/test/load/run.ts` then plays five scenarios against a running API, with at most 200 requests in flight:

1. **Shift change.** Every worker opens Today (four reads) and clocks in and out, all at once. This is far harsher than real life, where a shift change is spread over minutes.
2. **Browsing.** Supervisors open the week's schedule and punch review; workers open the shift board.
3. **Claim race.** Ten workers try to take the same open shift at the same moment, in ten cities.
4. **Payroll day.** Every city builds a two-week, city-wide pay run at the same moment.
5. **Realistic shift change.** 30 workers a second for a minute.

The machine had 4 cores, with the load generator, the API and Postgres 16 all on it. A production deployment, with the database on its own server, will do better.

## Results

### One city, 30 workers

Everything stays under half a second. The first reads after a restart take 0.4 s while the process warms up; after that, reads take 4–12 ms and a city-wide pay run for 30 people takes 0.15 s. No errors.

### 30 cities × 300 workers (plus the small city: 9,030 workers)

| Scenario | One API process | Three API processes (`WEB_CONCURRENCY=3`) |
| --- | --- | --- |
| 1. All 9,030 workers at once: 54,180 requests | 126 s, 429 req/s; reads p50 1.6 s, p99 3.0 s; clock in p50 0.5 s | 98 s, 553 req/s; reads p50 0.95 s, p99 2.7 s; clock in p50 0.4 s |
| 2. Browsing | shift board p50 1.8 s | shift board p50 0.9 s |
| 3. Claim race | exactly one claim per shift, no wrong assignment | same |
| 4. 31 pay runs at once | all 31 built, 9,030 statements, slowest 14.9 s | all 31 built, slowest 8.2 s |
| 5. 30 workers a second | p50 10–25 ms, p99 under 50 ms | p50 8–21 ms, p99 under 40 ms |
| Errors | **0** | **0** |

**Re-run with two processes after the event outbox and LISTEN changes (11 November 2026, `WEB_CONCURRENCY=2`).** Same seed and scenarios, but on a busier machine: the shared development API and web server were also running, right after a container restart (load average 9.7 on 4 cores), so compare it with the table above only loosely.

| Scenario | Two API processes |
| --- | --- |
| 1. All 9,030 workers at once | 168 s, 323 req/s; reads p50 1.9 s, p99 4.8 s; clock in p50 0.67 s |
| 2. Browsing | shift board p50 2.6 s; week schedule p50 1.4 s |
| 3. Claim race | exactly one claim per shift (10 for 10), no wrong assignment |
| 4. 31 pay runs at once | all 31 built, 9,030 statements, slowest 22.8 s |
| 5. 30 workers a second | p50 27–54 ms, p99 240–300 ms |
| Errors | **0** |

**Before and after sharing cache loads (11 November 2026, `WEB_CONCURRENCY=2`, the 30 large cities, 9,000 workers).** Both runs had response compression and metrics on, with slow queries logged from 200 ms, on a quieter machine than the run above. The only change between them was single-flight loading of the access checks (`lib/singleFlight.ts`). Before it, a phone's four simultaneous requests each missed the cache and ran the same lookups.

| Scenario | Before | After |
| --- | --- | --- |
| 1. All 9,000 workers at once | 145 s, 371 req/s; reads p50 1.6 s, p95 2.8 s; clock in p50 0.57 s | 92 s, 585 req/s; reads p50 1.0 s, p95 1.6 s; clock in p50 0.38 s |
| 2. Browsing | shift board p50 1.8 s; week schedule p50 1.4 s | shift board p50 1.4 s; week schedule p50 0.9 s |
| 3. Claim race | 10 for 10, no wrong assignment | same |
| 4. 30 pay runs at once | all built, slowest 9.2 s | all built, slowest 8.5 s |
| 5. 30 workers a second | p50 11–27 ms, p99 under 55 ms | p50 9–25 ms, p99 under 55 ms |
| Queries over 200 ms | 149 | 72 |
| Errors | **0** | **0** |

The remaining slow queries happen only during the all-at-once bursts: commits, punch inserts, and the access lookups queueing for the 4 shared cores. Every one of those lookups uses an index. None appeared in the steady scenario 5.

Every claim's events went through the outbox and were delivered on the first try by the process that took the claim (10 events, 10 notifications with dedupe keys, none left pending).

Scenario 5 is closest to a real day: even 9,000 workers arriving at a steady pace feel instant. Scenario 1 is a stress test. It shows the system queues work rather than failing: every request was answered, just slower.

## What was changed to get here

The first run, before the fixes below, failed many requests in scenarios 1 and 4.

- **Connection pool:**
  - each process opens `DB_POOL_SIZE` connections (default 25, up from Prisma's default of 9);
  - a request waits up to `DB_POOL_TIMEOUT_S` (20 s) for one, instead of 2 s.
- **Pay runs, provider sends and exports** run in a transaction with a 120 s limit (`payrollTx`), not the 15 s limit other requests get.
- **Worker processes:** `WEB_CONCURRENCY` starts that many API processes on one port. Processes share nothing in memory (see [ARCHITECTURE.md](ARCHITECTURE.md#process-model)):
  - live notifications reach every process through one Postgres `LISTEN` connection each;
  - domain events go through a transactional outbox (`EventOutbox`) that any process or the worker may deliver;
  - caches are dropped in every process through `pg_notify`;
  - rate limits are counted in Postgres;
  - scheduled jobs run only in the worker, each under an advisory lock.
- **Background traffic that grows with use:** webhook deliveries are claimed by the worker with `FOR UPDATE SKIP LOCKED` and sent outside any transaction (10 s timeout each), so several workers can share them; public API keys are rate-limited per key in Postgres (120 a minute by default). The weather is fetched once per distinct forecast site every 3 hours and shared by every city near it, so it grows with the number of sites, not cities. None of these was part of the load runs above.
- **Lighter shift board:** it selects only the fields it shows, at most 200 rows.
- **Index** on punches by `(tenantId, status, clockIn)` for punch review.

## Sizing a deployment

| Organizations | Suggested |
| --- | --- |
| Up to ~10 cities, or a few thousand staff | One API instance, `WEB_CONCURRENCY` = its cores, managed Postgres with 2 vCPU |
| 30 cities × 300 staff (this test) | Two API instances with 2–4 cores each, behind a load balancer; Postgres with 4 vCPU and 16 GB |
| More | Add API instances; put PgBouncer (transaction mode) in front of Postgres; a read replica for reports (`READ_REPLICA_URL`) |

**Connections:** each API process holds up to `DB_POOL_SIZE` connections plus one `LISTEN` connection. The worker (`npm run worker`) holds its own pool plus its advisory-lock connection. The `LISTEN` and lock connections must reach Postgres directly (`LISTEN_DATABASE_URL`, default `APP_DATABASE_URL`), or PgBouncer in session mode: transaction pooling loses `LISTEN` subscriptions and session locks. Request traffic can go through PgBouncer in transaction mode. Keep

  instances × `WEB_CONCURRENCY` × (`DB_POOL_SIZE` + 1) + worker

below Postgres's `max_connections` (100 by default) with room for administration. For example, 2 instances × 3 processes × 26 = 156 needs either `max_connections` of 200 or PgBouncer.

**Row-level security** adds little: every query already filters by city, and every large table's indexes start with the city.

**Pay runs** are the heaviest request. A 300-person city-wide run took 7–15 s in the first load runs and 8.5 s in the latest, with 30 others running at the same time. Cities pay on different days in practice. Very large cities can run by department.

## Database growth, replicas, caching and sharding

**How fast the data grows.** Measured in the load database, including indexes: a shift takes about 330 bytes and a punch about 475 bytes. A worker with five shifts a week adds about 260 of each a year, roughly 210 KB. So 100,000 workers add about 21 GB a year of shifts and punches. Everything else is small next to that or is pruned by the retention job (`services/privacy/retention.ts`): notifications, the email and text logs, delivered events, webhook records, sign-in sessions. A single RDS PostgreSQL instance, scaled up as needed, holds many years of this.

**Read replica.** With `READ_REPLICA_URL` set (an RDS read replica, connected as the app role), running reports reads from the replica, so a month-long report never competes with clock-ins. Those reads run in a read-only transaction with the same row-level security. Without a replica they run read-only on the primary. A replica can be a few seconds behind, so only reads that tolerate that move there. Anything a person has just changed is read from the primary. CSV exports read on the replica and record the export in the audit log on the primary.

**Caching.** Each API process caches, for 30 seconds:
- an organization's settings (features, role overrides, billing state);
- a person's custom roles, managed departments, and whether they're still active.

Changes clear these caches in every process through `pg_notify` (`lib/cacheBus.ts`). Requests that miss the cache at the same moment share one load (`lib/singleFlight.ts`); without this, a phone opening Today would repeat the same lookups once per request. A shared cache server (ElastiCache/Redis) isn't needed at this size. It would add a network hop, a second copy of personal information to secure, and one more thing to fail over. Reconsider it if the database's CPU is mostly spent on these lookups.

**Connection pooling.** See *Connections* above. With PgBouncer in transaction mode, add `pgbouncer=true` to the Prisma connection URL (it turns off prepared statements, which transaction pooling can't carry). The tenant setting is transaction-local (`set_config(…, true)`) and locks are transaction-level (`pg_advisory_xact_lock`), so both work through transaction pooling. `LISTEN` and the worker's session lock don't, which is why they connect directly.

**Partitioning (later).** The audit log is kept for the life of an account, and shifts and punches grow forever. When one of them passes roughly 50–100 million rows, or its index maintenance shows in the slow-query log, convert it to monthly range partitions with a SQL migration. Old months can then be detached and archived to S3 in Canada once an organization's retention allows. Postgres needs the partition column in every unique index, so `TimePunch`'s `(tenantId, clientInId)` and `(tenantId, clientOutId)` keys would have to include `clockIn` first. Plan that change before partitioning punches.

**Sharding plan (when one database is no longer enough).** Every organization's data carries its `tenantId`, and row-level security already isolates organizations, so the natural shard is a whole organization:

1. A small control database keeps what is shared: the list of organizations and which database cluster each lives in, the Dev console, billing and the trust center.
2. Each cluster (an RDS primary with its replica, in `ca-central-1`) holds a set of whole organizations. No request ever needs two clusters, because no screen joins data across organizations.
3. The API picks the cluster from the organization (already resolved from the subdomain or token) and keeps one connection pool per cluster.
4. Anonymous benchmarks are computed per cluster and combined from the aggregates; no personal row leaves its cluster.
5. Moving an organization between clusters: copy its rows to the target during a short read-only window, then switch its entry in the control database. The full export offboarding produces (`services/platform/cityExport.ts`) is a starting point. A matching import tool doesn't exist yet and would be written then.

The trigger to start: the largest sensible RDS instance class staying above about 60% CPU or write I/O at peak after the replica takes the reports, or a large customer contractually needing its own database. Until then a bigger instance is cheaper and simpler.

## Network and data transfer

- **Compression.** The API gzips or brotli-compresses answers over 1 KB when the browser accepts it (`compression` in `apps/api/src/app.ts`). Measured on the load data, 200 shifts as JSON go from 60 KB to 7 KB with gzip. The live notification stream (`text/event-stream`) is never compressed, because compression would hold events back until a buffer fills; a test checks this. The web app's pages and scripts are compressed by Next.js.
- **Caching in the browser.** The web app's `/_next/static` files have content-hashed names and are cached for a year (`immutable`). App icons are cached for a day; the service worker is always revalidated, so fixes reach installed phones on the next visit. API answers carry personal information and are marked `no-store`.
- **Trimmed payloads.** Lists select only the fields their screens show and are capped (the shift board at 200 rows); long lists page with `before` cursors (notifications, the deck logbook).
- **CDN.** The marketing site is static and served by CloudFront from S3 in Montreal (`ops/terraform/edge.tf`). The app itself is served from the Montreal load balancer only: its pages and API answers hold personal information and are never cached at CloudFront's edge, which may be outside Canada. If the app's static scripts ever need an edge cache, only `/_next/static/*` (no personal information) could move behind CloudFront, after confirming customers accept it (INFRASTRUCTURE.md, open choices).
- **Inside AWS.** Containers reach S3 through a VPC gateway endpoint (no NAT charges), and the database sits in subnets with no route out.

## What people feel when it's busy

### Latency budgets

These are what the load runs above measured on a 4-core test machine with two API processes. Production, with the database on its own server and autoscaling, should do better.

| Action | Budget | Measured, steady arrivals (scenario 5) | Measured, everyone at once (scenario 1) |
| --- | --- | --- | --- |
| Clock in or out | 0.5 s | — | p50 0.38 s, p95 0.9 s |
| Open Today (me, shifts, notifications) | 1 s | p95 17–29 ms | p50 1.0 s, p95 1.6 s |
| Shift board | 1 s | p95 40 ms | p50 1.4 s (scenario 2) |
| Claim an open shift | 1 s | — | p95 75 ms, exactly one taker per shift |
| City-wide pay run (300 people) | 30 s | — | 8.5 s with 30 cities running at once |

### The spikes a city has, and what happens

- **Shift change** (everyone clocks in within minutes): the burst in scenario 1. Requests queue rather than fail; access checks that miss the cache together share one load. The API scales out on CPU (60%) and on requests per task (3,000 a minute).
- **Shift-board rush** (an attractive shift posted to hundreds of people): one claim wins: claims on the same shift take turns under a lock. Everyone else gets "already claimed" at once instead of waiting (scenario 3).
- **Storm call-outs** (a snowstorm, many workers called at once): texts and calls go through the outbox. Safety and call-out texts are sent straight after the request commits (`services/notifications/urgent.ts`), and the worker is the backstop; the *Safety texts late* alert pages if any wait more than 2 minutes. This hasn't been load-tested: the text provider's own sending rate is the likely limit, and it should be confirmed with the provider before winter.
- **Payroll day**: each pay run gets its own long time limit (120 s). Cities run on different days in practice; 30 at once still finished in 8.5 s.

### What the person sees

- **Reads ride out a blip.** When the API is overloaded it answers `503 BUSY` with `Retry-After: 2`; the load balancer answers 502/503/504 during a deployment or a database failover. The app retries a read twice, with jitter, before showing anything (`apps/web/src/lib/retry.ts`). Changes are never repeated automatically.
- **Punches never wait on the network.** With no connection, a punch is queued on the phone and sent when it's back (`lib/offlinePunches.ts`).
- **Clear words when it fails.** "The service is very busy right now. Try again in a moment." / « Le service est très sollicité en ce moment. Réessayez dans un instant. », not a generic error.
- **Live updates come back on their own.** The notification stream reconnects with jitter, so a deployment doesn't bring every phone back in the same second, and it refetches once after reconnecting, so nothing sent in between is missed.
- **The firewall doesn't block a city hall.** The per-address limit is 20,000 requests in 5 minutes, because a whole building can share one address at a shift change. The API's own limits (sign-in, kiosk PINs, public API keys) are the fine-grained ones.

## Running the tests again

Seed once:

```bash
DATABASE_URL=postgresql://postgres@localhost:5432/flexcity_load npx tsx test/load/seed.ts --cities 30 --workers 300
```

From `apps/api`, start an API against that database on port 4200, with its own `JWT_SECRET` (the load run mints its tokens with it, so sign-in limits don't shape the numbers):

```bash
DATABASE_URL=postgresql://postgres@localhost:5432/flexcity_load APP_DATABASE_URL=postgresql://flexcity_app:change-me@localhost:5432/flexcity_load JWT_SECRET=… PORT=4200 WEB_CONCURRENCY=3 node --import tsx src/server.ts
```

Then run:

```bash
JWT_SECRET=… DATABASE_URL=postgresql://postgres@localhost:5432/flexcity_load npx tsx test/load/run.ts --scale all
```

`--scale small` or `--scale big` runs one size only.

To try several processes locally without the cluster module, start two servers on different ports against the same database (`PORT=4200 …` and `PORT=4201 …`): notifications, events and cache invalidation reach both through Postgres. The seed writes the generated sign-ins to `test/load/plan.json`, which is git-ignored.
