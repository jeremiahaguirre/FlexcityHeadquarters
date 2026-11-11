# Trust: FH's security and compliance program

The Dev console's **Trust** area runs FlexcityHeadquarters' own security program: the controls FH
operates, the frameworks they map to, live tests of the platform's real state, evidence, policies,
risks, vendors, and every promise made to a customer. It is about FH as the company running the
platform, not about any city's data, and it lives **in the Dev console only**: there is no public
page, no public endpoint, and nothing in the city app. Customers see FH's posture only when FH
presents it (Present mode) or sends them the posture summary.

Code: `apps/api/src/services/trust/` (library, scoring, monitors, posture, reminders, seed, exports),
`apps/api/src/routes/platform/trust.ts`, `apps/web/src/app/(platform)/platform/trust/`,
`apps/web/src/components/platform/trust/`. Tables: `Trust*` and `WorkerJobRun` in `schema.prisma`.

## Sections

| Section | What it holds |
| --- | --- |
| Overview | Posture score (ring), readiness per framework, KPI tiles with sparklines (failing tests, overdue evidence, open high risks, vendors due, commitments due in 30 days), stacked daily test results or the score over time, a 5×5 risk heat map, vendor risk, the next 90 days of commitments, policy acknowledgement progress, recent alerts. A time-range slider (7 days to 12 months), a risk-appetite slider (saved for everyone by a Trust manager) and a framework scope (recalculates the score; "make this the default" saves it). Live: polls every 20 s with an ETag, so an unchanged posture costs a 304. |
| Frameworks | SOC 2 (2017 Trust Services Criteria: CC1–CC9, A1, C1, P), ISO/IEC 27001:2022 (clauses 4–10 and all 93 Annex A controls), HIPAA Security Rule (optional; US health information only), PIPEDA (the ten principles of Schedule 1, and breach reporting and records under ss. 10.1 and 10.3), provincial public-sector privacy as customer requirements (BC FIPPA incl. the 2021 residency change, Ontario MFIPPA, Alberta FOIP/POPA), Quebec Law 25. Provincial and Law 25 section numbers are as commonly cited and the framework notes say to have counsel confirm them before quoting them in a contract. Requirement titles are FH's own paraphrases, not the standards' text. Each requirement shows the FH controls that meet it and whether it is met, partly met, a gap or not applicable. The auditor bundle is exported here. |
| Controls | 50 FH controls (access, encryption, tenant isolation, logging, backups, vulnerabilities, secure development, change, incidents, continuity, vendors, people, retention, privacy, physical, governance): owner, how each is proven (tests, evidence window, inherited), status, and an optional manual status that needs a justification (e.g. not applicable). |
| Tests | The automated monitors below: owner, frequency, last run, result and details, on/off, 90 days of history, run now. |
| Evidence | Files (sealed like employee documents), links, notes and CI results per control; evidence requests with owners and due dates. |
| Policies | Twelve FH policy templates (information security, acceptable use, access control, incident response, continuity and DR, vendor management, retention, privacy, encryption, change management, secure development, HR security), EN and FR. Draft → approve → publish (a new version retires the old), yearly review date, and acceptance by every console admin with reminders. |
| Risks | Register with likelihood × impact (1–5) before and after controls, treatment (mitigate, accept, transfer, avoid), owner, linked controls, due date and review cadence. Starts with nine realistic risks. |
| Vendors | Seeded from [SUBPROCESSORS.md](SUBPROCESSORS.md): criticality, data handled, location (Canada or not), DPA, SOC 2 and ISO expiry, review cadence, a built-in 10-question security questionnaire with a score, and linked risks. |
| Commitments | What FH promised each customer: contract security clauses, uptime and support SLAs, data residency, breach-notice windows, pen tests, report delivery, questionnaire answers, custom terms. Linked to the organization, owner, due date and recurrence; marking a recurring one met records it and moves it to the next date. Table and calendar views, plus the 90-day timeline. |
| Questionnaires | Approved answers (EN and FR) to the questions cities ask in security questionnaires and RFPs, with who reviewed them and when; flagged after a year. |
| Present | Full-screen posture for a call or screen share: score, frameworks "preparing" with readiness, tests passing, data residency. Failing-test details are hidden unless the presenter turns them on. PDF and CSV posture summary downloads. The "report a security issue" line (Present and the PDF) shows `SECURITY_EMAIL`, and is left out while it isn't set. |

## What is automated and what is manual

The worker (`src/worker.ts`) runs the tests every 5 minutes under its advisory lock (several
workers never run them twice), each on its own frequency (5 to 60 minutes). Trust managers can run
them on demand. Results carry counts and names only, never a secret: details whose key looks like
a secret are dropped before they're stored (`scrubDetails`).

