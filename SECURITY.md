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
