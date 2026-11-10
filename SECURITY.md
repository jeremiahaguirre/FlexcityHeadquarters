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
