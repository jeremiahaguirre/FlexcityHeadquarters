# Roadmap

## Before the first customer

- [ ] **Legal review of provincial rules** (see `COMPLIANCE.md` checklist); flip `verified` per province.
- [ ] HTTP routes for: availability, time off (request/approve), shift CRUD and publishing, users/positions/pay rates admin, certifications upload and verification, pool threshold setup, punch approval queue.
- [ ] Union Hub HTTP routes (service exists) behind a separate deployment using `UNION_DATABASE_URL`.
- [ ] Notifications: push (web push / FCM) and email workers subscribing to domain events; WebSocket gateway for the front-desk board (currently polls every 15 s).
- [ ] Shift Board: supervisor approval queue UI; "my schedule" page.
- [ ] Chemical reading entry UI and Head Lifeguard closure confirmation UI.
- [ ] Rate limiting and account lockout on login; password reset by email.
- [ ] SSO (SAML / Entra ID) for municipal tenants.
- [ ] Subprocessor list and data-residency assessment.
- [ ] Holiday-pay entitlement (`holidayPay.ts`) wired into the payroll run.
- [ ] Tenant-configurable school calendars for young-worker rules (default is weekdays, Sept–June).

## Next

- [ ] Disciplinary records UI with signature capture.
- [ ] Offline-first instructor attendance (PWA, IndexedDB queue with conflict handling).
- [ ] Certification expiry reminders (30/60/90 days).
- [ ] Nightly reliability recalculation (currently computed on request).
- [ ] Demand generation from facility hours, lesson registrations and bather-load history.

## Later

- [ ] Constraint-solver scheduling (OR-Tools CP-SAT in a Python worker) behind the existing `proposeSchedule` input/output types, for multi-facility terms.
- [ ] Direct integrations with payroll providers (ADP, Ceridian Dayforce, Wagepoint) in addition to CSV.
- [ ] Public job board (SEO pages) for seasonal hiring.

## Deliberately out of scope

- Calculating source deductions (CPP/QPP, EI, QPIP, income tax) and issuing T4/RL-1 slips. FH exports gross wages; the payroll provider does the rest.
- Storing Social Insurance Numbers.
