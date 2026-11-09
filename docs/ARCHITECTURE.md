# Architecture

## Stack

| Layer | Choice | Notes |
| --- | --- | --- |
| Web | Next.js 14 (App Router), Tailwind, i18next | Tenant brand colours injected as CSS variables at request time |
| API | Node 22, Express, TypeScript (strict), Zod | Permission-based route guards |
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

- **AccessRole** (many per user): HR_ADMIN, AQUATIC_SUPERVISOR, HEAD_LIFEGUARD, STAFF, FRONT_DESK, UNION_STEWARD. These map to permissions in `src/auth/permissions.ts`; routes check permissions, never role names.
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

### Operations

Chemical readings are checked against each pool's configured thresholds; there are no built-in defaults. Out-of-range readings **recommend** closure, and a Head Lifeguard or Supervisor confirms or dismisses with a note.

## Sensitive data

| Data | Protection |
| --- | --- |
| Incident narratives | AES-256-GCM per record; data key wrapped by the tenant's KMS key; bound to the record with AAD; every read logged with a purpose |
| Union messages | Separate schema and DB role; sealed with the union local's own key |
| SIN | **Not stored.** Payroll providers hold it. |
| Refresh tokens | Stored as SHA-256 hashes; reuse of a rotated token revokes the whole family |
| Location | Captured only at punch time; scrubbed on anonymization |

## Events

Domain events (`src/lib/events.ts`) are published only after the transaction commits. Notifications are written to the database and announced with `pg_notify`; browsers listen over server-sent events (`/api/notifications/stream`) and emails go out through an outbox the worker drains. Push notifications (see roadmap) will subscribe to the same events.

## Union Hub access

Access follows union membership, not employer roles: `/api/me` grants `union.hub` to union members while the organization has the hub switched on, and every hub query re-checks membership of the local through the separate `flexcity_union` database role.

## Feature switches

Each organization has fifteen switches (`src/services/platform/features.ts`), set only from the Dev console. A switched-off feature removes its permissions for everyone in that organization when the access token is checked, so menus hide it and permission checks refuse it; features without their own permission (lessons, union hub, public job page) also have a route guard. Notification emails follow their own switch; invitations and password resets always send.

## Menus per role

Menus are driven by permissions, never role names (`apps/web/src/lib/nav.ts`). Two permissions exist only to shape menus: `shifts.self` (works shifts: Today, My schedule) and `lessons.teach`. HR administrators and union stewards don't have them, so they don't see personal shift screens; a steward's menu is just the Union hub. `nav.test.ts` pins the menu for every role against the API's permission matrix.

## FH Dev console

FH staff (`PlatformAdmin`) are not users of any organization. They sign in at the bare FH address with an opaque, revocable session in an HTTP-only, SameSite=Strict cookie scoped to `/api/platform`; every console request must also send `x-fh-platform: 1`. Organization tokens are refused there and console sessions are refused by organization routes. The console still reads and writes an organization's data only through `withTenant`, so row-level security applies. Every change is written to `PlatformAudit` and to the organization's own audit trail (`platform.*` actions, no user as actor).

Uploaded logos (PNG, JPEG, WebP; content-checked; SVG refused) live in `TenantLogo` and are served publicly at `/api/public/logo/:tenantId?v=<hash>`. The web app always shows the FH logo and places the city's logo beside or below it.

Staff import parses CSV on the server (`staffImport.ts`), returns a row-by-row preview with problem codes the web app translates, then creates only valid rows in one transaction, optionally sending invitations.

## Passkeys and "confirm it's you"

Passkeys use WebAuthn (`@simplewebauthn`), so Windows Hello, Face ID / Touch ID, Android biometrics and security keys all work the same way. Credentials are bound to the organization's own subdomain (or the console's address) and require user verification; challenges are stored, single use and expire after five minutes. Only public keys are stored (`Passkey`, under row-level security; `PlatformPasskey`).

Access tokens carry `aat`, the time the person last proved who they are. Refreshing keeps it unchanged; a password or passkey sign-in, or a step-up, renews it. `requireRecentAuth` guards payroll export, pay rates, HR record changes, erasure and passkey changes: older than 10 minutes, the API answers `STEP_UP_REQUIRED`, the web app asks for a passkey or password, and the original request carries on.

## Static demo

`NEXT_PUBLIC_DEMO=1` builds the web app as static files (GitHub Pages) with no API. `src/lib/demoApi.ts` answers requests in the browser: GETs replay responses recorded per role from a seeded local stack (`scripts/capture-demo.cjs` → `src/lib/demo-fixtures/`), with dates moved so the sample week is always the current one; changes are accepted but not kept. Fixture names are swapped for a fictional organization when recorded, and the city logo is an embedded placeholder emblem. The Dev console is recorded too, and its staff-import preview runs the API's validation in the browser. Passkeys are hidden in the demo (there is no server to verify them).
