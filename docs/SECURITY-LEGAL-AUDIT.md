# Security and legal audit

**Date:** 9 November 2026
**Scope:** the FlexcityHeadquarters API (`apps/api`), web app (`apps/web`), marketing site (`apps/site`), database schema and row-level security, CI, and the product's fit with Canadian federal, provincial and municipal law.
**Method:** code and configuration review, automated tests added for each control, dependency audit, and a legal mapping by jurisdiction.

> **Not legal advice.** This is an engineering review written to help counsel. Every legal statement here should be confirmed by a Canadian lawyer before a contract is signed or the product goes live. Items marked **[verify]** are ones where the law has changed recently or the reviewer was unsure.

---

## 1. Summary

The application's design is strong on privacy:

- Each city's data is isolated by the database's row-level security.
- Sensitive records (incident narratives, union content) are encrypted.
- Audit logs cannot be edited.
- Decisions about people are always made by a person.

This audit fixed four security gaps and added one legal capability. The remaining work is mostly operational (hosting, backups, monitoring) and contractual (agreements, privacy impact assessments, an accessibility conformance report). Those can't be done in code.

| | Count |
| --- | --- |
| Fixed during this audit | 6 |
| Open, high priority before launch | 6 |
| Open, medium | 8 |
| For counsel | 12 |

---

## 2. Fixed during this audit

| # | Finding | Fix | Commit |
| --- | --- | --- | --- |
| F1 | A terminated, deactivated or erasure-restricted person kept a valid access token for up to 15 minutes. | Every request checks the person is still active (30-second cache, cleared when HR changes their status). | `6bfa28f` |
| F2 | The API sent no anti-framing or content-security headers; the web app could be framed (clickjacking). | API: `X-Frame-Options: DENY`, `default-src 'none'; frame-ancestors 'none'`, CORP, HSTS in production. Web: `frame-ancestors 'none'`, `base-uri`, `form-action`, `object-src`, HSTS in production. | `6bfa28f` |
| F3 | Nothing stopped a future table holding city data from shipping without row-level security. | A test reads the schema and fails if any table with a `tenantId` lacks enabled and forced RLS, or if the app role can update or delete the audit logs. | `a76f3e0` |
| F4 | Known vulnerabilities in Express (body-parser, path-to-regexp, qs) and SimpleWebAuthn (attestation chain). | Upgraded to Express 4.22.3 and SimpleWebAuthn 13.3.3. Dependabot and a CI audit step added. | `f54c292` |
| F5 | No way to gather a person's records for a privacy access or freedom-of-information request. | HR can export everything held about a person (union content and sealed narratives excluded and listed), with a fresh sign-in, logged. | `beb6213` |
| F6 | Three tests failed or passed depending on the time of day. | Test shifts now start at a fixed hour. | `7e7ca48` |

---

## 3. Open findings

Severity reflects risk to cities and their staff if the product launched today.

### High: before the first city goes live

| # | Finding | Recommendation |
| --- | --- | --- |
| H1 | **Multi-factor sign-in is offered (passkeys) but not required**, including for HR, supervisors and the Dev console, which can reach every city. | Require a passkey or second factor for the Dev console now, and for HR and payroll roles by default (a city setting). Add SSO (SAML / Entra ID), which most cities will require anyway. |
| H2 | **Next.js 14.2.15 has a critical advisory** (Server Actions denial of service; dev-server information exposure). Exposure is low: the app uses no Server Actions and the dev server is never deployed. | Upgrade the web app and the site to a patched Next.js major (15 or 16) and re-test. |
| H3 | **Zod 3 has a high advisory** (memory exhaustion on oversized constrained collections). Mitigated: request bodies are capped at 100 KB and lists have maximum lengths. | Upgrade to Zod 4 when the validation code is next reworked. |
| H4 | **Sign-in rate limiting is in memory per server.** With more than one API instance, the limit multiplies, and it resets on restart. | Move the limiter to a shared store (Redis or the database) or enforce it at the load balancer or WAF. |
| H5 | **No production hosting, backups or monitoring exist yet.** The app is ready for `ca-central-1` and refuses non-Canadian regions, but nothing is deployed. | Follow [SECURITY-OPERATIONS.md](SECURITY-OPERATIONS.md): encrypted, immutable backups with tested restores, centralised logs and alerts, WAF. |
| H6 | **Employment-standards rule values are unreviewed** (`verified: false` everywhere; payroll shows a warning). | Have Canadian employment counsel review `provincialRules.ts` against [COMPLIANCE.md](COMPLIANCE.md) before any production payroll. |

