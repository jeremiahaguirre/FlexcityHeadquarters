<img src="brand/fh-mark-512.png" alt="" width="72">

# FlexcityHeadquarters (FH)

Scheduling, timekeeping, payroll, safety and HR for Canadian municipalities and private employers, in English and French.

- **apps/api** — Node.js, Express, TypeScript, Prisma, PostgreSQL (row-level security)
- **apps/web** — Next.js, Tailwind, i18next (English / Canadian French)
- **apps/site** — the marketing website (static Next.js export, English and French), deployed on Vercel

**Live demo:** https://jeremiahaguirre.github.io/FlexcityHeadquarters/ — a static build with sample data and no server (pick a role on the sign-in page: lifeguard, supervisor, HR, front desk, union steward or a water works employee). Build it locally with `npm run build:demo --workspace apps/web`. Its sample data is recorded from a seeded local stack by `apps/web/scripts/capture-demo.cjs`; rerun it after changing what a screen loads.

## What works today

| Area | Status |
| --- | --- |
| Multi-tenant data model with Postgres row-level security; least-privilege database roles | Done, integration-tested |
| Provincial employment-standards rules (13 jurisdictions), effective-dated, collective-agreement overrides | Done — **values pending legal review** |
| Pay engine: daily/weekly OT (stacked and Alberta greater-of), double time, stat holidays, premiums, vacation pay, DST-safe | Done, unit-tested |
| Shift eligibility: certifications, overlaps, time off, rest periods, young-worker limits and school calendar, availability, weekly caps | Done, unit-tested |
| Scheduling: schedule builder with a multi-facility assistant, shift board with overtime approval and pay preview, two-person shift trades, availability, time off, a private calendar feed of your own shifts; seniority breaks ties only where the organization uses it | Done (API + web) |
| Demand forecast from headcounts, facility opening hours (minimum on deck) and lesson registrations, with draft shifts for the gaps | Done (API + web) |
| Timeclock with geofence, punch review; a shared facility kiosk (tablet) where staff punch with their employee number and a PIN | Done (API + web) |
| **Payroll in the app, no provider needed**: hourly and salaried staff; bonuses, retro pay and vacation payouts (CRA bonus method); allowances, reimbursements, recoveries; off-cycle runs; court and CRA orders; CPP/QPP, EI, QPIP and income tax in all 13 jurisdictions; benefits and union dues; two-person approval; direct deposit from the city's own bank (CPA-005, sent over SFTP); remittances, T4 XML, RL-1 XML, ROE Web XML; general-ledger journal | Done (API + web) — **tax tables verified by FH each year** |
| Time in lieu (banked overtime), expense and mileage claims paid on the next run, T4A slips and XML for contractors and honoraria | Done (API + web) — **first T4A XML to go through CRA's validation** |
| Or keep ADP, Dayforce or Wagepoint: each period sent over their API, or as a file in their layout | Done — **API access is granted by each provider** |
| Quebec: QPP, QPIP, Quebec tax, HSF, CNT, workforce skills (1%) training log | Done (API + web) |
| Pool deck: rotations with fatigue limits, headcounts, chemical log with closure workflow, sealed incident reports | Done (API + web) |
| Safety: working alone with check-ins and location sharing, emergency contacts, injury-report deadlines, care after critical incidents, required coverage | Done (API + web) |
| Text and phone alerts for working-alone escalation, missed check-ins, call-outs and last-minute shifts (Twilio; each city switches it on) | Done — **text provider's DPA to sign** |
| People and HR: directory, reporting lines and an org chart (approvals go to the manager first), roles, pay rates, certifications, onboarding, reliability, discipline with signatures, accommodation, leave balances, reviews, training, grievances, offboarding, encrypted documents, read-and-sign policies | Done (API + web) |
| Hiring: job postings, a careers page and applications in the app (résumé encrypted), hired straight into an invitation | Done (API + web) |
| Facility logbook (append-only) and staff announcements with read counts | Done (API + web) |
| Reports: nine built-in reports, CSV download, saved and emailed weekly or monthly | Done (API + web) |
| Programs: lessons with offline attendance, registration campaigns, members, facility bookings, public sign-up | Done (API + web) |
| Union Hub on a separate database role and per-local keys; can run as its own service | Done (API + web) |
| First-sign-in information and consent agreement (notifications and location choices, signature), enforced by the API, certified in the Dev console | Done — **text pending legal review** |
| Notifications: in-app (live), email, web push on phones; installable app | Done |
| **FH Dev console**: cities, features, menus per role, plans and billing (monthly, yearly or multi-year terms), FH's books, payroll set-up for a city, signed agreements, support visits, offboarding and data export | Done (API + web) |
| Passkeys, single sign-on (Entra ID, SAML), multi-factor sign-in, audit log, privacy tools | Done |
| English and French throughout; light and dark mode; mobile and accessibility checked | Done |

