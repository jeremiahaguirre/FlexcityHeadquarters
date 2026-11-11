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
| Sign-in | A one-way hash of the password (12–128 characters; common passwords and ones built from the person's name, email or organization refused); passkeys' public keys and device labels; sign-in codes by email or text kept only as a keyed HMAC (10 minutes, 5 tries, deleted 30 days after they expire); when each session started and whether it used a second factor (deleted 30 days after it ends). At sign-in the device's internet address is kept only in rate-limit counters (about a day) and the browser isn't stored | Always | No |
| Employment | Positions, hire and seniority dates, availability, schedule, certifications, who the person reports to (it routes approvals; it gives the manager no extra access) | Always | — |
| Time and attendance | Punch times, on-site status and distance (no coordinates), attendance events; which kiosk a punch came from, and a hashed kiosk PIN; for punches made without signal, the phone's punch id, when it reached the server and the phone's clock difference (the punch waits on the phone until sent) | Timeclock | — |
| Emergency contacts | Names, relationship and phone numbers of up to three people outside work (third parties, who aren't told by the app) | Always | **Yes** (seen by the person, HR, and a working-alone monitor only once a session escalates or help is asked for; every look by someone else audited) |
| Mobile number for alerts | A confirmed mobile number, whether the person wants last-minute shift texts, and the outbox of texts and calls (contents only until sent); the person can also choose to get sign-in codes at that number | Text alerts | No (sent to the text provider, see [SUBPROCESSORS.md](SUBPROCESSORS.md)) |
| Calendar feed | A hash of the person's private link; the feed shows only their own shifts (times, position, facility), no other names | Always (the person chooses) | No |
| Expenses | Claims, kilometres driven, receipts (encrypted like other documents) | Expenses | No |
| Time in lieu | Each person's choice to bank overtime (time-stamped), balances, HR corrections with reasons | Payroll | No |
| Pay | Pay rates, deductions, TD1 claims, home mailing address, SIN, bank account | Payroll | **Yes** (SIN, banking sealed with the city's key) |
| HR files | Reviews, training, onboarding, conduct notes, discipline, grievances | HR suite | **Yes** |
| Health | Accommodation limits (no diagnosis), injury claims, medical notes (HR only), care check-ins after critical incidents | Accommodation, injury, documents, care | **Yes** |
| Location | Working-alone location the person chooses to share during a session: latest position only, while the app is open (deleted when sharing is turned off, otherwise after 30 days) | Lone work | **Yes** |
| Device push addresses | Browser push endpoint and keys for devices where the person turned notifications on | Notifications | No |
| Pay changes and orders | Salaries, one-time payments and deductions, court and CRA orders (payee, reference, amounts) | Payroll | **Yes** (orders can reveal family or debt matters; HR and payroll only) |
| Signed policies | Typed name, time, and a fingerprint of the policy text signed | HR suite | No (kept as evidence, can't be changed) |
| Logbook and announcements | Handover, maintenance and safety notes per facility (author, time); who read each announcement | Logbook, Announcements | No (logbook entries can't be changed) |
| Job applicants | Name, email, phone, message, certifications typed in, a PDF résumé (encrypted with the city's key), HR's notes and stage | Jobs | No (public; deleted a year after the last change unless hired) |
| T4A payees | Contractors and honoraria recipients: name or business, SIN or business number, address, amounts by box | Payroll | **Yes** (SIN sealed with the city's key, last 3 digits shown; full SIN only in the T4A XML, with a passkey, audited) |
| Signed agreement | Version and language seen, typed name, drawn signature, notification and location choices, time, device address and browser | Always (first sign-in) | No — kept as evidence, can't be changed |
| Union | Union membership (HR, discipline writers), union hub content (union only) | Union hub | **Yes** |
| Public: families and children | Guardian contacts, children's names, dates of birth (for age-based levels), safety notes; the guardian's confirmation that they are of the age of majority and the child's parent or guardian, with the time and a fingerprint of the terms shown (audit log) | Programs | **Yes** (minors) |
| Applicants' age | An age range only ("16 or older" or "14 or 15"); for 14–15, a parent's or guardian's name and consent. No date of birth | Jobs | No |

## 3. Authority and purpose

- [city] Authority to collect (e.g. MFIPPA s. 28(2): necessary to the proper administration of a
  lawfully authorized activity; BC FIPPA s. 26(c); Alberta POPA; Quebec Access Act s. 64).
- Purposes: scheduling and paying staff, meeting employment-standards, OHS and tax obligations,
  managing HR records, delivering programs. No other use; no sale; no automated decisions about
  people (attendance figures are advisory, Law 25 s. 12.1). The attendance score is derived on read from
  attendance events, completed punches and commendations already held; it recovers with good attendance
  and older events fade (or it restarts yearly on a date HR chooses), every change is explained to the
  employee, sick days and protected leave never count, and nothing is deleted to produce it.

## 4. Information flows

1. Staff and HR enter information in the browser (TLS 1.2+, HSTS, strict content security policy).
2. Stored in Canada (AWS `ca-central-1`; backups `ca-west-1`), each city isolated by row-level
   security; sensitive fields additionally sealed with the city's own KMS key.
3. Leaves the system only when the city sends it: the bank deposit file (city's SFTP), T4/RL-1/ROE
   files (uploaded by the city to CRA, Revenu Québec, Service Canada), payroll provider exports,
   emails to staff, the city's own systems through its API keys and webhooks (scoped; no SINs, bank, health or
   date-of-birth fields; webhook messages carry ids only; see [PUBLIC-API.md](PUBLIC-API.md)). A key reads by default;
   the city can give a key write scopes so its HRIS or ERP sends in people, departments, positions and time off. Those
   writes can't include SIN, bank, pay, birth-date or health details, never delete anything, follow the same rules as
   the app (an end of employment starts offboarding; time off is pending unless the key may send it approved), and are
   audited with the key as the actor. A person's preferred name and an external id (the city's own HRIS id) can be
   stored for this; both are part of their record, covered by the same retention and erasure as the rest of it. Where the city turns text alerts on, urgent texts and calls, and sign-in codes by text for people who choose them, go through the text provider (the number and the message's words; no links). See [SUBPROCESSORS.md](SUBPROCESSORS.md).
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
| Account takeover | MFA (HR by default, any access level by choice): a passkey, or a one-time code by email or text unless the organization allows passkeys only; SSO, lockout, rate limits, common-password block | Require MFA broadly; use SSO |
| Insider misuse | Audit log of changes and of views of sensitive records; no self-approval anywhere in pay or HR | Review the audit log; act on misuse |
| Breach at the provider | Encryption in transit and at rest, per-city keys, Canadian hosting, tested backups, incident runbook | Contract terms: breach notice, audits |
| Over-collection / monitoring | No continuous tracking; clock-in keeps on-site status only; signed agreement at first sign-in with separate notification and location choices; notice in the app ("Your privacy") and [ELECTRONIC-MONITORING.md](ELECTRONIC-MONITORING.md) | Written monitoring policy (Ontario ESA Part XI.1) |
| Kept too long | Retention schedule ([RETENTION.md](RETENTION.md)), automatic anonymization and deletion | Set periods to the records by-law |
| Other people's details (emergency contacts) | Kept only for emergencies; a monitor sees them only once a session escalates; deleted as soon as erasure is requested | Tell staff to ask their contacts first |
| Applicants' information | Short privacy notice the applicant agrees to; résumés encrypted, each download logged; deleted a year after the last change unless hired | Review the notice; a public body keeps information used for a decision at least a year |
| Shared kiosk tablets | No one's details stay on screen; PINs hashed, easy ones refused; a number locks for 15 minutes after 5 wrong PINs; removing a kiosk stops it at once | Mount tablets where the screen can't be overlooked |
| Children's information | Entered only by an adult who confirms the age of majority and that they are the parent or guardian (enforced by the API); collected only for registration; instructors see only their class list; families' files logged; inactive families anonymized | Program terms and consent wording |

## 6. Residual risk and sign-off

- Residual risks the city accepts: [city]
- Reviewed by: privacy officer [name, date]; IT security [name, date]; HR [name, date].
- Review again: yearly, and before enabling a new feature listed in section 2.
