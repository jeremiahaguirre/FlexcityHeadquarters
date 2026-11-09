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

## Static demo

`NEXT_PUBLIC_DEMO=1` builds the web app as static files (GitHub Pages) with no API. `src/lib/demoApi.ts` answers requests in the browser: GETs replay responses recorded per role from a seeded local stack (`scripts/capture-demo.cjs` → `src/lib/demo-fixtures/`), with dates moved so the sample week is always the current one; changes are accepted but not kept. Fixture names are swapped for a fictional organization when recorded.