See [docs/ROADMAP.md](docs/ROADMAP.md) for what is not built yet and what needs people (legal, accounting, providers) before launch.

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

Open http://kelowna.localhost:3000 and sign in as any demo user, e.g. `guard@kelowna.test`, `supervisor@kelowna.test`, `hr@kelowna.test`, `frontdesk@kelowna.test` or `steward@kelowna.test`. The password for all of them is `flexcity-dev`. Each person signs the information and consent agreement at their first sign-in.

Background jobs (reminders, retention, working-alone escalation, texts and calls, scheduled reports) run with `npm run worker --workspace apps/api`. To try the Union Hub as its own service, start the API with `UNION_HUB_MODE=separate` and no `UNION_DATABASE_URL`, run `npm run dev:union --workspace apps/api`, and start the web app with `UNION_URL=http://localhost:4100` (see [Architecture](docs/ARCHITECTURE.md)).

The **FH Dev console** (for FlexcityHeadquarters staff, not city staff) is at the bare address, http://localhost:3000. Sign in as `dev@flexcity.dev` / `flexcity-dev`. In production, create Dev accounts with:

```bash
PLATFORM_ADMIN_PASSWORD='a long passphrase' npm run platform:admin --workspace apps/api -- you@flexcity.ca "Your Name"
```

Texts and calls are only logged (number masked, no contents) unless the API has `SMS_PROVIDER=twilio` and the Twilio settings in `apps/api/.env.example`.

Passkeys work on `*.localhost` in Chrome, Edge, Safari and Firefox. After a password sign-in on a device with Face ID, Touch ID, a fingerprint reader or Windows Hello, the app offers to set one up.

## Tests

```bash
npm test
```

Integration tests need a scratch database and the roles above:

```bash
DATABASE_URL=postgresql://postgres@localhost:5432/flexcity_test APP_DATABASE_URL=postgresql://flexcity_app:change-me@localhost:5432/flexcity_test JWT_SECRET=dev-only-secret-dev-only-secret-0000 npm run test:integration --workspace apps/api
```

CI runs typecheck, unit tests (including a guard that fails on SQL built from values), a migration-drift check, the integration tests and dependency and secret scans on every push.

## Marketing website

`apps/site` is the public website: home, why FH, private sector, plans, demo, help centre, FAQ, contact and legal pages, in English and French, with a sitemap, canonical and hreflang links and structured data. Run it with `npm run dev --workspace apps/site` (http://localhost:3100).

Vercel builds it with **Root Directory** `apps/site` (the settings are in `apps/site/vercel.json`). Environment variables:

| Variable | Value |
| --- | --- |
| `NEXT_PUBLIC_SITE_URL` | The site's public address, e.g. `https://www.example.ca` (canonical links, sitemap, and the demo's "Back to the website" button). Defaults to the Vercel production address, today `https://flexcity-headquarters-iota.vercel.app` |
| `NEXT_PUBLIC_DEMO_URL` | The app demo, default `https://jeremiahaguirre.github.io/FlexcityHeadquarters` |
| `NEXT_PUBLIC_LEADS_URL` | `https://<api host>/api/marketing/leads`; without it the contact form asks visitors to try again shortly |

On the API, add the website's address to `MARKETING_ORIGINS` so the contact form is accepted.

The site uses Vercel Web Analytics (`@vercel/analytics`, in both root layouts): cookieless, so there is no cookie banner. Visits show in the Vercel project's Analytics tab once it's turned on there.

Screenshots on the site come from the demo (`apps/site/public/screens`). Retake them after visible app changes.

## Documentation

- [Architecture](docs/ARCHITECTURE.md) — tenancy, flows, the Union Hub service, the Dev console
- [Compliance notes](docs/COMPLIANCE.md) — read before production use
- [Payroll verification](docs/PAYROLL-VERIFICATION.md) — how FH checks each year's tax tables and the payroll maths
- [Privacy impact assessment](docs/PIA.md), [electronic monitoring](docs/ELECTRONIC-MONITORING.md), [retention schedule](docs/RETENTION.md) and [subprocessors](docs/SUBPROCESSORS.md)
- [Security policy](SECURITY.md) — reporting, how the product is checked, SQL injection defences
- [Security and legal audit](docs/SECURITY-LEGAL-AUDIT.md) — findings, fixes and the Canadian legal mapping
- [Security operations runbook](docs/SECURITY-OPERATIONS.md) — backups, patching, access reviews, incident response
- [Scalability and load tests](docs/SCALABILITY.md) — results for 1 city × 30 and 30 cities × 300, and how to size a deployment
- [Pricing](docs/PRICING.md)
- [Roadmap](docs/ROADMAP.md) and the [feature audit](docs/FEATURE-AUDIT.md) of what to add next
- [How the spec review was resolved](docs/REVIEW-RESOLUTION.md) and the [brand guide](brand/README.md)
