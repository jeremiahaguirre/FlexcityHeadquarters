# Roadmap

## Before the first customer

- [ ] **Legal review of provincial rules** (see `COMPLIANCE.md` checklist); flip `verified` per province.
- [ ] **Legal review of the first-sign-in agreement** (`apps/api/src/services/privacy/consent.ts`, EN/FR) and the website's privacy page and terms.
- [ ] **Payroll provider API access**: each city gets API credentials from ADP (Marketplace, with its mutual-TLS certificate), Dayforce or Wagepoint, and FH confirms each provider's import endpoint and layout against the first real send (they're pre-filled from the providers' published addresses).
- [ ] **Revenu Québec**: FH's RL-1 software authorization number for the year, and the first RL-1 XML run through Revenu Québec's test service.

## Next

- [ ] Weather and special events in the forecast (it uses headcounts, opening hours and lesson registrations today).

## Later

- [ ] Constraint-solver scheduling (OR-Tools CP-SAT) behind the existing `proposeSchedule` types, if large multi-facility terms outgrow the hardest-first planner with its repair pass.
- [ ] FH books: verify the chart of accounts, sales tax treatment and the PAD transaction code with FH's accountant and bank before the first live debit.
- [ ] Payroll: FH verifies each year's tax tables against CRA's T4127 (all 13 provinces and territories and the federal table ship as unverified starting values); the basic personal amount phase-outs in Manitoba and Yukon.

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
- Single sign-on: Microsoft Entra ID (OpenID Connect) and SAML 2.0, existing accounts only, bound to the directory identity; can be made the only way in.
- Quebec payroll: QPP/QPP2, QPIP, Quebec EI rate, federal abatement, Quebec tax (TP-1015.F structure), Revenu Québec remittance and GL account, RL-1 slips and T4 boxes 17, 17A, 55 and 56.
- Filing files: T4 return as CRA XML and Records of Employment as ROE Web XML (full SINs only with a passkey, audited, refused while details are missing); home mailing address with the TD1.
- Payroll exports laid out for ADP Workforce Now, Ceridian Dayforce and Wagepoint.
- Dev console: turn a city off or on, offboard it with a retention period (billing records kept) and a full data export for the city until deletion, consent-based read-only support visits, passkey step-up for its most sensitive actions; website enquiries inbox.
- Quebec employer contributions: Health Services Fund on each remittance (public-sector or payroll-based rate), and the year's HSF, labour standards (CNT) and workforce skills figures for the RLZ-1.S.
- Retention schedule per city for notifications and the email log; ended sessions and used links cleared after 30 days.
- Full data export for each city (every record as CSV and JSON, documents as files) from Settings.
- Payroll problems and warnings in English and French; printable PDF of a person's records; encrypted employee document uploads; fingerprints of what was signed on discipline records.
- Scheduling assistant across several facilities: hardest-to-fill shifts first, repair pass, travel time between sites, each shift under its own province's rules.
- Job postings server-rendered with JobPosting structured data, robots.txt and sitemap per city; a nonce-based script policy (CSP) on every page.

- Push notifications on phones and computers (web push), installable app, location only at clock-in and during working-alone sessions you start.
- Subprocessor list and data-residency assessment (`SUBPROCESSORS.md`).
- First-sign-in information and consent agreement: separate notification and location choices, a typed name and signature, stored with fingerprints of the text and signature; the API refuses other requests until it's signed; the Dev console lists, exports and certifies each one.
- Demand forecast from bather-load history, facility opening hours (with a minimum on deck) and lesson registrations, with draft open shifts for the gaps.
- Quebec: RL-1 slips as Revenu Québec XML; workforce skills training spending log, reducing the WSDRF owed.
- Payroll in the app, or with ADP, Dayforce or Wagepoint over their API (sealed credentials, connection test, send and history), with the file download kept as the fallback.
- Union Hub as its own service (`UNION_HUB_MODE=separate`): the main API then holds no union credentials.
- Copyright notices in the app and on the website.

## Deliberately out of scope

- Filing with government directly: FH prepares the T4 XML, ROE Web XML and remittance totals; the city uploads them (Internet File Transfer, ROE Web) and pays its remittances.
