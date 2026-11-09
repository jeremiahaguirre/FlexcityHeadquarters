# Flexcity

Aquatic staff scheduling, timekeeping and operations for Canadian municipalities and private swim clubs.

- **apps/api** — Node.js, Express, TypeScript, Prisma, PostgreSQL (row-level security)
- **apps/web** — Next.js, Tailwind, i18next (English / Canadian French)

**Live demo:** https://jeremiahaguirre.github.io/FlexcityHeadquarters/ — a static build with sample data and no server (sign in as `guard@demo.flexcity` or `frontdesk@demo.flexcity`, password `flexcity-dev`). Build it locally with `npm run build:demo --workspace apps/web`.

## What works today

| Area | Status |
| --- | --- |
| Multi-tenant data model with Postgres row-level security | Done, integration-tested |
| Provincial employment-standards rules (13 jurisdictions), effective-dated, tenant overrides | Done — **values pending legal review** |
| Pay engine: daily/weekly OT (stacked and Alberta greater-of), double time, stat-holiday hours, premiums, vacation pay, DST-safe | Done, unit-tested |
| Shift eligibility: certifications + prerequisites, overlaps, time off, rest periods, young-worker limits, availability, weekly caps | Done, unit-tested |
| Shift Board: post, claim, overtime approval, concurrency-safe | Done, integration-tested |
| Scheduling assistant (draft proposals with explanations) | Done (API) |
| Geofenced timeclock with audited punch edits | Done (API) |
| Chemical log with human-confirmed closure workflow | Done (API) |
| Encrypted incident reports with access log | Done (API) |
| Payroll CSV export with strict validation | Done (API) |
| Retention-aware privacy erasure | Done (API) |
| Union Hub on a separate database role | Service done; HTTP routes not yet |
| Web: sign-in, Shift Board, front-desk pool status, EN/FR toggle, tenant theming | Done |

See [docs/ROADMAP.md](docs/ROADMAP.md) for what is not built yet.

## Getting started

Requirements: Node 22.9+, PostgreSQL 16.

```bash
npm install
```

```bash
cp apps/api/.env.example apps/api/.env
```

Create the database roles once per Postgres cluster (as a superuser):

```bash
psql postgresql://postgres@localhost:5432/postgres -f apps/api/db/roles.sql
```

Run migrations, row-level security and the Union Hub schema, then seed demo data:

```bash
npm run db:migrate --workspace apps/api
```

```bash
npm run db:seed --workspace apps/api
```

Start both apps (separate terminals):

```bash
npm run dev --workspace apps/api
```

```bash
npm run dev --workspace apps/web
```

Open http://kelowna.localhost:3000 and sign in as any demo user, e.g. `guard@kelowna.test`, `supervisor@kelowna.test` or `frontdesk@kelowna.test`. The password for all of them is `flexcity-dev`.

## Tests

```bash
npm test
```

Integration tests need a scratch database and the roles above:

```bash
DATABASE_URL=postgresql://postgres@localhost:5432/flexcity_test APP_DATABASE_URL=postgresql://flexcity_app:change-me@localhost:5432/flexcity_test JWT_SECRET=dev-only-secret-dev-only-secret-0000 npm run test:integration --workspace apps/api
```

CI runs typecheck, unit tests, a migration-drift check and the integration tests on every push.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [How the spec review was resolved](docs/REVIEW-RESOLUTION.md)
- [Compliance notes](docs/COMPLIANCE.md) — read before production use
- [Pricing](docs/PRICING.md)
- [Roadmap](docs/ROADMAP.md)
