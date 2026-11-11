# Architecture

## Stack

| Layer | Choice | Notes |
| --- | --- | --- |
| Web | Next.js 15 (App Router), Tailwind, i18next | Tenant brand colours injected as CSS variables at request time |
| API | Node 26, Express, TypeScript (strict), Zod | Permission-based route guards |
| Data | PostgreSQL 16 via Prisma | Row-level security on every tenant table |
| Hosting | AWS `ca-central-1` | Config refuses non-Canadian regions in production |
| Keys | AWS KMS | One KEK per tenant; one per union local |

## Tenancy and isolation

Every tenant-scoped table has a `tenantId` column. Postgres row-level security (`apps/api/db/rls.sql`) compares it with `app.tenant_id`, which the API sets at the start of every transaction (`withTenant()` in `src/lib/db.ts`).

- The API connects as `flexcity_app`, which is **not** the table owner, so RLS always applies (`FORCE ROW LEVEL SECURITY` as well).
- With no tenant set, every policy evaluates to false: a forgotten context returns **no rows**, never all rows.
- `flexcity_app` has no `DELETE` on payroll-bearing tables, and audit logs are append-only.
- The tenant is resolved from the request's subdomain before login through a `SECURITY DEFINER` function that exposes only public branding fields. Access tokens must belong to the same tenant as the subdomain.

## Roles vs. positions

The original single `role` field conflated *what you may do in the app* with *what you may work*:

- **AccessRole** (many per user): HR_ADMIN, AQUATIC_SUPERVISOR, HEAD_LIFEGUARD, STAFF, FRONT_DESK, UNION_STEWARD, EMPLOYEE (general city staff: water works, parks…). These map to permissions in `src/auth/permissions.ts`; routes check permissions, never role names.
- **Position** (tenant-defined: Lifeguard, Swim Instructor…): what a shift requires. Positions require certifications, and certifications can require others (National Lifeguard requires current first aid). A manager approves each user for each position.

## Time

- All instants are `timestamptz`. Local reasoning (work days, pay weeks, availability, school hours) always uses the facility's IANA timezone.
- Employment-standards province is on the **facility**, not the tenant.
- The API sends facility-local timestamps for display, so browsers with stale timezone data can't show different times. (This is a live issue: tzdata 2026e keeps BC on UTC−7 year-round.)

## Key flows

### Eligibility (`services/scheduling/eligibility.ts`)

A pure function decides whether a person may work a shift and explains every refusal. The database loader does coarse filtering in SQL; the pure function makes the final decision. The Shift Board, the scheduling assistant and supervisor approvals all use the same function.

### Shift Board (`services/shiftboard/offers.ts`)

```
post (holder or supervisor) ──► OPEN ──claim──► eligible, no OT ──► COMPLETED (shift reassigned)
                                  ▲               │
                                  │               └─ OT ──► PENDING_APPROVAL ──approve (re-checked)──► COMPLETED
                                  └──────────────────────────────────── deny ◄─┘
```

- The original holder stays assigned until COMPLETED.
- Claims take advisory locks on the shift and then the claimant (fixed order, no deadlocks), and the reassignment is a compare-and-set on `Shift.version`.
- Only eligible staff are notified when a shift is posted.

### Pay (`services/payroll/payCalc.ts`)

Punches are split at local midnight and grouped into work days. Daily thresholds are applied, then weekly thresholds per pay week, using the province's method ('stacked' never counts daily-OT hours toward the weekly threshold; Alberta pays the greater of daily or weekly OT). Rates are looked up per position and date. Money uses decimal arithmetic. The Shift Board's overtime warning calls the same engine, so the warning and the pay stub can't disagree.

### Payroll runs (`services/payroll/payRuns.ts`)

A regular run takes the period's approved hours from the pay engine, adds salaried staff (the annual
amount ÷ pay periods, prorated by days), and works out each statement: CPP/QPP, EI, QPIP and income
tax by the T4127 method, benefits and union dues, then the run's one-time items (bonuses, retro pay
and vacation payouts by the bonus method in `lumpSum.ts`; allowances; untaxed reimbursements; after-
tax recoveries) and court or CRA orders, capped by their share of net and what's still owed.
Off-cycle runs carry only their one-time items. A second person approves; the deposit file
(CPA-005) goes to the city's bank over SFTP or by download. With a payroll provider instead
(`providers.ts`), each period's approved hours go to ADP, Dayforce or Wagepoint over their API.

### Operations

