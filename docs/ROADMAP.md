# Roadmap

## Before the first customer

- [ ] **Legal review of provincial rules** (see `COMPLIANCE.md` checklist); flip `verified` per province.
- [ ] Push notifications (web push / FCM). In-app notifications (live over SSE) and email already work.
- [ ] SSO (SAML / Entra ID) for municipal tenants.
- [ ] Subprocessor list and data-residency assessment.
- [ ] Union Hub as its own deployment. Today the API mounts its routes when `UNION_DATABASE_URL` is set; the database role and per-local keys already keep employers out.
- [ ] Translate payroll export problems and warnings (currently English-only text from the API).

## Next

- [ ] Demand generation from facility hours, lesson registrations and bather-load history.
- [ ] Bulk staff import (CSV) for onboarding a new organization.
- [ ] Creating pools from Settings or the Dev console (thresholds are editable; new pools are added by support today).
- [ ] Dev console: disable or offboard an organization, and "view as" support access with the city's consent.
- [ ] Passkey step-up for the Dev console's most sensitive actions (today: adding/removing passkeys needs a sign-in from the last 10 minutes).

## Later

- [ ] Constraint-solver scheduling (OR-Tools CP-SAT in a Python worker) behind the existing `proposeSchedule` input/output types, for multi-facility terms.
- [ ] Direct integrations with payroll providers (ADP, Ceridian Dayforce, Wagepoint) in addition to CSV, for cities that keep one.
- [ ] FH books: verify the chart of accounts, sales tax treatment and the PAD transaction code with FH's accountant and bank before the first live debit.
- [ ] Payroll: tax tables for MB, NB, NL, NS, NT, NU, PE, SK and YT (federal, AB, BC and ON ship as unverified starting values); T4 XML and ROE Web XML export; Ontario's low-income tax reduction.
- [ ] Search-engine-friendly job pages (server-rendered, structured data).

## Done

- Shift board with eligibility reasons, overtime approval and optimistic locking; schedule builder with assistant; my schedule.
- Availability, time off, timeclock with geofence, punch review; chemical readings and closure workflow; incidents with sealed narratives.
- Staff directory, invitations, roles, pay rates, verified certifications, discipline records with signature capture.
- Login lockout and rate limits, password reset by email.
- Payroll CSV export with overtime, statutory holiday pay and vacation pay.
- In-house payroll: pay runs for the whole city or one department, CPP/CPP2/EI and federal and provincial income tax (T4127 method, yearly tables FH verifies before use), pay statements, CPA-005 direct deposit files, PD7A remittance totals, T4 slip figures and ROE figures. Two-person approval and passkey release by default; bank accounts and SINs sealed with the city's key.
- Bank connection: approved pay runs sent to the city's bank over SFTP (host key pinned, optional PGP encryption), automatically or by hand, with the credentials sealed with the city's key.
- Benefits and deductions: pension (RPP), health, dental, life, disability, EAP and union dues, with employee and employer shares, taxable benefits, and T4 boxes 20, 40 and 44; amounts owed to each provider by month.
- Payroll accounting: each approved run as a balanced general-ledger journal by department segment (CSV), and labour cost against each department's budget.
- HR departments: an HR home with a card per area; leave balances with entitlements and carry-over; performance reviews (self-assessment, reviewer rating, acknowledgement); training courses required by position with renewal and a due list; a numbered grievance log with steps, deadlines and history; offboarding checklist that ends benefits and sign-in.
- Plan charges by pre-authorized debit: business PAD agreements (Payments Canada Rule H1) authorized by the city in the app or entered from a signed form; the invoice is the debit notice; CPA-005 debit files for FH's bank, settlement and returns.
- FH's books: a general ledger built from billing (invoices, voids, payments, returned debits, credit notes, write-offs) plus manual entries; trial balance, income statement, receivables aging, sales tax to remit, revenue by month and organization, chart of accounts and closed periods.
- Settings: organization, facilities, pay codes, school calendar, collective-agreement overrides, pool thresholds.
- Offline-first instructor attendance; certification reminders at 90/60/30/7 days; nightly reliability recalculation.
- Union Hub: discussions, seniority list, membership managed by stewards.
- Job postings and a public careers page.
- Menus tailored to each role (a union steward sees only the Union hub; HR doesn't see personal shift screens).
- FH Dev console: create cities, fifteen feature switches, facilities, positions, city logo upload, CSV staff import with preview.
- City logo beside the FH logo on sign-in, in the app and on the careers page.
- Passkeys (Windows Hello, Face ID / Touch ID, Android biometrics) for sign-in and a "confirm it's you" step before sensitive changes.

## Deliberately out of scope

- Quebec payroll withholding (QPP, QPIP, Revenu Québec) and RL-1 slips: Quebec staff stay with a payroll provider (the CSV export still works).
- Filing with government directly: T4 XML (Internet File Transfer), ROE Web XML and PD7A payments are prepared in FH and filed by the city.
