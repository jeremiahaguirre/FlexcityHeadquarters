# Roadmap

## Before the first customer

- [ ] **Legal review of provincial rules** (see `COMPLIANCE.md` checklist); flip `verified` per province.
- [ ] **Legal review of the first-sign-in agreement** (`apps/api/src/services/privacy/consent.ts`, EN/FR) and the website's privacy page and terms.
- [ ] **Payroll provider API access**: each city gets API credentials from ADP (Marketplace, with its mutual-TLS certificate), Dayforce or Wagepoint, and FH confirms each provider's import endpoint and layout against the first real send (they're pre-filled from the providers' published addresses).
- [ ] **Revenu Québec**: FH's RL-1 software authorization number for the year, and the first RL-1 XML run through Revenu Québec's test service.
- [ ] **T4A**: run the first T4A XML (`services/payroll/t4a.ts`) through CRA's validation before a city files it.
- [ ] **Text provider**: confirm Twilio or choose another, sign its DPA and get its SOC 2 report (`SUBPROCESSORS.md`); consider a Canadian-hosted provider, since Twilio is in the US. Buy the sending number (`SMS_FROM`).
- [ ] **Time in lieu**: counsel to confirm that the in-app choice to bank overtime (time-stamped and audited) counts as the written agreement the ESA asks for, and the default of 12 months to take banked time (Ontario: 3 months, or 12 by agreement).
- [ ] **Mileage rates**: confirm CRA's reasonable per-km rates each January and update the default (`services/payroll/expenses.ts`, today 72¢ / 66¢ after 5,000 km); remind cities to update theirs in payroll settings.
- [ ] **Job applications**: counsel to review the applicant privacy notice (EN/FR) and the one-year retention.
- [ ] **Error tracking**: choose the service (Sentry or a self-hosted GlitchTip), sign its DPA if it's hosted, and set `SENTRY_DSN` (`SUBPROCESSORS.md`); until then errors are only logged.

## Next

- [ ] Weather in the forecast: confirm the first live fetches from `api.weather.gc.ca` (city page and daily climate collections) match the parser, which was built against the documented format and recorded fixtures; add statutory holidays for every province and future years to the holiday table (the forecast and payroll both read it).
- [ ] Metrics: Prisma's connection-pool metrics (a preview feature that needs a schema flag).
- [ ] Public API: write scopes (v1 is read-only), once a city asks for a specific write.

## Later

- [ ] Constraint-solver scheduling (OR-Tools CP-SAT) behind the existing `proposeSchedule` types, if large multi-facility terms outgrow the hardest-first planner with its repair pass.
- [ ] FH books: verify the chart of accounts, sales tax treatment and the PAD transaction code with FH's accountant and bank before the first live debit.
- [ ] Payroll: FH verifies each year's tax tables against CRA's T4127 (all 13 provinces and territories and the federal table ship as unverified starting values); the basic personal amount phase-outs in Manitoba and Yukon.

## Done

- Shift board with eligibility reasons, overtime approval and optimistic locking; schedule builder with assistant; my schedule.
- Availability, time off, timeclock with geofence, punch review; chemical readings and closure workflow; incidents with sealed narratives.
- Staff directory, invitations, roles, pay rates, verified certifications, discipline records with signature capture.
- Login lockout and rate limits, password reset by email.
- Demand forecast adjusted for the weather (Environment and Climate Change Canada open data, one fetch per forecast site shared by every city, learned per facility over time), statutory holidays and special events, with a reason per day and a view without adjustments.
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
- FH Dev console: create cities, a switch per feature, facilities, positions, city logo upload, CSV staff import with preview.
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
- Emergency contacts: up to three per person, kept by the person or HR; a working-alone monitor sees them only once a session escalates or the person asks for help; every look audited.
- Text and phone alerts (city switch, off by default): a confirmed mobile number, then a call and a text when a working-alone session escalates or someone asks for help, and texts for missed check-ins, call-out offers and open shifts starting within a day. Sent by the worker through Twilio; no links, contents dropped once sent.
- Time in lieu: each person chooses to bank overtime at its premium up to the city's cap; days off from the bank, payouts, HR corrections with a reason, and pay-run flags for old balances and people leaving.
- Seniority as a switch per organization (Settings and the Dev console): on, it breaks ties in the overtime order, call-outs and the assistant; off, ties go by fewest hours. Private-sector companies start with it off.
- Shift trades between two people: both eligible for the other's shift, the other person agrees, a supervisor approves, both shifts swap together or not at all.
- Calendar feed (iCalendar) of your own shifts by a private link; only its hash is stored.
- Facility kiosk: a shared tablet registered by a supervisor; staff punch with their employee number and a PIN; wrong PINs lock the number for 15 minutes.
- Expense and mileage claims: receipts encrypted, a supervisor in the department approves (never their own), paid as untaxed reimbursements on the next pay run, two-tier per-km rate.
- Read-and-sign policies: HR publishes to everyone or some positions with days to sign; signatures keep a fingerprint of the exact text and can't be changed.
- Facility logbook (append-only) and announcements to everyone, some positions or some facilities, with read counts.
- Job applications on the careers page: privacy notice, PDF résumé encrypted, stages and notes, hire into an invitation; deleted a year after the last change unless hired.
- T4A for contractors and honoraria: payees (SIN sealed), payments by box (048, 028, 020, tax withheld in 022), slips over $500 or with tax withheld, CRA XML with a passkey.
- Reports: nine built-in reports by department, CSV (formula-like text neutralized, downloads audited), saved and emailed weekly or monthly with the owner's current access.
- Website: Vercel Web Analytics (cookieless).
- Offline punching: without signal a punch is kept on the phone per person and sent when the connection returns; never doubled, the phone's clock corrected, old or out-of-order punches refused with a reason, the rest flagged "Recorded offline" for supervisors.
- Reporting lines and an org chart: a manager per person (or the department's by default), set one at a time, in bulk or from the import; requests go to the manager first; My team in approval queues; reviews default to the manager; offboarding reassigns a leaver's people.
- Public API v1 (read-only, scoped per-organization keys, IP allow list, expiry, rotation, rate limit per key, every request audited, OpenAPI 3.1) and signed webhooks with retries and auto-disable; Settings › Integrations; `publicApi` plan option, standard in Multi-complex and Enterprise.
- Observability: request ids, `/readyz` (database, outbox backlog, worker heartbeat), Prometheus `/metrics` behind a token, scrubbed error reports from the server and browsers to a Sentry-compatible service when configured.
- Domain events through a transactional outbox (at least once, deduplicated notifications); one LISTEN connection per process and caches dropped everywhere through `pg_notify`, so several API processes can run (`WEB_CONCURRENCY`).
- Accessibility pass (WCAG 2.1 AA target, not yet independently audited): keyboard use, focus, dialog and field names for screen readers, one h1 per screen; phone keyboards per field type; calm motion and the animated logo (stopped when motion is reduced); a clear no-access screen; discipline records hide empty template sections, with the record as signed one tap away.

## Deliberately out of scope

- Filing with government directly: FH prepares the T4 XML, ROE Web XML and remittance totals; the city uploads them (Internet File Transfer, ROE Web) and pays its remittances.
