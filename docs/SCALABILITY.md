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

## Team messaging and staff surveys (12 November 2026)

`apps/api/test/load/seed-comms.ts` adds to the load database: six departments in each of the 30 large cities (worker *i* in department *i* mod 6, about 50 each), birth dates for everyone (adults, so the rule of two leaves conversations open), and a separate organization, `loadpulse`, with 3,000 staff in twelve departments of 5 to 600 people. `apps/api/test/load/comms.ts` then plays:

- **M0. Set-up:** today's shifts (six crews of about 50 per city); each city's six department and six shift conversations opened by a member; a 200-person group made by HR; 400 sealed messages of history in every department conversation, for paging.
- **M1. Peak five minutes:** 10% of the 9,000 staff send 1 to 4 messages each in their shift or department conversation, 40% of them in the first minute (the shift change). Each opens the unread badge, the list and the thread, sends, and marks it read; one in ten pages back through the department's history; 2% of messages carry a 40 KB image, which the sender opens. Meanwhile 900 staff (every worker of three cities) hold the live stream open and react the way the web app does: a `messages` change refetches the badge; the 30% who have their department's conversation open also refetch the list and the thread, and mark it read when a new message shows up; a notification refetches the bell.
- **M2. Fan-out:** the 200 group members also open the stream (1,100 open on one process). HR sends 30 messages into the group, one every 2 s, first on a quiet system, then with background senders in other cities (5 a second). Measured from the start of each send to each member's stream receiving `event: change`.
- **S1–S3. Surveys:** HR sends an organization-wide pulse (eight questions, broken down by department) to the 3,000; 2,400 answers arrive at 10 a second (600 a minute; each person opens their surveys, then answers); HR closes it, opens the results alone and five at once, and downloads the CSV.

**How it was run.** One API process (`WEB_CONCURRENCY=1`) on port 4300 against `flexcity_load`, with `GLOBAL_RATE_LIMIT=off` (all the load comes from one address, 127.0.0.1, and the per-address limit of 1,200 credentialed requests a minute would otherwise measure itself), `RATE_LIMIT_STORE=database` (the per-person limits counted in Postgres, as in production: 30 messages a minute and 600 a day, 20 files an hour, 30 survey answers an hour; the scenarios stay under them, so they cost what they cost in production without refusing anyone), `SLOW_QUERY_MS=200` and metrics on (event-loop delay and memory scraped from `/metrics` every 2 s). Message keys are unwrapped by the local key provider, not KMS (see below). The machine is the same 4-core container, with the load generator, the API and Postgres on it, and it was **shared with other work**: load averages of 6 to 10 during the runs. Compare runs loosely; the differences below are large enough to stand anyway.

### Before and after

| | Before | After |
| --- | --- | --- |
| **M1. Peak five minutes** (≈920 senders, ≈2,300 messages, 900 streams) | 40,740 requests in 393 s | 29,116 requests in 339 s |
| Live `messages` signals received by the 900 streams | 23,241 | 12,064 |
| Send a message | p50 14.4 s, p95 34.5 s; **2,118 of 2,302 failed** (503 busy, 500) | p50 5.8 s, p95 19.2 s, p99 25.2 s; **0 failed** |
| Open the thread (newest 50) | p50 13.1 s, p95 42.8 s, 125 failed | p50 2.2 s, p95 7.6 s, 0 failed |
| Mark read | p50 10.4 s, 112 failed | p50 1.6 s, p95 11.2 s, 0 failed |
| Older page of history (`?before=`) | p50 14.3 s, 23 failed | p50 2.1 s, p95 8.6 s, 0 failed |
| Send with a 40 KB image / open it | 38 of 39 failed | p50 9.3 s / p50 2.2 s, 0 failed |
| Live refetches (badge, list, thread) | p50 ≈ 21 s, 4,818 failed | p50 4.7–5.5 s, 0 failed |
| API event-loop delay (worst p99 / max), peak RSS | 195 / 458 ms, 1,004 MB | 180 / 295 ms, 700 MB |
| Queries over 200 ms | 216 (the per-request lookups queueing) | 74 (68 of them `COMMIT`) |
| **M2. Fan-out to 200 members, quiet** | p50 61 ms, p95 165 ms, p99 524 ms | p50 72 ms, p95 158 ms, p99 165 ms |
| Fan-out with 5 background sends a second | p50 77 ms, p95 951 ms, p99 998 ms | p50 107 ms, p95 899 ms, p99 1,023 ms |
| Send to the 200-person group (quiet) | p50 64 ms, p99 515 ms | p50 73 ms, p99 175 ms |
| **S1. Send a pulse to 3,000 people** | 3.9 s | 0.53 s |
| **S2. 600 answers a minute** | answer p50 1.0 s, p95 7.4 s, p99 9.2 s; **134 failed (503)**; 1,975 queries over 200 ms; event loop p99 612 ms | answer p50 57 ms, p95 93 ms, p99 143 ms; **0 failed**; 4 over 200 ms (`COMMIT`); event loop p99 42 ms |
| Open my surveys, during the burst | p50 456 ms, p95 7.4 s | p50 16 ms, p95 31 ms |
| **S3. Results, 2,400 answers by department** | 84 ms alone, 297 ms five at once; CSV 85 ms | 87 ms alone, 215 ms five at once; CSV 103 ms |

Every member got every fan-out signal in both runs (none missed). Opening 900 streams took p50 160–260 ms each, 50 at a time.

### What was found and fixed