### Medium

| # | Finding | Recommendation |
| --- | --- | --- |
| M1 | Discipline acknowledgements store the signature image and time but no hash of what was signed. Reliability under the Electronic Commerce / Transactions Acts is stronger if you can show the record wasn't changed after signing. | At signing, store a SHA-256 hash of the record (summary, level, evidence) and show it on the record. |
| M2 | Personal records have no export format other than JSON. | Add a printable PDF of the records export for FOI and access responses. |
| M3 | No published Accessibility Conformance Report (VPAT 2.5 / EN 301 549). Ontario and BC municipalities increasingly require one in procurement. | Commission an independent WCAG 2.1 AA audit and publish the ACR. |
| M4 | Subprocessors (email, push notifications, error tracking) are not chosen or listed. | Choose Canadian-hosted or contractually bound providers; publish a subprocessor list; include it in privacy impact assessments. |
| M5 | No content security policy for scripts on the web app (only framing, base and form limits). | Add a nonce-based `script-src` CSP once the Next.js upgrade lands. |
| M6 | The Dev console has no IP allow-list. | Restrict `/api/platform` to the company VPN or known IPs at the load balancer. |
| M7 | Website legal pages (privacy, terms, accessibility) are drafts. | Counsel review before launch (they are marked as drafts on the site). |
| M8 | No retention schedule for logs, notifications and email outbox records. | Set retention per city (for example, purge notifications after 2 years, outbox after 90 days), aligned with each city's records by-law. |

---

## 4. Security controls by area

Status values:

- **App**: the product provides it.
- **Ops**: whoever hosts the product must do it (the vendor, or the city if self-hosted).
- **City**: the customer's own programme.

### 4.1 Daily and operational health checks

| Check | Status | Notes |
| --- | --- | --- |
| Threat intelligence for zero-days and active exploits | Ops | Dependabot (weekly) and the CI audit cover dependencies. Subscribe to GitHub advisories, the Canadian Centre for Cyber Security (CCCS) alerts and the vendors' bulletins (AWS, Node.js, Next.js, PostgreSQL). |
| SIEM alerts and anomalies (traffic spikes, failed logins, exfiltration) | App + Ops | The app writes the signals: failed sign-ins, account lockouts, audit log of sensitive actions and every records export. Ship API and load-balancer logs to CloudWatch or a SIEM; alert rules are in the runbook. |
| Endpoint security (anti-malware, EDR) | City + Ops | Laptops and servers of anyone with admin access: the vendor's own staff and city HR. Not something a web app controls. |
| Backup verification | Ops | Runbook: nightly automated snapshots, point-in-time recovery, weekly full copy to a separate account with object lock (immutable), monthly restore test with a recorded result. |

### 4.2 Infrastructure and system hardening

| Check | Status | Notes |
| --- | --- | --- |
| Patch management (48 hours for critical CVEs) | App + Ops | Dependabot, CI audit; target windows in the runbook. Open items: H2, H3. |
| Who has administrative privileges | App | Permissions are role-based and checked on every request. The Dev console shows and toggles each role's access per city, and every change is audited. Run a quarterly access review (runbook). |
| MFA enforced globally | **Open (H1)** | Passkeys available; not yet required. |
| Terminated employees de-provisioned instantly | App (fixed, F1) | Status change revokes refresh tokens and blocks the next request. Dev console admins: remove in `PlatformAdmin`; their sessions are server-side and end immediately. |
| Cloud configuration drift (exposed buckets, open security groups, over-privileged accounts) | Ops | No buckets are needed; logos are stored in the database. Use AWS Config / Security Hub with the CIS benchmark; the database is private-subnet only; the app role has no DDL rights and can't edit audit logs. |
| Network perimeter (firewall, IPS, API gateway) | Ops | Load balancer with WAF (AWS managed rules + rate rules), TLS 1.2+, the Dev console behind an IP allow-list (M6). The API already refuses cross-site requests: strict same-site cookies and CORS limited to the marketing site's address for the enquiry form. |