| Test | Checks | Status meaning |
| --- | --- | --- |
| `platform_mfa` | Passkeys required for the Dev console, and every active admin has one | Fails while `PLATFORM_MFA=off` |
| `city_mfa` | Each organization requires a passkey (or MFA SSO) for HR administrators | Warns: the city's choice |
| `rls` | Every table with a `tenantId` has row-level security on, a policy, and (except FH's cross-city records) forced; every table in `db/rls.sql` exists with RLS on | |
| `db_role` | The app's role isn't a superuser, can't bypass RLS, has no schema rights, owns no tables | |
| `kek` | AWS KMS with no local key, the key in a Canadian region (read from its ARN, else `AWS_REGION`); production fails without KMS; a 32-byte local key elsewhere | Warns in development |
| `jwt_secret` | Length, variety, not a development value (only the length and the number of distinct characters are recorded) | |
| `security_headers` | HSTS (production), CSP, frame, sniffing, referrer headers on `/healthz` (`TRUST_SELF_URL` checks the deployed address) | Warns without HSTS outside production |
| `db_tls` | `sslmode=require/verify-*` on the database URL | Warns in development |
| `readiness`, `outbox` | `/readyz` in strict mode: database, worker heartbeat, email/text backlog | |
| `error_tracking`, `metrics_token` | `SENTRY_DSN`, `METRICS_TOKEN` set | `error_tracking` fails until a vendor is chosen |
| `data_residency` | The configured `AWS_REGION` is Canadian (production also refuses to start otherwise) | |
| `backup_evidence`, `restore_evidence` | A backup confirmation in the last 8 days, a restore test in the last 35 | Manual evidence: the app has no backup job of its own |
| `retention_job` | The retention job finished in the last 25 hours (`WorkerJobRun`, which the worker now writes for every job) | |
| `audit_log` | The role the app connects as can't update or delete `AuditLog` (cities) or `PlatformAudit` (Dev console); an entry in the last 24 hours | Warns on a quiet day |
| `dependency_audit` | The latest recorded CI security run (evidence of kind CI on VM-01) passed and is under 8 days old | Warns with none: record the `Security` workflow's result; there is no network secret to read GitHub |
| `stale_admins`, `offboarded_admins` | Console accounts unused for 90 days; disabled accounts with an open session | |
| `api_key_age`, `webhooks_failing` | Organizations' API keys over a year old; webhook endpoints failing or turned off | Warn: the organization acts |
| `vendor_reviews`, `policy_acks`, `risks_overdue`, `commitments_overdue`, `evidence_overdue` | Overdue reviews, expired documents, unpublished or unaccepted policies, late risk treatments, late commitments and evidence | |

**Control status**: a manual status wins; any failing or broken test makes it *Failing*; a warning, a
test not yet run, or evidence missing or older than the control's window makes it *Needs evidence*;
otherwise *Passing*. Controls with no tests need evidence at least once.

**Readiness** per framework: each requirement scores the share of its applicable controls passing;
requirements with no control count as gaps; not-applicable ones are left out. **Posture score**: the
share of in-scope controls passing, with "needs evidence" counting half. Neither is a certification:
exports and Present mode say "preparing" and "self-assessed" until an auditor's report is on file.

Manual work stays manual: backup confirmations, restore tests, pen tests, training records, access
reviews, vendor documents and every customer commitment are entered by people, with reminders.

## Alerts and reminders

- A test that starts failing raises one alert (and one when it recovers), emailed to the test's owner,
  or to every admin with `trust.manage` when it has none.
- Reminders 30, 7 and 1 days before, then once when overdue, for commitments (each recurrence),
  vendor reviews and DPA/SOC 2/ISO expiry, evidence requests, risk treatments and policy reviews; a
  newly published policy gives each admin 14 days to accept it. Each (item, due date, offset) is sent
  once (`TrustReminder`), so several workers never double up.
- History: test runs (a row on each change, at most one an hour otherwise), hourly posture snapshots
  and alerts are kept 400 days, then removed by the hourly `trust-prune` job.

## Permissions and audit

`PlatformAdmin.permissions`: `trust.read` sees Trust, `trust.manage` changes it. Every existing admin
was given both, and a new admin gets both by default (the column's default); there is no screen to
narrow them yet, so a read-only admin is set in the database. Accepting a policy and marking the
alert feed read need only `trust.read` (the feed's read state is shared). Downloading the auditor
bundle needs `trust.manage`. An integration test checks every Trust route carries one of the two. Every change is written to
`PlatformAudit` as `trust.*`. Exports (auditor bundle, posture summary) and opening an evidence file
need a passkey confirmation from the last 10 minutes and are audited. Row-level security keeps every
Trust table out of any city's transaction (`fh_only_tables` in `db/rls.sql`).

## Running an audit with it

1. Set the scope (Overview › frameworks) and owners for every control and test.
2. Publish the policies (approve, then publish) and have every admin accept them.
3. Close the gaps the Frameworks view lists; upload evidence for each evidence-backed control; record
   the CI security run weekly, backup confirmations weekly and the restore test monthly.
4. Review risks quarterly and vendors yearly (reminders come on their own).
5. Export the auditor bundle per framework (Frameworks › Auditor bundle): a ZIP with the
   requirement-to-control map, controls and statuses, the evidence index with SHA-256s, the latest
   test results and 12 months of history, policies, risks and vendors. Give the auditor files from
   the Evidence section as they ask.
6. When the report arrives, upload it as evidence on GV-03 with "audit report" in its title; only then
   may the summary say anything beyond "preparing".

## Development

`node --env-file-if-exists=.env --import tsx prisma/seedTrustDemo.ts` (in `apps/api`, development
only) fills Trust with sample activity: published policies, evidence, vendor dates, commitments for
the demo organizations and a backfilled trend. The control library is `services/trust/library.ts`
(`LIBRARY_VERSION`); its unit test checks every mapping and that SOC 2, ISO 27001, PIPEDA and Law 25
requirements are all covered by at least one control.
