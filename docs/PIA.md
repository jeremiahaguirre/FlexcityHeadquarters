# Privacy impact assessment (template, pre-filled)

For each city to complete before go-live, and to update before turning on a new feature that
collects personal information (for example lone-work check-ins, payroll, fleet, or programs for
children). Structure follows BC's FIPPA PIA and Ontario's IPC guidance; Quebec public bodies must
complete one under the Access Act (s. 63.5) and Law 25 before acquiring the system. Facts below
describe the product; the city adds its own purposes, authorities and decisions.

## 1. The initiative

- **What:** FlexcityHeadquarters, a hosted system for scheduling, timekeeping, payroll and HR for
  municipal staff, and registration for recreation programs.
- **Who is responsible:** the city (public body / employer). FlexcityHeadquarters is a service
  provider acting on the city's instructions.
- **Features the city turns on:** list them (the Dev console's feature switches). Each adds the
  information in section 2 marked with it.

## 2. Personal information

| Category | Examples | Feature | Sensitive? |
| --- | --- | --- | --- |
| Identity and contact | Name, work email, phone, employee number, language | Always | — |
| Employment | Positions, hire and seniority dates, availability, schedule, certifications | Always | — |
| Time and attendance | Punch times, on-site status and distance (no coordinates), attendance events | Timeclock | — |
| Pay | Pay rates, deductions, TD1 claims, home mailing address, SIN, bank account | Payroll | **Yes** (SIN, banking sealed with the city's key) |
| HR files | Reviews, training, onboarding, conduct notes, discipline, grievances | HR suite | **Yes** |
| Health | Accommodation limits (no diagnosis), injury claims, medical notes (HR only), care check-ins after critical incidents | Accommodation, injury, documents, care | **Yes** |
| Location | Working-alone location the person chooses to share during a session: latest position only, while the app is open (deleted when sharing is turned off, otherwise after 30 days) | Lone work | **Yes** |
| Device push addresses | Browser push endpoint and keys for devices where the person turned notifications on | Notifications | No |
| Pay changes and orders | Salaries, one-time payments and deductions, court and CRA orders (payee, reference, amounts) | Payroll | **Yes** (orders can reveal family or debt matters; HR and payroll only) |
| Signed agreement | Version and language seen, typed name, drawn signature, notification and location choices, time, device address and browser | Always (first sign-in) | No — kept as evidence, can't be changed |
| Union | Union membership (HR, discipline writers), union hub content (union only) | Union hub | **Yes** |
| Public: families and children | Guardian contacts, children's names, ages, safety notes | Programs | **Yes** (minors) |

## 3. Authority and purpose

- [city] Authority to collect (e.g. MFIPPA s. 28(2): necessary to the proper administration of a
  lawfully authorized activity; BC FIPPA s. 26(c); Alberta POPA; Quebec Access Act s. 64).
- Purposes: scheduling and paying staff, meeting employment-standards, OHS and tax obligations,
  managing HR records, delivering programs. No other use; no sale; no automated decisions about
  people (attendance figures are advisory, Law 25 s. 12.1).

## 4. Information flows

1. Staff and HR enter information in the browser (TLS 1.2+, HSTS, strict content security policy).
2. Stored in Canada (AWS `ca-central-1`; backups `ca-west-1`), each city isolated by row-level
   security; sensitive fields additionally sealed with the city's own KMS key.
3. Leaves the system only when the city sends it: the bank deposit file (city's SFTP), T4/RL-1/ROE
   files (uploaded by the city to CRA, Revenu Québec, Service Canada), payroll provider exports,
   emails to staff. See [SUBPROCESSORS.md](SUBPROCESSORS.md).
4. FH staff can't see employee records; support visits need the city's consent, are read-only and
   never open individual records.
5. At first sign-in each person reads the information and consent agreement
   (`apps/api/src/services/privacy/consent.ts`, EN/FR, versioned), chooses notifications and
   location separately (the device's own prompts), and signs. The `ConsentRecord` keeps the version,
   language, SHA-256 of the exact text, typed name, signature image and its SHA-256, choices, time,
   IP address and browser. The application role has no UPDATE on the table and no route deletes it.
   FH keeps the evidence in the Dev console (city → Signed agreements): a list, a CSV, and a PDF
   certificate per record that re-checks both fingerprints; each export is in the platform audit log.
   A new version (bump `CONSENT_VERSION`) is signed again at the next sign-in.

## 5. Risks and mitigations

| Risk | Mitigation in the product | City's part |
| --- | --- | --- |
| Someone sees more than they need | Role-based access with department scope; HR-only categories; reviewed role by role ([SECURITY-LEGAL-AUDIT.md](SECURITY-LEGAL-AUDIT.md) §5A) | Assign roles carefully; review access yearly |
| Account takeover | MFA (HR by default, any access level by choice), passkeys, SSO, lockout, rate limits, common-password block | Require MFA broadly; use SSO |
| Insider misuse | Audit log of changes and of views of sensitive records; no self-approval anywhere in pay or HR | Review the audit log; act on misuse |
| Breach at the provider | Encryption in transit and at rest, per-city keys, Canadian hosting, tested backups, incident runbook | Contract terms: breach notice, audits |
| Over-collection / monitoring | No continuous tracking; clock-in keeps on-site status only; signed agreement at first sign-in with separate notification and location choices; notice in the app ("Your privacy") and [ELECTRONIC-MONITORING.md](ELECTRONIC-MONITORING.md) | Written monitoring policy (Ontario ESA Part XI.1) |
| Kept too long | Retention schedule ([RETENTION.md](RETENTION.md)), automatic anonymization and deletion | Set periods to the records by-law |
| Children's information | Collected only for registration; instructors see only their class list; families' files logged; inactive families anonymized | Program terms and consent wording |

## 6. Residual risk and sign-off

- Residual risks the city accepts: [city]
- Reviewed by: privacy officer [name, date]; IT security [name, date]; HR [name, date].
- Review again: yearly, and before enabling a new feature listed in section 2.
