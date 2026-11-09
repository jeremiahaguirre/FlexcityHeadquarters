<img src="brand/fh-mark-512.png" alt="" width="72">

# FlexcityHeadquarters (FH)

Aquatic staff scheduling, timekeeping and operations for Canadian municipalities and private swim clubs.

- **apps/api** — Node.js, Express, TypeScript, Prisma, PostgreSQL (row-level security)
- **apps/web** — Next.js, Tailwind, i18next (English / Canadian French)
- **apps/site** — the marketing website (static Next.js export, English and French), deployed on Vercel

**Live demo:** https://jeremiahaguirre.github.io/FlexcityHeadquarters/ — a static build with sample data and no server (pick a role on the sign-in page: lifeguard, supervisor, HR, front desk or union steward). Build it locally with `npm run build:demo --workspace apps/web`. Its sample data is recorded from a seeded local stack by `apps/web/scripts/capture-demo.cjs`; rerun it after changing what a screen loads.

## What works today

| Area | Status |
| --- | --- |
| Multi-tenant data model with Postgres row-level security | Done, integration-tested |
| Provincial employment-standards rules (13 jurisdictions), effective-dated, collective-agreement overrides | Done — **values pending legal review** |
| Pay engine: daily/weekly OT (stacked and Alberta greater-of), double time, stat holidays, premiums, vacation pay, DST-safe | Done, unit-tested |
| Shift eligibility: certifications, overlaps, time off, rest periods, young-worker limits and school calendar, availability, weekly caps | Done, unit-tested |
| Scheduling: schedule builder with assistant, shift board with overtime approval, my schedule, availability, time off | Done (API + web) |
| Timeclock with geofence, punch review, payroll CSV export with holiday and vacation pay | Done (API + web) |
| Pool deck: chemical log with closure workflow, live status board, sealed incident reports | Done (API + web) |
| People: staff directory, invitations, roles, pay rates, verified certifications, discipline records with signature | Done (API + web) |
| Swim lessons with offline attendance | Done (API + web) |
| Union Hub on a separate database role, per-local encryption | Done (API + web) |
| Job postings and public careers page | Done (API + web) |
| Notifications: in-app (live), email outbox, reminders | Done |
| Menus tailored to each role (e.g. a union steward sees only the Union hub) | Done, tested per role |
| **FH Dev console**: create cities, switch 15 features per city, facilities, positions, city logo upload, CSV staff import with preview | Done (API + web) |
| City logo shown beside the FH logo (never replacing it) | Done |
| **Passkeys** (Windows Hello, Face ID / Touch ID, Android fingerprint or face) for sign-in, and "confirm it's you" before sensitive changes | Done, tested with a virtual authenticator |
| English and French throughout, tenant theming | Done |

See [docs/ROADMAP.md](docs/ROADMAP.md) for what is not built yet.

## Getting started

Requirements: Node 26 (current LTS; see `.nvmrc`), PostgreSQL 16.

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

Open http://kelowna.localhost:3000 and sign in as any demo user, e.g. `guard@kelowna.test`, `supervisor@kelowna.test`, `hr@kelowna.test`, `frontdesk@kelowna.test` or `steward@kelowna.test`. The password for all of them is `flexcity-dev`.

The **FH Dev console** (for FlexcityHeadquarters staff, not city staff) is at the bare address, http://localhost:3000. Sign in as `dev@flexcity.dev` / `flexcity-dev`. In production, create Dev accounts with:

```bash
PLATFORM_ADMIN_PASSWORD='a long passphrase' npm run platform:admin --workspace apps/api -- you@flexcity.ca "Your Name"
```

Passkeys work on `*.localhost` in Chrome, Edge, Safari and Firefox. After a password sign-in on a device with Face ID, Touch ID, a fingerprint reader or Windows Hello, the app offers to set one up.

## Tests

```bash
npm test
```

Integration tests need a scratch database and the roles above:

```bash
DATABASE_URL=postgresql://postgres@localhost:5432/flexcity_test APP_DATABASE_URL=postgresql://flexcity_app:change-me@localhost:5432/flexcity_test JWT_SECRET=dev-only-secret-dev-only-secret-0000 npm run test:integration --workspace apps/api
```

CI runs typecheck, unit tests, a migration-drift check and the integration tests on every push.

## Marketing website

`apps/site` is the public website: home, why FH, private sector, plans, demo, help centre, FAQ, contact and legal pages, in English and French, with a sitemap, canonical and hreflang links and structured data. Run it with `npm run dev --workspace apps/site` (http://localhost:3100).

Vercel builds it with **Root Directory** `apps/site` (the settings are in `apps/site/vercel.json`). Environment variables:

| Variable | Value |
| --- | --- |
| `NEXT_PUBLIC_SITE_URL` | The site's public address, e.g. `https://www.example.ca` (canonical links and sitemap) |
| `NEXT_PUBLIC_DEMO_URL` | The app demo, default `https://jeremiahaguirre.github.io/FlexcityHeadquarters` |
| `NEXT_PUBLIC_LEADS_URL` | `https://<api host>/api/marketing/leads`; without it the contact form shows the email address instead |
| `NEXT_PUBLIC_CONTACT_EMAIL` | The address shown on the site |

On the API, add the website's address to `MARKETING_ORIGINS` so the contact form is accepted.

Screenshots on the site come from the demo (`apps/site/public/screens`). Retake them after visible app changes.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [How the spec review was resolved](docs/REVIEW-RESOLUTION.md)
- [Compliance notes](docs/COMPLIANCE.md) — read before production use
- [Security and legal audit](docs/SECURITY-LEGAL-AUDIT.md) — findings, fixes and the Canadian legal mapping
- [Security operations runbook](docs/SECURITY-OPERATIONS.md) — backups, patching, access reviews, incident response
- [Pricing](docs/PRICING.md)
- [Roadmap](docs/ROADMAP.md)
