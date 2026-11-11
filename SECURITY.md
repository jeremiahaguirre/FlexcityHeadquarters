# Security policy

## Reporting a vulnerability

Please report suspected vulnerabilities privately to **security@flexcityhq.example** (replace with
the production address before launch), not in a public issue. Include what you found, how to
reproduce it, and what an attacker could do with it.

- We acknowledge within 2 business days and give a first assessment within 5.
- We fix critical and high findings before any public disclosure, and credit reporters who want it.
- Please don't access other people's data, degrade the service, or test against a city's production
  site: ask us for a test organization.

## How the product is checked

- Every change: unit and integration tests (including `apps/api/test/integration/hardening.test.ts`,
  which replays each attack found in reviews), a dependency audit, and CodeQL static analysis
  (`.github/workflows/security.yml`, also weekly).
- Dependencies: Dependabot updates; high or critical advisories fail the build.
- Reviews: an adversarial code review and a role-by-role privacy review (November 2026), recorded in
  [docs/SECURITY-LEGAL-AUDIT.md](docs/SECURITY-LEGAL-AUDIT.md).
- Before the first city goes live and yearly after: an independent penetration test
  ([docs/SECURITY-OPERATIONS.md](docs/SECURITY-OPERATIONS.md)).

## SQL injection

Layered, so no single slip opens the database:

1. **No values in SQL text.** Queries go through Prisma, or `$queryRaw` / `$executeRaw` as tagged
   templates (every `${}` is a bound parameter); the Union Hub's `pg` queries use `$1` placeholders.
   Only identifiers (table and column names from the database's own catalogue) are ever spliced in,
   through `ident()` (`apps/api/src/lib/sqlIdent.ts`), which accepts plain names only.
2. **A test that fails the build** (`apps/api/test/unit/sqlSafety.test.ts`) scans every source file for
   SQL built from values: untagged raw calls, `Prisma.raw`, `${}` in unsafe or `pg` queries, string
   concatenation. A reviewed exception has to say why, on the line above it.
3. **Every input is validated** with zod schemas (types, lengths, formats) before it reaches a query;
   the website's enquiry form has the same limits, and the site itself has no database.
4. **The database role limits the damage**: the runtime roles aren't superusers, can't bypass
   row-level security, can't create, drop or alter tables, make temporary tables, or delete from
   most tables, and have a statement time limit. Without a city chosen, row-level security shows
   no rows. The servers refuse to start in production with a more powerful role
   (`apps/api/src/lib/dbRole.ts`).
5. **Attack tests** (`apps/api/test/integration/sqlInjection.test.ts`) throw the classic payloads at
   sign-in, the organization header, path parameters, search and the enquiry form, and check the
   database role's limits directly.

## One city never sees another

- **Row-level security** on every table that holds a city's rows: inside a city's request the
  database returns and accepts that city's rows only, and with no city chosen, none. FH's own
  billing and Dev console tables (invoices, debits, support visits) show a city only its own rows
  too; only FH's billing and console, which run with no city chosen, read across cities.
- **Every request** carries a sign-in bound to one city; using it at another city's address is
  refused. Live notifications are matched on both the person and the city and carry only an id.
- **Checked in CI** (`apps/api/test/integration/crossCity.test.ts`): every table with a city's rows
  must have row-level security and a policy; every API route is called as one city's HR
  administrator and lifeguard with the other city's record ids, and fails if anything of the other
  city comes back or changes.
- **The only thing shared is anonymous:** benchmarks (`/manage/benchmarks`) compare a city with
  others only when it opts in, from cities that opted in, as quartiles, and only when at least five
  cities contribute; no city, person or count of people is identifiable. A city that opts out
  neither contributes nor sees them.

## Secrets, shared tablets and texts

- **API keys** for a city's own systems (`/api/v1`, [docs/PUBLIC-API.md](docs/PUBLIC-API.md)) are 256-bit
  random secrets with a visible prefix; only a SHA-256 is stored and the key is shown once. Each is scoped
  (read-only), optionally limited to IP ranges and an expiry date, rate-limited per key in Postgres, and
  every call is in the city's audit log. A key can only be given scopes whose data its maker can see.
  The organization is found from the hash, then every read runs under RLS. Revoking is immediate;
  rotating keeps the old key for 24 hours. Keys never work on the app's session routes.
- **Webhooks** are signed Stripe-style (`FH-Signature: t=<seconds>,v1=<HMAC-SHA256 of "t.body">`) so
  receivers can refuse forged and replayed messages. Signing secrets are sealed with the city's key
  (they must be read back to sign) and shown once. Payloads carry ids and changed field names only.
  Addresses must be https on the public internet, checked when saved and before every send, the
  connection goes to the checked address, and redirects are never followed (SSRF; `lib/egress.ts`).
  Delivery records keep the response code and 500 characters of the answer, never a secret.

- **Links and devices that act without a sign-in** (a person's calendar feed, a facility kiosk) carry a
  long random secret. Only its SHA-256 hash is stored, it's shown once, and making a new one or
  removing it stops the old one at once (`apps/api/src/routes/calendar.ts`, `routes/kiosk.ts`).
- **Kiosk PINs** are hashed with scrypt like passwords; easy PINs are refused. Five wrong PINs lock
  an employee number for 15 minutes, and a tablet with too many tries is slowed down.
- **Text-message codes** are 6 digits, so a plain hash could be reversed: they're stored as an HMAC
  keyed with the server secret, expire in 10 minutes, and sending and checking are rate-limited.
- **CSV downloads** from Reports prefix any cell that starts with `=`, `+`, `-`, `@`, a tab or a
  carriage return, so a spreadsheet won't run it as a formula
  (`apps/api/src/services/reports/catalog.ts`).
