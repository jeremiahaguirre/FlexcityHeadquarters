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

Scenario 5 is closest to a real day: even 9,000 workers arriving at a steady pace feel instant. Scenario 1 is a stress test. It shows the system queues work rather than failing: every request was answered, just slower.

## What was changed to get here

The first run, before the fixes below, failed many requests in scenarios 1 and 4.

- **Connection pool:**
  - each process opens `DB_POOL_SIZE` connections (default 25, up from Prisma's default of 9);
  - a request waits up to `DB_POOL_TIMEOUT_S` (20 s) for one, instead of 2 s.
- **Pay runs, provider sends and exports** run in a transaction with a 120 s limit (`payrollTx`), not the 15 s limit other requests get.
- **Worker processes:** `WEB_CONCURRENCY` starts that many API processes on one port. Live notifications reach every process through Postgres `LISTEN`.
- **Lighter shift board:** it selects only the fields it shows, at most 200 rows.
- **Index** on punches by `(tenantId, status, clockIn)` for punch review.

## Sizing a deployment

| Organizations | Suggested |
| --- | --- |
| Up to ~10 cities, or a few thousand staff | One API instance, `WEB_CONCURRENCY` = its cores, managed Postgres with 2 vCPU |
| 30 cities × 300 staff (this test) | Two API instances with 2–4 cores each, behind a load balancer; Postgres with 4 vCPU and 16 GB |
| More | Add API instances; put PgBouncer (transaction mode) in front of Postgres; read replica for reports and exports |

**Connections:** each API process holds up to `DB_POOL_SIZE` connections plus one `LISTEN` connection. The worker (`npm run worker`) holds its own. Keep

  instances × `WEB_CONCURRENCY` × (`DB_POOL_SIZE` + 1) + worker

below Postgres's `max_connections` (100 by default) with room for administration. For example, 2 instances × 3 processes × 26 = 156 needs either `max_connections` of 200 or PgBouncer.

**Row-level security** adds little: every query already filters by city, and every large table's indexes start with the city.

**Pay runs** are the heaviest request. A 300-person city-wide run takes 7–15 s while 30 others run at the same time. Cities pay on different days in practice. Very large cities can run by department.

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

`--scale small` or `--scale big` runs one size only. The seed writes the generated sign-ins to `test/load/plan.json`, which is git-ignored.