### 4.3 Governance, risk and compliance

| Check | Status | Notes |
| --- | --- | --- |
| Regulatory alignment | This report | SOC 2 Type II and ISO 27001 are commercial, not legal, requirements, but many cities ask for them. Plan a SOC 2 readiness assessment in year one. GDPR, HIPAA and PCI DSS do not apply: no EU residents' data is targeted, no health-insurance data, and no card data is stored (invoices are paid by EFT or cheque). |
| Third-party / vendor risk | Ops | Subprocessor list (M4); AWS's Canadian attestations; annual review of each provider's SOC 2 report. |
| Policy review timelines | City + Ops | Annual review of acceptable use, remote work, data retention, incident response and this audit (runbook calendar). |

### 4.4 Human risk and incident readiness

| Check | Status | Notes |
| --- | --- | --- |
| Phishing simulation metrics | City + Ops | Outside the app. Passkeys (phishing-resistant) reduce the impact; requiring them (H1) is the best in-app control. |
| Incident response playbook | Ops | Runbook includes a playbook and a ransomware tabletop scenario, plus breach-notification duties by law (section 5.6). |
| Business continuity and disaster recovery | Ops | Targets in the runbook: RPO 15 minutes, RTO 4 hours; multi-AZ database; restore drills. The deck works briefly offline for attendance; paper fallback forms for headcounts and chemistry are in the runbook. |

### 4.5 Strategic and board-level metrics

| Metric | How it's measured |
| --- | --- |
| Security spend vs. risk reduced | Track open findings by severity each quarter (this table) against spend. |
| MTTD / MTTR | Measure from alert to acknowledgement and to fix; targets in the runbook (critical: detect under 1 hour, contain under 4 hours). |
| Shadow IT | City-side; the app helps by replacing spreadsheets and paper logs with one audited system. |

### 4.6 Application controls already in place