Chemical readings are checked against each pool's configured thresholds; there are no built-in defaults. Out-of-range readings **recommend** closure, and a Head Lifeguard or Supervisor confirms or dismisses with a note.

## Sensitive data

| Data | Protection |
| --- | --- |
| Incident narratives | AES-256-GCM per record; data key wrapped by the tenant's KMS key; bound to the record with AAD; every read logged with a purpose |
| Union messages | Separate schema and DB role; sealed with the union local's own key |
| SIN, bank accounts, provider and bank credentials | Sealed with the city's own key (envelope encryption, AAD-bound); a SIN is unsealed only into a filing file, with a passkey, and audited |
| Signed agreements | The application role can't update them; fingerprints of the text and signature are re-checked on each certificate |
| Refresh tokens | Stored as SHA-256 hashes; reuse of a rotated token revokes the whole family |
| Calendar feed links, kiosk secrets | Only a SHA-256 hash of each secret is stored; the link or set-up address is shown once |
| Kiosk PINs | Hashed with scrypt like passwords; easy PINs refused |
| Text-message codes | 6 digits, 10 minutes, stored as an HMAC keyed with the server secret (a plain hash of 6 digits could be reversed) |
| Résumés, receipts, T4A payees' SINs | Sealed with the city's own key like other documents and SINs; each résumé download is audited |
| Policy signatures, logbook entries | The application role can't update them; a policy signature keeps a SHA-256 of the exact text signed |
| Location | At punch time, only whether the person was on site and how far; during a working-alone session the person shares, the latest position only |
| SQL | Values are always bound parameters; identifiers only through `ident()`; a test fails the build on SQL built from values; runtime roles can't change the schema (see [SECURITY.md](../SECURITY.md)) |

## Events

Domain events (`src/lib/events.ts`) are published only after the transaction commits. Notifications are written to the database and announced with `pg_notify`; browsers listen over server-sent events (`/api/notifications/stream`) and emails, texts and calls go out through outboxes the worker drains. Web push to phones and computers subscribes to the same notifications (`services/notifications/push.ts`); the lock screen shows a short heading only.

## Routes without a sign-in

Most of `/api` needs a signed-in person. These don't (`src/app.ts`):

- **Calendar feed** (`GET /api/calendar/:tenantId/:secret.ics`, `routes/calendar.ts`): the secret in the link is the key; the API looks up its hash. Rate-limited by address; an unknown link, a disabled organization or an inactive person all look like no feed.
- **Facility kiosk** (`/api/kiosk`, `/api/kiosk/punch`, `routes/kiosk.ts`): the tablet sends its own token in `x-kiosk-token` (organization id and secret, stored hashed), not a person's session. A person is identified by employee number and PIN; wrong PINs are limited per number (5 in 15 minutes) and per tablet. Revoking a kiosk stops it at once.
- **Job applications** (`POST /api/public/jobs/:id/apply`, `routes/applications.ts`): on the organization's subdomain, for postings that take applications in the app, with the same bot checks and rate limits as public sign-up.

They sit beside the older public routes: the city logo, the careers page, public sign-up and the sign-in routes.

## Background worker

