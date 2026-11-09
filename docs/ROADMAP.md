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
- [ ] Direct integrations with payroll providers (ADP, Ceridian Dayforce, Wagepoint) in addition to CSV.
- [ ] Search-engine-friendly job pages (server-rendered, structured data).

## Done

- Shift board with eligibility reasons, overtime approval and optimistic locking; schedule builder with assistant; my schedule.
- Availability, time off, timeclock with geofence, punch review; chemical readings and closure workflow; incidents with sealed narratives.
- Staff directory, invitations, roles, pay rates, verified certifications, discipline records with signature capture.
- Login lockout and rate limits, password reset by email.
- Payroll CSV export with overtime, statutory holiday pay and vacation pay.
- Settings: organization, facilities, pay codes, school calendar, collective-agreement overrides, pool thresholds.
- Offline-first instructor attendance; certification reminders at 90/60/30/7 days; nightly reliability recalculation.
- Union Hub: discussions, seniority list, membership managed by stewards.
- Job postings and a public careers page.
- Menus tailored to each role (a union steward sees only the Union hub; HR doesn't see personal shift screens).
- FH Dev console: create cities, fifteen feature switches, facilities, positions, city logo upload, CSV staff import with preview.
- City logo beside the FH logo on sign-in, in the app and on the careers page.
- Passkeys (Windows Hello, Face ID / Touch ID, Android biometrics) for sign-in and a "confirm it's you" step before sensitive changes.

## Deliberately out of scope

- Calculating source deductions (CPP/QPP, EI, QPIP, income tax) and issuing T4/RL-1 slips. FH exports gross wages; the payroll provider does the rest.
- Storing Social Insurance Numbers.