| Control | Detail |
| --- | --- |
| Tenant isolation | PostgreSQL row-level security, enabled and forced on every city table, with the app connecting as a non-owner role; a test fails if a table is missed. |
| Passwords | scrypt with per-user salt; lockout after 5 failures; reset links expire in 1 hour; invitations in 7 days. |
| Sessions | 15-minute access tokens; 14-day refresh tokens rotated on use with reuse detection (a reused token revokes the family); HTTP-only, `SameSite=Strict`, secure cookies. |
| Step-up | Payroll export, pay rates, role changes, erasure, records export, suspensions and terminations, passkey changes need a sign-in within 10 minutes. |
| Encryption | TLS in transit; incident narratives and Union Hub content encrypted with envelope encryption (per-local keys for the union; AWS KMS in production). |
| Audit | Append-only audit log (the app can't update or delete it), incident access log with stated purpose, Dev console actions logged twice. |
| Input handling | Every request body validated (zod), 100 KB body limit, no raw SQL, uploads checked by magic bytes (PNG, JPEG, WebP only; SVG refused). |
| Least privilege | Permission-based routes; feature switches and per-role overrides enforced server-side, not just hidden in the menu. |
| Privacy by design | No SIN, banking details or police-check results stored; date of birth only for young-worker rules; location only at the moment of clocking in; diagnosis never stored for accommodations; care check-ins record only that they happened. |

---

## 5. Legal mapping

### 5.1 Privacy: who is responsible

When a city uses the app, **the city is responsible for its employees' information** under its province's public-sector privacy and FOI law. FlexcityHeadquarters acts as its **service provider** and processes data only on the city's instructions. That relationship must be written into the subscription agreement: purpose limits, security, breach notice, subprocessors, return and deletion at end of contract, and audit rights.

For private employers, the employer is responsible under the private-sector law that applies to it (table 5.8).

### 5.2 Freedom of information and access to one's own records

| Requirement | How the app supports it |
| --- | --- |
| Search and produce records responsive to an FOI request | Records export per person (F5); payroll and punch exports; the compliance report for a past moment; incident list (metadata) with sealed narratives opened with a stated purpose. |
| Sever third-party information before release | The export excludes and lists incident narratives (they name members of the public) and Union Hub content; the city reviews before release. |
| A person's right to see and correct their information | Employees see their own file (attendance, notes, records, restrictions, onboarding) and can add a written response; HR corrects or excuses with a reason that stays visible. |
| Retention and destruction | Payroll retention per city (default 7 years, meeting CRA's 6); erasure deferred until then with processing restricted immediately; records are never silently deleted. A city's records retention by-law should set the other periods (M8). |

### 5.3 Quebec: Law 25

| Obligation | Status |
| --- | --- |
| Person in charge of protecting personal information | City's duty; the product supports it with access logs and exports. |
| Privacy impact assessment before acquiring a system, and before communicating information outside Quebec | **For the city.** Provide them a PIA package: data map, flows, residency, subprocessors, safeguards (this report plus the runbook). |
| Decisions based exclusively on automated processing must be disclosed, with the person able to have it reviewed | None are made: scores and flags are advisory, and a person decides. This is stated on screen to staff and managers. |
| Confidentiality incidents: register, and notify the Commission d'accès à l'information and the people affected when there is a risk of serious injury | The vendor contract must require prompt notice to the city; the runbook covers the vendor side. |
| Privacy by default | Optional features (benchmarks, union hub) are off until switched on; benchmarks are anonymous and need at least five cities. |
| French | Everything in the app is available in French (a test enforces parity). Contracts of adhesion with Quebec customers must be offered in French first (Charter of the French Language, as amended by Bill 96). **[counsel]** |

### 5.4 Data residency

- The app is built for AWS `ca-central-1` and refuses to start in production with a non-Canadian region.
- **Nova Scotia's PIIDPA** restricts public bodies (including municipalities) from storing personal information outside Canada, with limited exceptions. **[verify]**
- **BC's FIPPA** previously required storage in Canada. The 2021 amendments allow disclosure outside Canada under conditions, including a privacy impact assessment and any regulations. Many BC municipalities still require Canadian residency by contract. **[verify]**
- **Quebec** requires a PIA before information leaves the province.
- **Backups, logs and subprocessors count too.** Keep backups in a second Canadian region (for example `ca-west-1`), and choose email, push and error-tracking providers that store data in Canada or are covered contractually (M4).
- **Foreign-law access** (for example US CLOUD Act exposure through a US-owned cloud provider) is a common question in municipal procurement. Counsel should prepare a standard answer. **[counsel]**

### 5.5 Employment standards, OHS and human rights

| Area | Status |
| --- | --- |
| Employment standards (overtime, rest, holidays, young workers) for all 13 jurisdictions | Built, effective-dated, with collective-agreement overrides; **values need counsel review (H6)**. |
| Payroll records | Exported for the city's payroll; the app is not a payroll provider and doesn't calculate deductions or issue T4 / RL-1 slips. |
| Occupational health and safety | Incident reports, care check-ins after critical incidents, rotation and fatigue limits, harassment-policy acknowledgement in onboarding. **Working-alone check-ins** (BC OHS Regulation, Alberta OHS Code Part 28, and others) are not built yet; see the municipal research. |
| Injury reporting | The app records incidents but doesn't file WSIB (Form 7, within 3 business days in Ontario), WorkSafeBC or other board reports. **[roadmap]** |
| Human rights and the duty to accommodate | Accommodation restrictions enforced by the scheduler without disclosing medical details; sick days and protected leave never count against anyone; fair-process prompts before discipline mention protected grounds. |
| Reprisal protections | Being named in an incident report never counts against anyone; conduct notes are written by a person and can be retracted. |
| Electronic monitoring (Ontario employers with 25 or more employees must have a written policy, ESA Part XI.1) | The app records location only at the moment of clocking in, and logs activity. **Cities need their own policy describing this**; the FAQ tells them so. |
| Vulnerable sector checks | Onboarding records only that the check was seen, when and by whom, never the result; positions with minors can require it before scheduling. |

### 5.6 Breach notification

| Law | Duty | Who |
| --- | --- | --- |
| PIPEDA | Report breaches posing a real risk of significant harm to the Privacy Commissioner and affected people; keep a record of all breaches for 24 months. | Private employers under PIPEDA. |
| Alberta PIPA | Notify the Commissioner without unreasonable delay where there's a real risk of significant harm. | Alberta private employers. |
| Quebec Law 25 | Register all incidents; notify the CAI and affected people when there's a risk of serious injury. | Quebec employers and public bodies. |
| Public-sector laws (MFIPPA, BC FIPPA, others) | Mandatory notification varies by province and has been expanding (BC requires notice for breaches that could reasonably cause significant harm). **[verify per province]** | Cities. |
| Vendor contract | FlexcityHeadquarters must notify the city promptly (target: within 24 hours of confirming an incident) with the facts needed for the city's own notices. | Vendor. |

### 5.7 Practice of law, delegation and automated decisions

- **Unauthorised practice of law.** The product is an administrative and productivity tool. It applies rules the city confirms, prompts for fair-process steps, and drafts documentation templates; it does not give legal advice. The app, website and FAQ all say so ("supports your compliance work but is not legal advice"; "have your discipline policy reviewed by counsel"). The discipline draft is an editable outline of facts, not a legal opinion. **[counsel to confirm the wording]**
- **Delegation of statutory powers.** Municipal councils and officers can't delegate statutory decisions to software. The app makes none:
  - pool closures are recommended and confirmed by a person;
  - flags, scores, overtime order, the forecast and suggested discipline steps are advisory;
  - onboarding and certification checks enforce requirements the city itself switched on.

  The app doesn't handle municipal approvals such as zoning or licensing.
- **Automated decisions about employees.** None are made exclusively by automated processing (Law 25 s.12.1). The app states this to staff in "How this works" and on every review screen.

### 5.8 Jurisdiction map

Public-sector privacy (municipalities), private-sector privacy (employers), electronic signatures and accessibility. **[verify]** each before contract; several have changed since 2023.

| Jurisdiction | Municipal privacy / FOI | Private employers | Electronic signatures | Accessibility |
| --- | --- | --- | --- | --- |
| Ontario | MFIPPA | PIPEDA (limited for employees) | Electronic Commerce Act, 2000 | AODA (WCAG 2.0 AA in law; 2.1 AA expected in procurement) |
| British Columbia | FIPPA | PIPA (BC) | Electronic Transactions Act | Accessible British Columbia Act |
| Alberta | Access to Information Act; Protection of Privacy Act (replaced FOIP in 2025) | PIPA (AB) | Electronic Transactions Act | None province-wide **[verify]** |
| Saskatchewan | LA FOIP | PIPEDA (limited) | Electronic Information and Documents Act, 2000 | Accessible Saskatchewan Act |
| Manitoba | FIPPA | PIPEDA (limited) | Electronic Commerce and Information Act | Accessibility for Manitobans Act |
| Quebec | Act respecting access to documents held by public bodies (Law 25) | Private Sector Act (Law 25) | Act to establish a legal framework for information technology | Act to secure handicapped persons in the exercise of their rights |
| New Brunswick | RTIPPA | PIPEDA (limited) | Electronic Transactions Act | Accessibility Act (2024) **[verify]** |
| Nova Scotia | Municipal Government Act Part XX; PIIDPA (residency) | PIPEDA (limited) | Electronic Commerce Act | Accessibility Act |
| Prince Edward Island | FOIPP Act **[verify coverage of municipalities]** | PIPEDA (limited) | Electronic Commerce Act | None **[verify]** |
| Newfoundland and Labrador | ATIPPA, 2015 | PIPEDA (limited) | Electronic Commerce Act | Accessibility Act |
| Yukon | ATIPPA (Yukon) **[verify municipal coverage]** | PIPEDA | Electronic Commerce Act | None **[verify]** |
| Northwest Territories | ATIPP Act (municipalities phased in) **[verify]** | PIPEDA | Electronic Transactions Act | None **[verify]** |
| Nunavut | ATIPP Act **[verify]** | PIPEDA | Electronic Commerce Act **[verify]** | None **[verify]** |
| Federal | n/a | PIPEDA (federally regulated works) | PIPEDA Part 2 (federal documents) | Accessible Canada Act |

**Governing law and courts.** The subscription agreement should follow the customer's province (courts of Ontario for an Ontario city, and so on); the website's own terms use British Columbia. Configure the agreement template per province. **[counsel]**

**How the app adapts by location.** Rules, statutory holidays and young-worker limits follow the facility's province. Language follows the person's choice, and the city's default for Quebec cities should be French. Privacy wording is generic so it fits any province. The legal basis is set by the agreement.

### 5.9 Electronic signatures in the app

- **Discipline acknowledgements:** the employee draws a signature, and the record stores the image, the time and an audit entry. It confirms receipt, not agreement, and the screen says so.
- **Policy acknowledgements in onboarding:** the employee types their name, and the record stores the typed name, the time and an audit entry.

These are meant to be reliable and retrievable under the provincial electronic commerce and transactions acts. To strengthen integrity, add a content hash at signing (M1). The app is not used for contracts, municipal permits, by-laws or corporate resolutions, and it does not file with corporate registries.

### 5.10 Procurement

- **Trade agreements.** Municipal technology purchases above the CFTA thresholds (and CETA's, for larger municipalities) need an open, competitive tender; amounts are indexed every two years. **[verify current thresholds]** Be ready to respond to RFPs, and offer cooperative purchasing (for example through Canoe, Kinetic GPO or a provincial supply arrangement) to make buying easier. **[counsel]**
- **Accessibility in procurement.** Ontario's AODA requires public bodies to consider accessibility in procurement, and BC is following. An Accessibility Conformance Report (M3) is the expected evidence.
- **Security questionnaires.** Cities will ask for:
  - this report;
  - the runbook;
  - the subprocessor list;
  - data residency;
  - SOC 2 status;
  - insurance (cyber and errors & omissions).

### 5.11 Marketing and anti-spam

- **CASL.** The website's contact form asks for express consent in a separate, unticked box and stores the wording and time. Any future marketing email must identify the sender and include an unsubscribe.
- **Competition Act.** Claims are factual and comparative only against common workarounds; no "first" or "only" claims are made. The competitor research (if published) must be kept as evidence for any comparative claim.
- **Website privacy notice, terms and accessibility statement:** drafts for counsel (M7).

---

## 6. For counsel

1. Review the employment-standards rule values (H6) and the overtime-equalization defaults.
2. Template subscription and data processing agreement per province: service-provider terms, breach notice, subprocessors, residency, audit, return and deletion, governing law.
3. Quebec: French-first contract, PIA support package, Law 25 incident duties.
4. Data residency representations, including foreign-law access questions.
5. Breach-notification duties per province for public bodies.
6. Wording of fair-process prompts and the discipline draft (unauthorised practice of law).
7. Electronic signature reliability for acknowledgements (M1).
8. Electronic monitoring policy guidance for Ontario cities.
9. Website privacy notice, terms and accessibility statement (M7).
10. Procurement thresholds and cooperative purchasing options.
11. Union hub: whether union-controlled content inside an employer-paid system raises labour-relations issues in any province.
12. Insurance: cyber liability and technology errors & omissions limits typical in municipal contracts.

See also: [SECURITY-OPERATIONS.md](SECURITY-OPERATIONS.md) (runbook), [COMPLIANCE.md](COMPLIANCE.md) (rules and privacy notes).