`npm run worker --workspace apps/api` (`src/worker.ts`) runs each job under a Postgres advisory lock, so several worker processes never run the same job at once. Every minute: working-alone escalation, call-out timeouts, rotation alerts, and delivery of email, texts and calls (`deliverSms`: Twilio, or logged when `SMS_PROVIDER=console`; up to 5 tries) and web push. Every hour: reminders, anonymization, retention, scheduled reports (`services/reports/scheduled.ts`: each saved report is run with its owner's access at that moment and emailed weekly or monthly; someone who lost access stops getting it), and benchmarks.

## Health, metrics and errors

All in `routes/observability.ts` and `lib/` (`health.ts`, `metrics.ts`, `requestContext.ts`, `errorReporter.ts`, `scrub.ts`). Settings are in `apps/api/.env.example`.

- **`GET /healthz`** (liveness): answers `{ ok: true }` without touching anything. Use it for "restart the container if this stops answering".
- **`GET /readyz`** (readiness): runs `SELECT 1` within `READY_DB_TIMEOUT_MS` (1.5 s), then reads the email and text outbox backlog (`outbox_backlog()` in `db/rls.sql`: counts and the oldest age across organizations, nothing else) and the worker's heartbeat. 200 when ready, 503 with each failing check's reason otherwise. A database that is down or slow always fails it. An outbox older than `READY_OUTBOX_MAX_AGE_S` (15 min) or a worker silent for `READY_WORKER_MAX_AGE_S` (5 min) shows as `warn` and fails only in strict mode (`READY_STRICT=on`, or `/readyz?strict=1`), so a load balancer doesn't take every API server out of service when only the worker is down. Point the load balancer at `/readyz` and an uptime alert at `/readyz?strict=1`. The body names checks, counts and ages only: no hosts, errors or organization data.
- **Worker heartbeat:** the worker is its own process with no HTTP port. After each minute's round of jobs it sets its database connection's `application_name` to `fh-worker beat=<unix seconds>`; readiness and metrics read the newest beat from `pg_stat_activity`. No table, and the beat disappears when the worker stops. The worker's lock connection must go straight to Postgres, not through PgBouncer in transaction mode (its advisory locks need that already).
- **Request ids:** every request gets an id, or keeps an incoming `X-Request-Id` made of 8–128 letters, digits and `._:-`. It's sent back in the `X-Request-Id` header and in every error body (`requestId`), and every console line logged while handling the request starts with `[req <id>]`. Ask a person for the id on the error, then search the logs and error reports for it.
- **`GET /metrics`** (Prometheus text format): only with `Authorization: Bearer <METRICS_TOKEN>`; without the setting it answers 404. Requests and latency (`fh_http_requests_total`, `fh_http_request_duration_seconds`) by method, route *pattern* (`/api/users/:id`, never the URL, so no ids reach the metrics store and series stay bounded; anything no route matched is `unmatched`) and status class; `fh_errors_total` by source; `fh_db_query_duration_seconds` (Prisma query events, on only when metrics are); memory, uptime and event-loop delay; `fh_outbox_pending`, `fh_outbox_failed`, `fh_outbox_oldest_age_seconds` by channel; `fh_worker_connected` and `fh_worker_heartbeat_age_seconds`. Numbers are per process: with `WEB_CONCURRENCY` > 1 a scrape reaches one of the container's processes, so prefer scaling out with one process per container where metrics matter.
- **Error reports** (`lib/errorReporter.ts`): the Express error handler (500s), unhandled rejections, uncaught exceptions (reported, then the process exits for its supervisor to restart), background job failures and notification fan-out failures. Each is logged as before and, when `SENTRY_DSN` is set, sent as one Sentry envelope over `fetch` (Sentry or GlitchTip; no SDK); the DSN's host must be on the public internet (`lib/egress.ts`). A report holds the error's type, first message line and stack frames, the request id, the route pattern, the organization's id and a one-way hash of the user's id; never bodies, query strings, headers, names or emails. Text goes through `lib/scrub.ts` first (emails, SIN-like, card and phone numbers, JWTs and long tokens, passwords, Authorization and cookie values). Identical errors go out at most once a minute, with a count of repeats, and no more than 60 reports a minute in all. Use a service hosted in Canada; it's an optional subprocessor ([SUBPROCESSORS.md](SUBPROCESSORS.md)).
- **Browser errors** (`apps/web/src/lib/errorReporting.ts`): uncaught errors, unhandled rejections and the page error boundary (`app/error.tsx`, which shows the usual "Something went wrong" notice with "Try again") post to `POST /api/client-errors`: the error's name, message and stack, the page path with ids replaced, and the build (`NEXT_PUBLIC_RELEASE` at build time). Never form contents, query strings or tokens. Ten reports per page load at most; the API takes 20 a minute per address and scrubs them like its own.

## Union Hub access

Access follows union membership, not employer roles: `/api/me` grants `union.hub` to union members while the organization has the hub switched on, and every hub query re-checks membership of the local through the separate `flexcity_union` database role.

### Running the hub as its own service

By default the API serves `/api/union/*` itself. For stronger separation, run it on its own:

1. Deploy the API with `UNION_HUB_MODE=separate` and **without** `UNION_DATABASE_URL` (the API refuses
   to start if it's given both). It then answers `/api/union/*` with `404 UNION_ELSEWHERE` and holds no
   way into the `union_hub` schema, so a flaw or a leaked secret in the main API can't reach union data.
2. Deploy the same build a second time as the Union Hub service: `npm run start:union --workspace apps/api`
   (`src/unionServer.ts`, port `UNION_PORT`, default 4100) with `UNION_DATABASE_URL` (the
   `flexcity_union` role), `APP_DATABASE_URL`, `JWT_SECRET` and the KMS settings. It answers only
   `/api/union/*` and `/healthz`; every other path is a 404.
3. Route `/api/union/*` to it at the load balancer (path rule above the general `/api/*` rule), or,
   for single-host set-ups, set `UNION_URL` for the web app so its rewrite sends those paths there.
   Same origin either way: no CORS, and the browser keeps one session.

The hub service checks sign-ins exactly like the API (same tokens, account still active, organization
open, signed agreement, support visits refused), reading those through the app role, which can't read
the union schema. Give the two services separate secrets stores so each holds only its own credentials.
Locally: `npm run dev:union --workspace apps/api` beside `npm run dev`.

## Feature switches

Each organization has a switch per feature (thirty-five today) (`src/services/platform/features.ts`), set from the Dev console. The one exception is `seniority`, which the organization can also set in Settings (`/settings/seniority`). Text alerts (`textAlerts`) are off by default because messages cost money. A switched-off feature removes its permissions for everyone in that organization when the access token is checked, so menus hide it and permission checks refuse it; features without their own permission (lessons, union hub, public job page) also have a route guard. Notification emails follow their own switch; invitations and password resets always send.

## Menus per role

Menus are driven by permissions, never role names (`apps/web/src/lib/nav.ts`). Two permissions exist only to shape menus: `shifts.self` (works shifts: Today, My schedule) and `lessons.teach`. HR administrators and union stewards don't have them, so they don't see personal shift screens; a steward's menu is just the Union hub. `nav.test.ts` pins the menu for every role against the API's permission matrix.

## First-sign-in agreement

Each person reads the information and consent agreement (`services/privacy/consent.ts`, EN/FR,
`CONSENT_VERSION`), chooses notifications and location with the device's own prompts, and signs.
Until the current version is signed, `requireConsent` answers every API request with
`428 CONSENT_REQUIRED` except reading and signing it, sign-in essentials, the data export and a
working-alone call for help; the web app opens the agreement when it sees that.

## FH Dev console

FH staff (`PlatformAdmin`) are not users of any organization. They sign in at the bare FH address with an opaque, revocable session in an HTTP-only, SameSite=Strict cookie scoped to `/api/platform`; every console request must also send `x-fh-platform: 1`. Organization tokens are refused there and console sessions are refused by organization routes. The console still reads and writes an organization's data only through `withTenant`, so row-level security applies. Every change is written to `PlatformAudit` and to the organization's own audit trail (`platform.*` actions, no user as actor).

Uploaded logos (PNG, JPEG, WebP; content-checked; SVG refused) live in `TenantLogo` and are served publicly at `/api/public/logo/:tenantId?v=<hash>`. The web app always shows the FH logo and places the city's logo beside or below it.

Beyond city set-up, the console holds plans and billing (monthly, yearly or multi-year terms, per-
option prices), FH's own books, payroll tax tables, a city's in-app payroll set-up (deposit details
and bank connection), signed agreements with certificates, consented support visits, offboarding and
website enquiries. Sensitive actions ask for a passkey again (`requirePlatformStepUp`).

Staff import parses CSV on the server (`staffImport.ts`), returns a row-by-row preview with problem codes the web app translates, then creates only valid rows in one transaction, optionally sending invitations.

## Passkeys and "confirm it's you"

Passkeys use WebAuthn (`@simplewebauthn`), so Windows Hello, Face ID / Touch ID, Android biometrics and security keys all work the same way. Credentials are bound to the organization's own subdomain (or the console's address) and require user verification; challenges are stored, single use and expire after five minutes. Only public keys are stored (`Passkey`, under row-level security; `PlatformPasskey`).

Access tokens carry `aat`, the time the person last proved who they are. Refreshing keeps it unchanged; a password or passkey sign-in, or a step-up, renews it. `requireRecentAuth` guards payroll export, pay rates, HR record changes, erasure and passkey changes: older than 10 minutes, the API answers `STEP_UP_REQUIRED`, the web app asks for a passkey or password, and the original request carries on.

## Static demo

`NEXT_PUBLIC_DEMO=1` builds the web app as static files (GitHub Pages) with no API. `src/lib/demoApi.ts` answers requests in the browser: GETs replay responses recorded per role from a seeded local stack (`scripts/capture-demo.cjs` → `src/lib/demo-fixtures/`), with dates moved so the sample week is always the current one; changes are accepted but not kept. Fixture names are swapped for a fictional organization when recorded, and the city logo is an embedded placeholder emblem. The Dev console is recorded too, and its staff-import preview runs the API's validation in the browser. Passkeys are hidden in the demo (there is no server to verify them).