1. **Read receipts multiplied the live traffic.** Marking a conversation read told every member `messages`, so every member's badge and list refetched; with the conversation open on several screens, one message cost members × readers refetches (and the web app refetched once per signal). Now a read tells the reader's own screens `messages` and the other members only `receipts`, which refreshes the open conversation's "seen by" line and nothing else (`services/messaging/conversations.ts`, `lib/changes.ts`, `components/messages/Messages.tsx`). The web app also folds the signals for one topic arriving within 250 ms into one refetch (`apps/web/src/lib/coalesce.ts`). The run's simulated browsers follow the app: `--client each` replays the old behaviour.
2. **Message sends were refused while other requests queued.** The per-person send limits ran inside the send's transaction, and the shared limiter opens its own transaction, so each send held one connection while waiting for a second from the same pool, with Prisma's 2-second wait: under a burst most sends failed with 503. The limits are now checked before the send's transaction (`routes/messages.ts`, `sendLimits`), and the shared limiter waits for a connection as long as a request does, `DB_POOL_TIMEOUT_S` (`auth/rateLimit.ts`). One difference: a send refused afterwards (read-only, a wrong file type) now counts toward the limit.
3. **Every survey answer loaded the whole audience.** To decide whether an answer may keep its department, each answer loaded all 3,000 invitations and all 3,000 people with their positions. It now loads only the respondent and the people who could share their group, and still counts only those who were asked (`services/surveys/surveys.ts`).
4. **Notifications were written two round trips per person.** A pulse to 3,000 people, or the first message to a 200-person group, wrote each notification and its live signal one by one. They are now written 1,000 to a statement, with one statement of signals per 1,000 (`services/notifications/notifier.ts`). Emails are queued the same way; texts and calls stay one by one.

Tests: `apps/api/test/integration/commsAtScale.test.ts` (batched notifications and their signals, nothing signalled on rollback, receipt signals, answer groups counting only those asked, the send limit with the database store, the limiter's wait) and `apps/web/src/lib/coalesce.test.ts`. No index was missing: the unread count, the thread page (`Message (conversationId, createdAt)`), the notification checks and the survey queries all use indexes; their slow entries before the fixes were queueing, not scans.

### What remains

- **The peak five minutes is still slow on one process.** With nothing failing, a send took p50 5.8 s and the live refetches p50 about 5 s. The API process was using about one core (Node runs a process's JavaScript on one), on a machine shared with other work; the remaining slow queries are commits. Each send is about a dozen queries plus the limiter's three small transactions, and each signal makes every open screen refetch. In production run `WEB_CONCURRENCY` = cores and more than one instance (Sizing, below); this run did not measure how far that goes. Further steps, not done: cache the per-request messaging context (settings, department count, provinces) like the other organization caches, and check the three send limits in one limiter transaction.
- **A shift change in a busy city is the hard case, not a 200-person group.** Fan-out itself is fast (signals reach 200 members in under 0.2 s on a quiet process, under about 1 s with background traffic, none missed); the cost is what every screen does when told.
- **KMS.** Each send, thread read and file read unwraps the conversation's key once: one KMS `Decrypt` in production. At the peak that was 21 a second on average from this one simulated slice (7,186 in 339 s). This run used the local key provider, so it measured no KMS latency; KMS adds a network round trip to each of those requests, and the account's KMS request quota must cover the peak of all organizations together. If it doesn't, the option is a short-lived in-process cache of unwrapped conversation keys, which changes the "key lives only for the request" rule in `services/messaging/crypto.ts` and needs a security decision first.
- **Starting conversations** still checks its limit (20 an hour) inside the transaction; it's rare, but the same pattern as fix 2.

To run it: seed as above, then `npx tsx test/load/seed-comms.ts`, start the API with the same `LOCAL_KEK_BASE64` as the load run (it seals the history), `GLOBAL_RATE_LIMIT=off`, `RATE_LIMIT_STORE=database`, `SLOW_QUERY_MS=200` and a `METRICS_TOKEN`, and run `npx tsx test/load/comms.ts --log <api log> --metrics-token <token>` (`--only messaging|surveys`, `--active 0.1`, `--sse-cities 3`, `--msg-seconds 300`, `--answer-rate 10`, `--answer-seconds 240`).

## What was changed to get here

The first run, before the fixes below, failed many requests in scenarios 1 and 4.

- **Connection pool:**
  - each process opens `DB_POOL_SIZE` connections (default 25, up from Prisma 5's default of 9; since Prisma 7 this is the `pg` pool's `max`, `lib/prismaClient.ts`);
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

**Connection pooling.** See *Connections* above. PgBouncer in transaction mode needs no URL flag since Prisma 7: queries go through `pg` as unnamed prepared statements, which transaction pooling carries (`pgbouncer=true` was a Prisma 5 setting). The tenant setting is transaction-local (`set_config(…, true)`) and locks are transaction-level (`pg_advisory_xact_lock`), so both work through transaction pooling. `LISTEN` and the worker's session lock don't, which is why they connect directly.

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
| Answer a survey | 1 s | p95 93 ms at 600 answers a minute (S2) | — |
| Send a message | 1 s | — | p50 5.8 s at the peak five minutes on one process (M1, see *What remains*) |
| Live update reaches a 200-person group | 1 s | p95 158 ms (M2, quiet) | p95 0.9 s with background sends |

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

Messaging and surveys: see [Team messaging and staff surveys](#team-messaging-and-staff-surveys-12-november-2026) (`test/load/seed-comms.ts`, `test/load/comms.ts`; it writes `test/load/comms-plan.json`, also git-ignored).

To try several processes locally without the cluster module, start two servers on different ports against the same database (`PORT=4200 …` and `PORT=4201 …`): notifications, events and cache invalidation reach both through Postgres. The seed writes the generated sign-ins to `test/load/plan.json`, which is git-ignored.
