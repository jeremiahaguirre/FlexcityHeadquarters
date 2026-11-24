# Security policy

## Reporting a vulnerability

Please report suspected vulnerabilities privately to **security@flexcityhq.example** (replace with
the production address before launch), not in a public issue. Include what you found, how to
reproduce it, and what an attacker could do with it.

- We acknowledge within 2 business days and give a first assessment within 5.
- We fix critical and high findings before any public disclosure, and credit reporters who want it.
- Please don't access other people's data, degrade the service, or test against a city's production
  site: ask us for a test organization.

## How to read this file

Everything after the reporting policy is FH's security decision ledger, measured against
[OWASP ASVS v5.0.0](https://owasp.org/www-project-application-security-verification-standard/)
Level 3. It describes FH as it is, not as it should be:

- **Current** cites the code or configuration that does it today (`path:line`). A statement with no
  citation is not a claim about the code.
- **Decided target** is one of the owner's four decisions of 2026-11-17 in section 2.0, cited as
  **decision N**. A decided target that isn't built yet says **planned**. A detail that waits for
  the owner's confirmation says **pending (D-38)**. Something the analysis derives from a decision
  says **derived**.
- **Open decision D-nn** means the owner hasn't decided yet; the recommended answer is listed in
  section 3.2 and marked *recommended*, never as decided.
- **Gap** means FH doesn't meet the requirement and nothing is decided about it yet.

FH does not meet ASVS Level 3 today, and doesn't claim Level 2 either. The ledger exists so that
every gap is visible and every change keeps it true (section 4).
`apps/api/test/unit/securityLedger.test.ts` fails the build when a path cited here doesn't exist
(paths are written from the repository root, and a shortened one fails too), when a cited line is
past the end of its file, when a route file has no row in 2.6 or its row leaves out a permission
the file names, or when a Terraform log group is missing from 2.11.

## 1. Directives

These bind every change to this repository, by people and by coding agents alike.

1. **No new code below the ledger.** A change never adds a debug switch, a hard-coded credential,
   an unvalidated input, a check that only the browser makes, or a cryptographic primitive that
   isn't already in the ledger. Whether the existing gaps block merging is open decision D-1.
2. **Documentation first.** A change that adds or changes an input structure, a business limit,
   an upload, a sign-in pathway, a session type, a permission or field rule, a key or algorithm,
   an external connection, a sensitive field, a dependency with new powers, or a security event
   updates the matching row in section 2 in the same pull request.
3. **The API decides.** Validation, workflow order, sign-in, scope and permission checks run in
   `apps/api`. The web app (`apps/web`) checks only for the person's convenience. A guard reads the
   same parsed value the handler acts on (for example the deck guard, 2.6).
4. **Abuse cases are tested.** Every new endpoint ships with integration tests for the normal path
   and for abuse: another city's or department's ids (`apps/api/test/integration/crossCity.test.ts`
   does this for path ids), privileged fields in the body, injection payloads, replays and races,
   and rate limits.

FH has no WebSocket, WebRTC, media or 3D code. Its only real-time channel is one-way Server-Sent
Events (`apps/api/src/routes/notifications.ts:52`), so the WebRTC chapter (V17) and the WebSocket
section of V4 don't apply.

## 2. Security decision ledger

### 2.0 Owner decisions (2026-11-17)

**Decided.** "Decided" in this ledger means one of these four, cited as **decision N**:

1. Passkeys are mandatory for admin, HR and payroll roles, first.
2. Sessions: staff 30 minutes idle, 12 hours absolute, at most 3 sessions; admins 15 minutes idle,
   4 hours absolute, 1 session. Punch in and out and safety check-ins keep working through quick
   passkey or PIN re-entry.
3. Two-person approval is required, with a designated second approver as the fallback.
4. A banned-password list covering FH's and each city's own names. kelo, kelobot, lakeview,
   okanagan, kelowna and hcos are excluded (they come from another project).

**Pending owner confirmation (D-38).** The gap analysis was written from a longer note of the same
decisions, which isn't in this repository. These details from it are **not** decided here until the
owner confirms them:

- **Decision 1:**
  - managers, city admins and the Dev console are also passkey-mandatory;
  - other staff keep password plus current second-factor rules, and can add a passkey (stricter later, per city setting);
  - the kiosk keeps its own device sign-in;
  - email and text codes don't count as the factor for the passkey-mandatory roles.
- **Decision 2:** on the N+1 sign-in, confirm with a second factor, end the oldest session and notify the person; provide a self-service session list; let admins end sessions.
- **Decision 3:**
  - it covers organization-wide permission changes, bulk export or deletion, billing and contract changes, and production overrides;
  - when a city truly has no second approver, FH support co-approves under the city-consent rule, with a city audit entry and an email to the HR admins.
- **Decision 4:** the role words admin, root, supervisor, guard, lifeguard, hr, steward, frontdesk, waterworks, dev, staging, prod, production, operator; each city's subdomain as well as its name.

Questions these leave open (passkey recovery, stewards, attestation, how PIN re-entry works, how
short words are matched) are open decisions in section 3.2, with recommendations that are not
decisions.

### 2.1 Input structure, consistency and business limits (ASVS 2.1.1, 2.1.2, 2.1.3)

| Item | Current (verified) | Decided target | Open decision | Deviation and compensating control |
| :--- | :--- | :--- | :--- | :--- |
| Input structure (2.1.1, 2.2.1) | zod 4 schemas in each route (`apps/api/package.json:43`); 384 `z.object(` calls in routes and services. No shared field classes: each file defines its own, for example `const uuid` in `apps/api/src/routes/people.ts:20` and `apps/api/src/routes/settings.ts:20`. Unknown keys are stripped, not refused; `.strict()` is used only in `apps/api/src/routes/publicApiWrite.ts` and `apps/api/src/routes/forecastEvents.ts`. JSON bodies are capped at 100 kB except named upload routes (`apps/api/src/app.ts:71-76`); the Dev console allows 2 MB (`apps/api/src/routes/platform/index.ts:22`). | Gap: shared field classes (name, free text, money, date, id, email, phone, postal code) and refusal of unknown fields. | D-3 (characters allowed in names). | None yet. |
| Consistency rules (2.1.2, 2.2.3) | In services, with error codes: `ENDS_BEFORE_START` (`apps/api/src/services/scheduling/onCall.ts:65`, `apps/api/src/services/scheduling/planner.ts:51`); RLS keeps every id inside the caller's city. A deck station's pool must be one of its facility's pools (`POOL_BODY_UNKNOWN`, `apps/api/src/routes/deck.ts:29-34`). | Gap: one list of rules per domain, kept with the error codes. | - | - |
| Per-person limits (2.3.2) | Per address, not per person: 1200 requests a minute signed in, 120 anonymous (`apps/api/src/lib/ipRateLimit.ts:147-149`). Per-action caps where abuse was seen: messages 30 a minute and 600 a day, 20 files an hour (`apps/api/src/services/messaging/conversations.ts:51-57`). | Gap: no per-person mutation cap. | D-4. | Punches, lone-work check-ins and help requests must never be refused (WorkSafeBC working alone). |
| Per-city limits (2.4.1) | None (no limiter keyed on the organization). | Gap. | D-5. | Same as above. |
| Workflow order (2.3.1) | State checks in services, for example pay runs (`apps/api/src/services/payroll/payRuns.ts:477`) and shift trades (`apps/api/src/services/shiftboard/trades.ts`). Known weak spots: a sent pay run can be voided, approval is not bound to the prepared totals, and approve can race (open PR #71, planned work package WP-5). | Gap until WP-5. | - | - |
| Human-timing floor (2.4.2) | None; the public enquiry form has a honeypot (`apps/api/src/routes/marketing.ts`). | Gap. | D-6. | A floor on signed-in flows would refuse password managers, passkeys and offline replays. |
| Two-person approval (2.3.5) | Pay runs only: the preparer can't approve when `twoPersonApproval` is on (`apps/api/src/services/payroll/payRuns.ts:477`); one person can switch it off with a passkey (`apps/api/src/routes/payroll.ts:839-848`). | **Decided (decision 3):** two-person approval, with a designated second approver as the fallback. **Pending (D-38):** which actions it covers (organization-wide permission changes, bulk export or deletion, billing and contract changes, production overrides), and FH support co-approving when a city has no second approver. **Planned** (WP-18). | D-7 (who may switch pay-run approval off). | - |

### 2.2 Browser baseline and external assets (ASVS 3.1.1, 3.6.1)

| Item | Current (verified) | Decided target | Open decision | Deviation and compensating control |
| :--- | :--- | :--- | :--- | :--- |
| Browser capabilities (3.1.1, 3.7.5) | No written baseline and no capability check. Passkeys fall back to a code or password when the browser lacks WebAuthn (`apps/web/src/components/auth/MfaDialog.tsx`, `apps/web/src/components/auth/PasskeysCard.tsx`). The API sends HSTS in production (`apps/api/src/app.ts:103`); the load balancer accepts TLS 1.2 and 1.3 (`ops/terraform/edge.tf:73`). | Gap. | D-9 (version floor, secure-context and WebCrypto checks, TLS 1.3 at the edge), D-10 (HSTS preload). | WebAuthn stays optional for roles that don't need a passkey. |
| External assets (3.6.1) | None. Fonts are self-hosted (`apps/web/src/app/layout.tsx:22`, `apps/site/src/app/[lang]/layout.tsx:2`); no script or stylesheet comes from a CDN. | Keep it that way. Approved external assets: **none**. | - | The GitHub Pages demo serves sample data only (D-14). |

### 2.3 Uploads (ASVS 5.1.1)

Every upload is checked by its first bytes against one list (PDF, PNG, JPEG, WebP; no SVG,
`apps/api/src/lib/files.ts:11-20`), stored by a random id in Postgres (sealed with the city's key,
except logos), and downloaded only as an attachment with `nosniff`, `no-store` and a sandbox CSP
(`apps/api/src/lib/files.ts:47-53`). Files are not kept in S3. There is no antivirus scan, no
metadata stripping, no pixel cap and no per-person quota (gap; D-16).

| Surface | Who uploads | Types | Stated limit | Effective limit today | Storage |
| :--- | :--- | :--- | :--- | :--- | :--- |
| Employee documents | HR, supervisors (department), the person | PDF, images | 10 MB (`apps/api/src/routes/documents.ts:26`) | 10 MB (14 MB JSON parser, `apps/api/src/app.ts:72,75`) | Sealed rows (`EmployeeDocument`, `apps/api/prisma/schema.prisma:3065`) |
| Message attachments | Staff in a conversation | PDF, images | 10 MB (`apps/api/src/services/messaging/conversations.ts:40`) | 10 MB, 20 files an hour per person | Sealed rows |
| Résumés (careers page) | Anyone, no sign-in | PDF | 5 MB (`apps/api/src/routes/applications.ts:30`) | About 70 kB: the route is behind the 100 kB parser (`apps/api/src/app.ts:71-76,86`) | Sealed rows (`JobApplication`) |
| Expense receipts | Staff | PDF, images | 14 MB of base64 (`apps/api/src/routes/expenses.ts:31`) | About 70 kB (100 kB parser) | Sealed rows, as an employee document |
| Discipline acknowledgement signature | The employee | PNG | 200 kB (`apps/api/src/routes/discipline.ts:21`) | About 70 kB (100 kB parser) | `DisciplinaryRecord.acknowledgementSignature` |
| Agreement signature | Each person at first sign-in | PNG | 300 kB of base64 (`apps/api/src/routes/consent.ts:80`) | 400 kB parser (`apps/api/src/app.ts:73`) | Database row |
| City logo | Dev console (`apps/api/src/routes/platform/cities.ts:407`) | PNG, JPEG, WebP | 512 kB (`apps/api/src/services/platform/logo.ts:9`) | 512 kB (2 MB console parser, `apps/api/src/routes/platform/index.ts:22`) | `TenantLogo` bytes, not sealed |
| Trust evidence | Dev console | PDF, images | 10 MB (`apps/api/src/routes/platform/trust.ts:29`) | 10 MB (14 MB parser, `apps/api/src/routes/platform/index.ts:23`) | Sealed rows (`TrustEvidence`) |
| Staff CSV import | Dev console | CSV text | 2000 rows (`apps/api/src/services/platform/staffImport.ts:14`) | 2 MB parser; not checked to be UTF-8 | Parsed, not stored |

The target's avatar, media-recording, archive and JSON-import rows don't apply: FH shows initials,
records no media and accepts no archive or JSON file. Résumé, receipt and discipline signature
uploads don't reach their stated limits (planned fix WP-12a).

### 2.4 Authentication pathways and passwords (ASVS 6.1.1, 6.1.2, 6.1.3)

**Decided (decision 1).** Passkeys are mandatory for admin, HR and payroll roles, first.
**Pending (D-38):** managers, city admins and the Dev console as well; other staff keeping their
password and current second-factor rules (today a single factor unless the city requires more, see
the table); the kiosk keeping its device sign-in; email and text codes not counting as the factor
for the passkey-mandatory roles. **Planned** (WP-9). Open questions: recovery of a lost only passkey (D-35), union
stewards (D-17e), attestation (D-36).

**Brute force.** Org sign-in: 5 wrong passwords from one network lock that network for 15 minutes,
doubling to 24 hours; 50 across networks lock the account for 15 minutes, doubling to 1 hour, except
for networks it recently signed in from; an address failing on 10 accounts is blocked for an hour
(`apps/api/src/auth/bruteForce.ts:61`). Dev console: 3, 20 and 3 (`apps/api/src/auth/bruteForce.ts:63`).
Nothing is ever locked for good. The design is in `docs/ARCHITECTURE.md:259`. Locks are audited and
the person is emailed once per account lock (`apps/api/src/routes/auth.ts:142-151`); network and
console locks aren't sent to the person (gap).

**Passwords.** At least 12 characters, at most 128, letters with digits or symbols, 5 different
characters, not on the common list (`apps/api/src/routes/auth.ts:28-35`), not containing the
person's names, email or the organization's name or subdomain (`apps/api/src/auth/commonPasswords.ts:30-41`).
Hashed with scrypt at Node's default cost (`apps/api/src/auth/tokens.ts:101-105`). The breached-password
check against HIBP is off unless `PASSWORD_BREACH_CHECK=on` (`apps/api/src/auth/breachedPasswords.ts:1-17`).

| Blocklist item | Current | Decided target |
| :--- | :--- | :--- |
| Common and product words | Inline list (`apps/api/src/auth/commonPasswords.ts:6-11`), matched whole after trimming digits and symbols at the ends | **Decided (decision 4):** FH's own names (flexcity, flexcityheadquarters). **Pending (D-38):** the role words admin, root, supervisor, guard, lifeguard, hr, steward, frontdesk, waterworks, dev, staging, prod, production, operator. **Planned** (WP-8). How 2-3 letter words are matched is open (D-34). |
| Each city's name and subdomain | Only the person's own organization, at reset and change (`apps/api/src/routes/auth.ts:280`) | **Decided (decision 4):** each city's own names. **Pending (D-38):** its subdomain too. **Planned** (WP-8). |
| Excluded words | `kelowna` is on today's list (`apps/api/src/auth/commonPasswords.ts:9`) | **Decided (decision 4):** kelo, kelobot, lakeview, okanagan, kelowna and hcos are not FH's and are not on the list. **Planned:** remove `kelowna` (WP-8). |

| Pathway | Factors today (verified) | Output | Decided target | Gaps |
| :--- | :--- | :--- | :--- | :--- |
| Org password (`apps/api/src/routes/auth.ts:102`) | Password; a second factor only for roles the city lists in `mfaRoles`, or for anyone with admin-level powers when HR is listed (`apps/api/src/auth/middleware.ts:103-107`). Built-in roles holding `tenant.configure` can still sign in with a password to a closed organization or past enforced single sign-on (`apps/api/src/routes/auth.ts:158-163`) | 15-minute access token and refresh cookie (2.5) | Passkey for the mandatory roles (planned) | Single factor for most roles |
| Org passkey (`apps/api/src/routes/passkeys.ts:38-84`) | Passkey with user verification required (`apps/api/src/services/auth/passkeys.ts:78,95`); no attestation (`apps/api/src/services/auth/passkeys.ts:75`) | Same; counts as a second factor | Unchanged; synced passkeys accepted (recommended) | Accepts RS1 credentials (`apps/api/src/services/auth/passkeys.ts:58`) |
| Email or text code (`apps/api/src/routes/mfaCodes.ts:59-131`) | 6 digits, 10 minutes, stored as an HMAC (`apps/api/src/services/auth/mfaCodes.ts:4,14,23`); a city can turn codes off | Marks the session as having a second factor | **Pending (D-38):** never the factor for the passkey-mandatory roles (planned, WP-9) | Counts for every role today |
| Step-up (`apps/api/src/routes/passkeys.ts:99-120`) | Passkey or password; sensitive actions need one in the last 10 minutes (`apps/api/src/auth/middleware.ts:187-200`) | New access token; a passkey also marks a second factor | Passkey only and 5 minutes for admin-level actions (open, D-17g) | Password accepted for admin-level actions |
| Single sign-on, OIDC and SAML (`apps/api/src/routes/sso.ts:21-82`) | The city's IdP; counted as a second factor when the IdP sends any `mfa` amr or the city ticks `idpMfa` (`apps/api/src/services/auth/sso.ts:222-223,294,332`) | One-time code exchanged for the normal session | **Derived** from decision 1 by the gap analysis (not stated in it): for the mandatory roles, counts only with IdP proof of a phishing-resistant method, else an FH passkey step-up (planned, WP-38) | Any `mfa` amr or the switch counts today |
| Password reset and invitation (`apps/api/src/routes/auth.ts:236-290`) | Emailed one-time link | Sets a password; ends every session (`apps/api/src/routes/auth.ts:284`) and sends a `password_changed` notification (`apps/api/src/routes/auth.ts:285`) | - | An email on every reset is planned (WP-4) |
| Facility kiosk (`apps/api/src/routes/kiosk.ts:164-297`) | Paired tablet secret, employee number and a 4-6 digit PIN, scrypt-hashed; lock rules in section 5 | A punch only, no session | **Pending (D-38):** kiosk keeps its device sign-in | Reduced-assurance pathway by design; 6-digit PINs open (D-17j) |
| Dev console (`apps/api/src/routes/platform/auth.ts:28`, `apps/api/src/routes/platform/passkeys.ts`) | Password, then a passkey, required in production (`apps/api/src/auth/platform.ts:30-33,126`) | 8-hour console session (2.5) | **Pending (D-38):** passkey mandatory | First passkey can be added from a password-only session; no password blocklist in `apps/api/scripts/platform-admin.ts` |
| FH support visit (`apps/api/src/services/platform/support.ts:19-35`, `apps/api/src/routes/support.ts:24-48`) | Console session with step-up, plus the city's written consent; 2-minute one-time code | Read-only session of up to 30 minutes | Unchanged | The code is a bearer secret for 2 minutes |
| Public API key (`apps/api/src/services/integrations/apiKeys.ts:56-62`, `apps/api/src/routes/publicApi.ts`) | 256-bit key, SHA-256 stored, optional expiry and IP ranges | Each call checked | Default 12-month expiry, IP ranges for write keys (recommended, D-17i) | Expiry optional |
| Calendar feed link (`apps/api/src/routes/calendar.ts:40-47,96`) | 192-bit secret in the URL, SHA-256 stored | Read-only feed of the person's shifts | Keep (recommended, D-20d) | No expiry |
| Union Hub (`apps/api/src/unionApp.ts:32`) | The organization's access token | Same session | Steward passkey (recommended, D-17e) | Hub assurance equals the employer app's |

### 2.5 Sessions (ASVS 7.1.1, 7.1.2, 7.1.3)

**Decided (decision 2), planned (WP-17).** Staff: 30 minutes idle, 12 hours absolute, at most 3
sessions. Admins: 15 minutes idle, 4 hours absolute, 1 session. Punch in and out and safety
check-ins keep working through a quick passkey or PIN re-entry. **Pending (D-38):** on the N+1
sign-in, confirm with a second factor, end the oldest session and notify the person; a self-service
session list; admins can end sessions. None of this is built yet. How the PIN re-entry works on a
personal phone is open (D-33).

| Session type | Current (verified) | Decided target | Open decision | Deviation and compensating control |
| :--- | :--- | :--- | :--- | :--- |
| Organization (staff and admins) | HS256 access token, 15 minutes, kept in memory in the page (`apps/api/src/config.ts:57`, `apps/api/src/auth/tokens.ts:28-35`, `apps/web/src/lib/api.ts:30`); opaque refresh token in the HttpOnly, SameSite=Strict cookie `fc_refresh`, path `/api/auth`, 14 days, renewed on each rotation so the window slides (`apps/api/src/config.ts:58`, `apps/api/src/routes/auth.ts:42-48`, `apps/api/src/auth/tokens.ts:47-92`). Only the hash is stored; a reused token revokes its family. No idle or absolute cap, no session count. Logout revokes the presented family (`apps/api/src/routes/auth.ts:221-228`). | Staff 30 min / 12 h / 3; admins 15 min / 4 h / 1 (planned) | D-12 (cookie prefix; bearer token kept as a deviation, recommended) | The 15-minute access token can't be revoked before it expires; `requireAuth` re-reads the person's status on every request (`apps/api/src/auth/middleware.ts:93`). |
| Dev console | Opaque token in the `fh_platform` cookie, path `/api/platform`, 8 hours, no idle check (`apps/api/src/auth/platform.ts:20-57`) | Admin values (planned) | - | - |
| FH support visit | Read-only, at most 30 minutes and never past the city's grant (`apps/api/src/services/platform/support.ts:19,34`); cookie `fh_support`, path `/api/auth/support` (`apps/api/src/routes/support.ts:19-20`); every page audited (`apps/api/src/auth/middleware.ts:126`) | Unchanged | - | Logout clears the cookie only; the visit's own end time still holds (`apps/api/src/routes/support.ts:63-68`) |
| Kiosk tablet | Device secret, SHA-256 stored, in the `fh_kiosk` cookie, path `/api/kiosk`, 400 days, until someone with `timeclock.review` unpairs it (`apps/api/src/routes/kiosk.ts:142-145`, `apps/api/src/routes/kiosk.ts:67`) | **Pending (D-38):** keeps its device sign-in | D-18d (re-pairing interval; recommended: no forced expiry, show last-seen) | Reduced assurance by design: a punch only, no session |
| Union Hub | Same access token as the organization (`apps/api/src/unionApp.ts:32`) | Follows the organization's | - | - |
| Single sign-on | Ends in a normal organization session; the IdP session isn't followed and there is no back-channel or SAML logout (`apps/api/src/routes/sso.ts:62-82`) | - | D-18 | - |
| GitHub Pages demo | No server session: the demo answers from sample data in the page (`apps/web/src/lib/demoApi.ts`) | n/a | - | - |

Credential and factor changes: a password reset ends every session (`apps/api/src/routes/auth.ts:284`);
changing a password, adding or removing a passkey, or changing a text number doesn't yet end other
sessions (gap; open PR #86, WP-4). Sign-out clears what the app keeps on the phone except the
offline lesson-attendance queue (gap); FH doesn't send `Clear-Site-Data` (D-11).

### 2.6 Authorization: permission matrix, scope and route inventory (ASVS 8.1.1, 8.1.2)

- **Permission matrix:** `apps/api/src/auth/permissions.ts:7` (permissions) and
  `apps/api/src/auth/permissions.ts:122` (built-in roles). Routes check permissions, never role names.
  The Dev console can override a role's permissions per city, and cities add custom roles
  (`apps/api/src/services/people/customRoles.ts`). Who sees what, by role, is in
  [docs/SECURITY-LEGAL-AUDIT.md section 5A](docs/SECURITY-LEGAL-AUDIT.md); its Payroll row says
  "department scope", which the payroll person routes don't check themselves (below).
- **Between cities:** row-level security on every city table, checked by
  `apps/api/test/integration/crossCity.test.ts` and `apps/api/test/integration/rls-coverage.test.ts`.
- **Department and facility scope:** a person limited to a department can't open anyone outside it
  on `/users/:id/...` and onboarding routes, through one guard on the decoded, lower-case path
  (`apps/api/src/routes/features.ts:102-118`, `apps/api/src/lib/canonicalPath.ts`); other routes call scope helpers
  (`apps/api/src/services/people/scope.ts`) handler by handler. There is no central policy point
  (gap) and no route refuses a department-limited holder of an organization-wide permission
  (`requireWholeOrganization` is not on main; open PRs #50 and #54; WP-3).
- **Field-level rules (8.1.2):** response shapes are hand-picked per route (`apps/api/src/routes/serializers.ts`);
  there is no per-model table of readable and writable fields (gap).
- **Dev console:** every console admin can do every console action, except Trust (`trust.read`,
  `trust.manage`, `apps/api/src/routes/platform/trust.ts:35`) and releases (`releases.manage`,
  `apps/api/src/routes/platform/updates.ts:28`). Splitting the rest is open (D-19).
- **Contextual risk engine (8.1.3, 8.2.4):** none. Open (D-19); punch and safety routes would never be
  denied.

Route inventory. "Reached through": **org** = signed-in organization API behind `requireAuth`, the
department guard and the agreement check (`apps/api/src/routes/features.ts:101-119`); **public** =
no sign-in, organization from the address (`apps/api/src/app.ts:86`); **anon** = no sign-in, no
organization; **console** = Dev console session (`apps/api/src/routes/platform/index.ts:26`);
**key** = city API key; **device** = paired kiosk; **hub** = the Union Hub service. Permissions are
those the file names in `requirePermission(...)` or checks inline.

| Route file | Reached through | Permissions checked | Notes |
| :--- | :--- | :--- | :--- |
| `apps/api/src/routes/accommodation.ts` | org | accommodation.manage | |
| `apps/api/src/routes/accounting.ts` | org | accounting.manage | |
| `apps/api/src/routes/applications.ts` | public, org | jobs.manage, users.write | Anonymous résumé upload |
| `apps/api/src/routes/attendance.ts` | org | availability.self, schedule.write, timeclock.review, timeoff.approve, timeoff.self | |
| `apps/api/src/routes/auth.ts` | public | none (sign-in); `tenant.configure` decides who may still sign in with a password to a closed or single-sign-on-only organization (`apps/api/src/routes/auth.ts:158`) | 2.4 |
| `apps/api/src/routes/benchmarks.ts` | org | reliability.read, tenant.configure | |
| `apps/api/src/routes/benefits.ts` | org | benefits.manage | |
| `apps/api/src/routes/bidding.ts` | org | bidding.bid, bidding.manage, bidding.observe, tenant.configure | |
| `apps/api/src/routes/billing.ts` | anon (Stripe webhook, signed), org | billing.manage | |
| `apps/api/src/routes/calendar.ts` | org, anon (feed link) | shifts.self | 2.4 |
| `apps/api/src/routes/care.ts` | org | care.manage | |
| `apps/api/src/routes/communication.ts` | org | announcements.post, logbook.write | |
| `apps/api/src/routes/consent.ts` | org | none (each person's own agreement) | |
| `apps/api/src/routes/context.ts` | helper | none | Finds the organization from the address |
| `apps/api/src/routes/coverage.ts` | org | coverage.manage, schedule.write | |
| `apps/api/src/routes/dataExport.ts` | org | tenant.configure | Whole-organization export by one person (2.1, two-person approval planned) |
| `apps/api/src/routes/deck.ts` | org | compliance.report, deck.rotate, ops.configure, schedule.write | The facility guard reads only the query and refuses a repeated `facilityId` (`apps/api/src/routes/deck.ts:17-28`); rotate, close and station creation check the body's facility (`apps/api/src/routes/deck.ts:55,106,124`), and PATCH checks the stored station's (`apps/api/src/routes/deck.ts:78-79`). Tested in `apps/api/test/integration/deckScope.test.ts` (WP-2). Gap: a facility limit on a custom role applies only when the role also holds a supervisory permission (`apps/api/src/services/people/customRoles.ts:107-112`), so a deck-only role limited to one pool reaches every pool (WP-3). |
| `apps/api/src/routes/departments.ts` | org | tenant.configure, users.read | |
| `apps/api/src/routes/discipline.ts` | org | discipline.read, discipline.write, users.write | |
| `apps/api/src/routes/documents.ts` | org | documents.manage, expenses.approve | 2.3 |
| `apps/api/src/routes/emailPrefs.ts` | anon (signed unsubscribe link) | none | |
| `apps/api/src/routes/emergencyContacts.ts` | org | lonework.monitor, users.write | |
| `apps/api/src/routes/expenses.ts` | org | expenses.approve, expenses.self | |
| `apps/api/src/routes/features.ts` | org | incidents.create, incidents.read, ops.chemical.record, ops.page_head_guard, ops.pool.close, ops.status.read, payroll.export, reliability.read, schedule.assist, shiftboard.approve, shiftboard.assign_emergency, shiftboard.claim, shiftboard.post, timeclock.punch, timeclock.review, users.privacy | Mounts the signed-in API |
| `apps/api/src/routes/fill.ts` | org | availability.self, schedule.assist, schedule.write, tenant.configure | |
| `apps/api/src/routes/fleet.ts` | org | fleet.inspect, fleet.manage | |
| `apps/api/src/routes/forecastEvents.ts` | org | schedule.write | |
| `apps/api/src/routes/hr.ts` | org | grievances.manage, leave.manage, performance.manage, timeoff.approve, training.manage, users.write; the HR dashboard counts also check accommodation.manage, benefits.manage, injury.manage, jobs.manage, payroll.export, reliability.read inline | |
| `apps/api/src/routes/injury.ts` | org | injury.manage | |
| `apps/api/src/routes/integrations.ts` | org | tenant.configure | API keys and webhooks |
| `apps/api/src/routes/jobs.ts` | public, org | jobs.manage | |
| `apps/api/src/routes/kiosk.ts` | device, org | timeclock.punch, timeclock.review | 2.4, 2.5 |
| `apps/api/src/routes/lessons.ts` | org | schedule.write | |
| `apps/api/src/routes/lieu.ts` | org | leave.manage, payroll.export | |
| `apps/api/src/routes/loneWork.ts` | org | lonework.monitor, lonework.self | |
| `apps/api/src/routes/marketing.ts` | anon | none | Enquiry form |
| `apps/api/src/routes/members.ts` | org | fees.manage, lessons.plan, members.manage | |
| `apps/api/src/routes/messages.ts` | org | messages.groups, messages.investigate, messages.use, tenant.configure | |
| `apps/api/src/routes/mfaCodes.ts` | public (signed in) | none (own account) | 2.4 |
| `apps/api/src/routes/notifications.ts` | org | none (own notifications) | Server-Sent Events |
| `apps/api/src/routes/observability.ts` | anon | none | `/metrics` needs `METRICS_TOKEN`; client error reports |
| `apps/api/src/routes/onboarding.ts` | org | onboarding.configure, onboarding.hr, onboarding.lead | |
| `apps/api/src/routes/ops.ts` | org | incidents.read, ops.chemical.record, ops.chemical.signoff, ops.configure, ops.headcount.record, ops.status.read | |
| `apps/api/src/routes/overtime.ts` | org | overtime.manage, seniority.read, shiftboard.approve | |
| `apps/api/src/routes/passkeys.ts` | public (sign-in), org | tenant.configure | 2.4 |
| `apps/api/src/routes/payees.ts` | org | payroll.export | |
| `apps/api/src/routes/payroll.ts` | org | pay.self, payroll.approve, payroll.export | SIN, pay profile and bank routes (`apps/api/src/routes/payroll.ts:424-488`) rely on the central person guard only |
| `apps/api/src/routes/payrollFull.ts` | org | payroll.approve, payroll.export | |
| `apps/api/src/routes/payrollProvider.ts` | org | payroll.approve, payroll.export | |
| `apps/api/src/routes/people.ts` | org | reliability.read, reliability.write | |
| `apps/api/src/routes/planner.ts` | org | schedule.write | |
| `apps/api/src/routes/platform/auth.ts` | anon (console sign-in) | none | 2.4 |
| `apps/api/src/routes/platform/billing.ts` | console | any console admin | |
| `apps/api/src/routes/platform/books.ts` | console | any console admin | |
| `apps/api/src/routes/platform/cities.ts` | console | any console admin | |
| `apps/api/src/routes/platform/consents.ts` | console | any console admin | |
| `apps/api/src/routes/platform/index.ts` | console | none | Mounts the console API |
| `apps/api/src/routes/platform/integrations.ts` | console | any console admin | |
| `apps/api/src/routes/platform/leads.ts` | console | any console admin | |
| `apps/api/src/routes/platform/lifecycle.ts` | console | any console admin | |
| `apps/api/src/routes/platform/passkeys.ts` | console | own passkeys | |
| `apps/api/src/routes/platform/payroll.ts` | console | any console admin | |
| `apps/api/src/routes/platform/payrollTax.ts` | console | any console admin | |
| `apps/api/src/routes/platform/trust.ts` | console | trust.read, trust.manage | |
| `apps/api/src/routes/platform/updates.ts` | console | releases.manage | |
| `apps/api/src/routes/policies.ts` | org | policies.manage | |
| `apps/api/src/routes/preferences.ts` | org | preferences.self, schedule.write | |
| `apps/api/src/routes/programs.ts` | org | lessons.plan, or members.manage where either may (`anyOf`) | |
| `apps/api/src/routes/publicApi.ts` | key | key scopes | [docs/PUBLIC-API.md](docs/PUBLIC-API.md) |
| `apps/api/src/routes/publicApiShared.ts` | helper | none | Shared by the key routes |
| `apps/api/src/routes/publicApiWrite.ts` | key | write scopes; timeoff.approve of the key's maker | |
| `apps/api/src/routes/publicLogo.ts` | anon | none | |
| `apps/api/src/routes/reporting.ts` | org | users.read | Reporting lines |
| `apps/api/src/routes/reports.ts` | org | per report, in `apps/api/src/services/reports/catalog.ts` | |
| `apps/api/src/routes/roles.ts` | org | roles.manage, tenant.configure, users.read | |
| `apps/api/src/routes/rotations.ts` | org | schedule.write, winter.callout | |
| `apps/api/src/routes/scheduling.ts` | org | schedule.read, schedule.write, shiftboard.approve, shiftboard.assign_emergency, shiftboard.claim | |
| `apps/api/src/routes/serializers.ts` | helper | none | Response shapes |
| `apps/api/src/routes/settings.ts` | org | tenant.configure | |
| `apps/api/src/routes/shiftTemplates.ts` | org | schedule.templates, tenant.configure | |
| `apps/api/src/routes/signup.ts` | public, org | bookings.manage, members.manage | |
| `apps/api/src/routes/sms.ts` | org | none (own text number) | |
| `apps/api/src/routes/sso.ts` | public (sign-in), org | tenant.configure | 2.4 |
| `apps/api/src/routes/staff.ts` | org | billing.manage, certs.verify, discipline.write, positions.manage, users.read, users.scheduling, users.write | Adds `union.hub` to `/api/me` for the menu (`apps/api/src/routes/staff.ts:81`), not a check |
| `apps/api/src/routes/support.ts` | public (code exchange), org | tenant.configure | |
| `apps/api/src/routes/surveys.ts` | org | surveys.department, surveys.manage, surveys.respond, tenant.configure | |
| `apps/api/src/routes/trades.ts` | org | shiftboard.approve, shiftboard.post | |
| `apps/api/src/routes/union.ts` | org, hub | membership of the local (database role) | `union.hub` is in the matrix but no route checks it |
| `apps/api/src/routes/updates.ts` | public (maintenance notice), org | tenant.configure | |
| `apps/api/src/routes/winter.ts` | org | winter.callout, winter.manage, winter.patrol, winter.records | |
| `apps/api/src/routes/workRules.ts` | org | payroll.export, positions.manage, schedule.assist, schedule.write, tenant.configure | |

### 2.7 Cryptography (ASVS 11.1.1-11.1.4)

**Key management policy (current).**

- **Keys under KMS.** Key-encryption keys (KEKs) live in AWS KMS and never leave it: one per city
  (`alias/flexcity-tenant-<id>`), created as `SYMMETRIC_DEFAULT` encrypt/decrypt keys with
  rotation on (`apps/api/src/services/crypto/envelope.ts:166-175`), plus FH's own keys in Terraform
  (`ops/terraform/kms.tf`) and one key per union local, which operations creates
  (`apps/api/db/union_hub.sql:24`). Production refuses to start without `KMS_KEY_ARN`, and refuses a
  KMS replica region outside Canada (`apps/api/src/config.ts:163-168`).
- **Data keys.** A data key (DEK) is generated by KMS for each sealed record and wiped after use
  (`apps/api/src/services/crypto/envelope.ts:29-52`).
- **Secrets in memory.** Some secrets only work as raw values, so they are held in the app's
  memory: `JWT_SECRET`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `TWILIO_AUTH_TOKEN`,
  `VAPID_PRIVATE_KEY` and `METRICS_TOKEN` (`apps/api/src/config.ts:56,88-89,109,114,117`),
  `INTERNAL_API_TOKEN` (`apps/api/src/lib/ipRateLimit.ts:151`) and the role passwords inside the
  database URLs, all read from the environment. So are each city's SSO, webhook and bank
  credentials, unsealed when they are used.
- **Policy decision.** Whether this in-memory exception stands is open decision D-25
  (recommended: it stands for third-party secrets and DEKs, and FH's own token signing moves into
  KMS).
- **Key separation (gap).** One `JWT_SECRET` serves six purposes:
  - access tokens (`apps/api/src/auth/tokens.ts:26`);
  - SSO state (`apps/api/src/services/auth/sso.ts:32`);
  - sign-in codes (`apps/api/src/services/auth/mfaCodes.ts:23`);
  - text-number codes (`apps/api/src/routes/sms.ts:21`);
  - brute-force network ids (`apps/api/src/auth/bruteForce.ts:107`);
  - unsubscribe links (`apps/api/src/services/marketing/casl.ts:57`).

  Splitting it into one secret per purpose is planned (WP-41).

**Inventory.** Only the keys and algorithms FH has today. The target's mTLS, WebRTC and Ed25519 or
ES256 token-signing keys don't exist at FH.

| Asset | Purpose | Algorithm and size | Where it is kept | Rotation in force |
| :--- | :--- | :--- | :--- | :--- |
| City KEK | Wraps that city's data keys | KMS `SYMMETRIC_DEFAULT` (AES-256-GCM in KMS); FH can't choose AES-KW/KWP | KMS, multi-region copy in `ca-west-1` | KMS yearly rotation, enabled at creation (`apps/api/src/services/crypto/envelope.ts:175`); stored data keys aren't re-wrapped |
| FH's KMS keys | Platform key, also used for FH's own sealed data (`alias/flexcity-trust`, `ops/terraform/kms.tf:9-45`); database, backups and secrets key (`ops/terraform/kms.tf:53`); logs key (`ops/terraform/kms.tf:115`) | KMS `SYMMETRIC_DEFAULT` | KMS; only the platform key is multi-region with a replica in the recovery region (`ops/terraform/kms.tf:12,22`); the recovery region has its own separate data key (`ops/terraform/kms.tf:64`), and the logs key has none | Yearly (`ops/terraform/kms.tf:13,55,68,117`) |
| Union local KEK | Wraps that local's data keys (union messages, `apps/api/src/services/union/unionHub.ts:121`) | KMS `SYMMETRIC_DEFAULT` | KMS, one per local, created by operations (`apps/api/db/union_hub.sql:24`); not in Terraform | Not set in code or Terraform (gap) |
| Record data keys | Seal SINs, bank accounts, documents, narratives, résumés, Trust evidence | AES-256-GCM, 96-bit random IV, AAD (`apps/api/src/services/crypto/envelope.ts:29-52`) | Wrapped beside the record | A new key for every seal |
| Conversation data keys | Seal messages and files | AES-256-GCM, a fresh IV per part (`apps/api/src/services/messaging/crypto.ts:38-51`) | Wrapped on the conversation | One per conversation, never rotated (gap) |
| `JWT_SECRET` | The six purposes above; HS256 for tokens | HMAC-SHA-256, at least 32 characters (`apps/api/src/config.ts:56`) | Secrets Manager, injected as an environment variable | Only as an incident action. Rotating it ends every access token (`apps/api/src/auth/tokens.ts:26`); voids SSO sign-ins, sign-in codes and text-number codes in progress (`apps/api/src/services/auth/sso.ts:32`, `apps/api/src/services/auth/mfaCodes.ts:23`, `apps/api/src/routes/sms.ts:21`); makes every stored known-network id unrecognisable, so each person's next sign-in looks new (`apps/api/src/auth/bruteForce.ts:107`); and breaks unsubscribe links already sent ([docs/COMPLIANCE.md](docs/COMPLIANCE.md)) |
| Password and kiosk PIN hashes | Sign-in | scrypt at Node's default cost, 16-byte salt, 64-byte key (`apps/api/src/auth/tokens.ts:101-105`); no pepper | Database | Not re-hashed when parameters change (gap; WP-16) |
| Bearer secrets (refresh, console, kiosk, calendar, API keys, invitation links) | Sessions and links | 192 to 256 random bits, stored as SHA-256 | Database (hash only) | Per secret: rotation or expiry in 2.4 and 2.5 |
| Webhook signing secrets | Signing deliveries | HMAC-SHA-256 (`apps/api/src/services/integrations/signing.ts`) | Sealed with the city's key | A rotation keeps the previous secret for an overlap |
| Stripe webhook secret | Checking Stripe's signature | HMAC-SHA-256, constant-time compare (`apps/api/src/services/billing/stripe.ts:81-85`) | Secrets Manager | By hand |
| VAPID key | Web Push | P-256 ECDSA; content encryption is AES-128-GCM by RFC 8291 (`apps/api/src/services/notifications/push.ts:25`) | Secrets Manager | By hand |
| Bank SFTP and PGP keys | Deposit files | SSH host key pinned by SHA-256, OpenPGP encryption to the bank's key when one is set (`apps/api/src/services/payroll/bankLink.ts:62-88`) | The SSH password or private key is sealed with the city's key; the bank's PGP public key and host-key fingerprint are stored as given (`apps/api/src/services/payroll/bankLink.ts:20-35`) | The city's, quarterly per [docs/SECURITY-OPERATIONS.md](docs/SECURITY-OPERATIONS.md) |
| Database TLS | API to Postgres | `verify-full` against the checksum-pinned RDS bundle (`apps/api/src/config.ts:172-178`, `Dockerfile:21`); RDS CA `rds-ca-rsa2048-g1` (`ops/terraform/database.tf:73`) | - | AWS-managed |
| Edge TLS | Browsers to the load balancer | `ELBSecurityPolicy-TLS13-1-2-2021-06` (`ops/terraform/edge.tf:73`); certificate from ACM (`ops/terraform/variables.tf:35-38`) | ACM | ACM renewal |
| HIBP lookup | Breached-password check (off by default) | SHA-1; only 5 hex characters leave the server (`apps/api/src/auth/breachedPasswords.ts:26`) | - | - |

**Interop exceptions (open decision D-22).** FH chooses its own algorithms but not those of the
parties it talks to. Microsoft Entra ID signs ID tokens with RS256, SAML IdPs sign with
RSA-SHA256, Windows Hello passkeys are usually RS256, and banks hold RSA PGP keys. Today FH accepts:

- passkeys with EdDSA, ES256, ES512, PS256/384/512, RS256/384/512 and RS1 (`apps/api/src/services/auth/passkeys.ts:57-58`);
- SAML signatures with no restriction of FH's own: the library's RSA-SHA1/256/512 defaults apply (`apps/api/src/services/auth/sso.ts:249-267`);
- the SSH library's default lists, since FH sets none (`apps/api/src/services/payroll/bankLink.ts:77-88`): they include `ssh-rsa` (SHA-1) host keys, AES-CTR ciphers and `hmac-sha1`.

The recommended answer to D-22 keeps RS256, RSA-SHA256 and RSA PGP as listed exceptions and removes
RS1, SHA-1 SAML signatures, SSH `ssh-rsa` host keys, CTR modes and HMAC-SHA1 (planned, WP-39 and WP-54).

**Post-quantum plan (planned, not started).**

- **Stage 1:** AES-256-GCM for FH's own data, which is in place. The hash floor is open: the
  target's SHA-384 line contradicts its own approval of SHA-256 (D-26). Hybrid post-quantum TLS
  at the edge waits on AWS support in `ca-central-1` (D-39).
- **Stage 2:** ML-KEM between services, once internal TLS exists (today the load balancer and the
  web service reach the API over plain HTTP inside the VPC: `ops/terraform/edge.tf:18-24` and
  `ops/terraform/compute.tf:203-205`).
- **Stage 3:** FH owns no asymmetric signing keys or internal PKI to migrate. Passkeys don't offer
  ML-DSA (`apps/api/src/services/auth/passkeys.ts:52-58`).

**Not applicable:** WebRTC DTLS-SRTP keys, because FH has no WebRTC.

### 2.8 External services (ASVS 13.1.1-13.1.4)

User-supplied destinations (typed in by a city) are marked **city**. Outbound HTTPS to city
addresses goes through `apps/api/src/lib/egress.ts`: https only, no credentials in the URL, the
address resolved and refused if any resolved address is private, and the connection pinned to the
checked address. The exception is the payroll providers (gap): their addresses are limited to the
provider's domain (`apps/api/src/services/payroll/providers.ts:49-61`) but sent with a plain
`https.request` (`apps/api/src/services/payroll/providers.ts:77-87`), with no private-address
check, no pinning and no response cap. There is no network-level egress allowlist (`ops/terraform/network.tf:204-218`
allows all outbound traffic; D-30).

| Service | Authentication | Pool or concurrency | Timeouts and retries | When it fails |
| :--- | :--- | :--- | :--- | :--- |
| Postgres, app role | Password over TLS `verify-full` (`apps/api/src/config.ts:172-178`); least-privilege role checked at startup (`apps/api/src/lib/dbRole.ts`) | 25 per process by default (`apps/api/src/config.ts:19`) | Pool wait 20 s (`apps/api/src/config.ts:20`, `apps/api/src/lib/prismaClient.ts:54`); statements 120 s (`apps/api/db/rls.sql:172`); no retry | 503 `BUSY` with `Retry-After` |
| Postgres, Union Hub role | Same | 5 (`apps/api/src/services/union/unionHub.ts:22`), no connect or queue timeout (gap) | Statements 30 s (`apps/api/db/rls.sql:167`) | Waits with no deadline (gap) |
| Postgres, LISTEN and worker lock | Same | One connection each, no connect timeout (gap) | - | - |
| AWS KMS | IAM task role | SDK defaults | SDK defaults | The request fails |
| AWS Secrets Manager | IAM execution role | At task start only | - | The task doesn't start |
| City identity provider (OIDC discovery, token, JWKS; SAML) | **city**; client secret sealed with the city's key, PKCE, issuer pinned (`apps/api/src/services/auth/sso.ts:153-216`) | No cap; a new connection per call | 8 s and 1 MB per call, no retry (`apps/api/src/services/auth/sso.ts:113`); JWKS cached 10 minutes | Sign-in refused with an SSO error code |
| City webhooks | **city**; HMAC signature | Worker queue, one run per city per worker | 10 s per delivery by default (`apps/api/src/config.ts:40`), up to 8 tries with back-off, redirects not followed | Endpoint disabled after 20 failures in a row (`apps/api/src/config.ts:39`) |
| City bank (SFTP) | **city**; SSH key, pinned host key (`apps/api/src/services/payroll/bankLink.ts:81-88`) | One per send | 20 s handshake only; transfer has no deadline (gap) | - |
| ADP, Dayforce, Wagepoint | **city** credentials (client secret, ADP client certificate, Wagepoint API key), sealed | One per send | 30 s of socket inactivity, no total deadline (`apps/api/src/services/payroll/providers.ts:79-84`) | - |
| Amazon SES (email; only when `MAIL_PROVIDER=ses`, else the console mailer, `apps/api/src/config.ts:98-101`) | AWS SDK default credentials; no SES permission is granted in Terraform yet (gap) | One client per process | 3 s connect, 10 s per request, at most 2 attempts (`apps/api/src/services/notifications/sesMailer.ts:52-54`) | - |
| Twilio | Account SID and auth token | - | 15 s (`apps/api/src/services/notifications/sms.ts:108`) | - |
| Web Push services | VAPID | - | No timeout (gap) | - |
| Stripe | Secret key | - | No timeout, redirects followed (`apps/api/src/services/billing/stripe.ts:58`) (gap) | - |
| Environment and Climate Change Canada | None (open data, `apps/api/src/config.ts:46`) | Worker only | 10 s by default (`apps/api/src/config.ts:47`) | The forecast runs without weather |
| HIBP (off by default) | None | - | 2 s, fails open (`apps/api/src/auth/breachedPasswords.ts:1-17`) | Password accepted |
| Error tracking (off unless `SENTRY_DSN`) | DSN; host checked as public, not pinned (`apps/api/src/lib/errorReporter.ts:182`) | - | 5 s (`apps/api/src/lib/errorReporter.ts:207`) | - |
| Rate-limit store | Postgres `RateLimitHit` rows (`apps/api/src/auth/rateLimit.ts`); the per-address limiter is in memory (`apps/api/src/lib/ipRateLimit.ts`) | Shares the app pool | Same as the app role | 503; no Redis or Valkey (D-29) |

The target's 3 s statement timeout and 250 ms pool wait would break city-wide pay runs (7-15 s,
[docs/SCALABILITY.md](docs/SCALABILITY.md)); tiered timeouts are open decision D-28. There is no
application circuit breaker (gap; WP-48).

**Secrets.** The app secret in Secrets Manager holds `JWT_SECRET`, `APP_DATABASE_URL`,
`LISTEN_DATABASE_URL` and `METRICS_TOKEN` by default, `FLEXCITY_APP_PASSWORD` (read by the roles
task, `ops/terraform/README.md:66`, `ops/terraform/compute.tf:150`) and, when set,
`FLEXCITY_UNION_PASSWORD`, plus optional provider keys
(`ops/terraform/variables.tf:132-141`) and the optional `INTERNAL_API_TOKEN`, the only key the web
tasks also receive (`ops/terraform/compute.tf:36`). The database owner password is not in it: RDS manages and
rotates it (`ops/terraform/README.md:74`). Only that password and the KMS keys rotate on a
schedule. `JWT_SECRET`, `METRICS_TOKEN`, `INTERNAL_API_TOKEN`, the app and union role passwords, VAPID, Stripe, Twilio
and Sentry have no rotation schedule (gap; D-31 and WP-53).

### 2.9 Data classification (ASVS 14.1.1, 14.1.2)

| Level | FH data (examples, verified) | Current protection | Decided target | Open decision | Deviation and compensating control |
| :--- | :--- | :--- | :--- | :--- | :--- |
| L3 restricted | Password and PIN hashes (`apps/api/src/auth/tokens.ts:101-105`); refresh, console, kiosk, calendar and API key hashes; SINs (`apps/api/prisma/schema.prisma:2601`); bank account numbers (`apps/api/prisma/schema.prisma:2621`); incident narratives (`apps/api/prisma/schema.prisma:1400`); employee documents (`apps/api/prisma/schema.prisma:3078`); messages (`apps/api/prisma/schema.prisma:4368`); webhook and SSO secrets; encryption keys | Secrets stored only as hashes; records sealed with AES-256-GCM under a per-record key wrapped by the city's KMS key (`apps/api/src/services/crypto/envelope.ts:29-52`); RLS; TLS | Unchanged | D-20a (which other fields to seal) | Health-adjacent notes stay plaintext columns today: lesson and member safety notes (`apps/api/prisma/schema.prisma:1650`, `apps/api/prisma/schema.prisma:2336`) |
| L2 personal | Names, emails, phones, date of birth (`apps/api/prisma/schema.prisma:542`), addresses, schedules, pay, check-in locations (`apps/api/prisma/schema.prisma:2122`), audit logs | RLS and volume encryption (RDS with KMS); the service worker caches only the person's own `/api/me`, rosters, open punch, shifts and facilities (`apps/web/public/sw.js:20-27`) | Column encryption of all L2 is not planned | D-20a, D-11 (offline data on shared phones) | Schedules and payroll are queried in SQL; RLS plus volume encryption is the control |
| L1 internal | Settings, shift templates, ids | RLS | - | - | Kept as live configuration, not on a 90-day clock |
| L0 public | Marketing site, public job postings, logos | TLS | - | - | No `security.txt` yet: the reporting address is a placeholder |

Retention follows the law, not a flat 365 days ([docs/RETENTION.md](docs/RETENTION.md); payroll
records under `Tenant.payrollRetentionYears`, `apps/api/src/services/privacy/erasure.ts:37`).
Confirming that is open decision D-20e.

### 2.10 Dependencies and dangerous functionality (ASVS 15.1.1-15.1.5)

**Remediation targets.**

| Severity | Current ([docs/SECURITY-OPERATIONS.md](docs/SECURITY-OPERATIONS.md)) | ASVS target document | Status |
| :--- | :--- | :--- | :--- |
| Critical | 48 hours | 24 hours (48 at most), CVSS 9.0+ or known exploited | Gap; open decision D-37 |
| High | 7 days | 7 days, CVSS 7.0-8.9 | Met |
| Medium | 30 days | 30 days, CVSS 4.0-6.9 | Met |
| Low, and library freshness | None stated | 90 days | Gap; open decision D-37 |

The current targets don't say whether they cover development dependencies (D-37).

**Checks in place.**

- CodeQL runs on pull requests, pushes to `main` and a weekly schedule (`.github/workflows/security.yml:6-11,17-30`).
- `npm audit --omit=dev --audit-level=high` fails the build (`.github/workflows/security.yml:47`).
  Development dependencies aren't audited by CI (gap).
- gitleaks scans the whole history (`.github/workflows/security.yml:55-75`).
- Dependabot opens weekly pull requests, after a cooldown, for npm, GitHub Actions, Docker and
  Terraform (`.github/dependabot.yml`).
- The lockfile pins every package by sha512 integrity. `package.json:16-21` lists the packages
  whose install scripts are allowed.
- The Docker base image is pinned by digest (`Dockerfile:13`) and the RDS certificate bundle by
  checksum (`Dockerfile:21`).
- No SBOM is produced (gap; WP-45).

**Resource-demanding work.**

| Work | Where it runs today | Protection | Gap |
| :--- | :--- | :--- | :--- |
| Pay runs and payroll-provider exports | In the request, with a 120 s transaction limit ([docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)); 7-15 s for a city-wide run ([docs/SCALABILITY.md](docs/SCALABILITY.md)) | Transaction limit | Not a background job (D-32) |
| Fill the schedule (solver) | In the request (`apps/api/src/routes/fill.ts:80-88`), on the event loop | A time budget per week | One city's solve blocks that API process for every city (D-32) |
| City data export | Streamed in the request (`apps/api/src/routes/dataExport.ts`) | Whole-organization permission | No back-pressure |
| Password and PIN hashing | scrypt on the libuv pool (`apps/api/src/auth/tokens.ts:101-113`) | Sign-in rate limits (2.4) | - |
| Upload parsing | 14 MB JSON parser on four POST routes: employee documents (two) and conversation messages (`apps/api/src/app.ts:71-76`), and Trust evidence (`apps/api/src/routes/platform/index.ts:23`) | Size caps (2.3) | - |
| PDF generation | pdfkit in the request (`apps/api/src/services/privacy/recordsPdf.ts`, `apps/api/src/services/privacy/consentCertificate.ts`, `apps/api/src/services/trust/exports.ts`) | - | - |
| Notifications, emails, texts, push, webhooks, scheduled reports, retention, weather | Worker ([docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)) | Outbox with retries | - |

**Risky components and dangerous functionality.** None of these runs in a separate sandbox. The
API container is the boundary (target 15.2.5: gap).

| Component (`apps/api/package.json`) | Why it is risky | Where it is used |
| :--- | :--- | :--- |
| `@node-saml/node-saml` 5.2.0 | Parses and checks XML signatures from city IdPs | `apps/api/src/services/auth/sso.ts:251-294` |
| `openpgp` 6.3.2 | Parses keys a city pastes in | `apps/api/src/services/payroll/bankLink.ts:51,63` |
| `ssh2` 1.17.0 | Talks to bank servers | `apps/api/src/services/payroll/bankLink.ts:77-88` |
| `pdfkit` | Decodes an uploaded PNG signature into a PDF | `apps/api/src/services/privacy/consentCertificate.ts`, `apps/api/src/services/privacy/recordsPdf.ts`, `apps/api/src/services/trust/exports.ts` |
| `jose`, `@simplewebauthn/server` | Token and passkey verification | `apps/api/src/auth/tokens.ts`, `apps/api/src/services/auth/passkeys.ts` |
| `web-push`, `fflate` | Push encryption; ZIP output | `apps/api/src/services/notifications/push.ts`; `apps/api/src/services/platform/cityExport.ts`, `apps/api/src/services/trust/exports.ts` |
| FH's own parsers | Magic-byte sniffing (`apps/api/src/lib/files.ts:15-20`), the staff CSV parser (`apps/api/src/services/platform/staffImport.ts:17-47`), JSON in a report query string (`apps/api/src/routes/reports.ts:44`) | Uploads, Dev console import, reports |

### 2.11 Security logging (ASVS 16.1.1)

| Layer | What is recorded (verified) | Where and how long | Gaps |
| :--- | :--- | :--- | :--- |
| Load balancer | Access logs: addresses, paths, status (no bodies) (`ops/terraform/edge.tf:10`) | S3 bucket, 90 days (`ops/terraform/storage.tf:170-200`) | WAF requests aren't logged (no WAF logging configuration in Terraform) |
| Application output | Errors cut to their code and first line, no request data (`apps/api/src/lib/log.ts:9-22`) | CloudWatch log groups `aws_cloudwatch_log_group.svc` for api, worker, web and migrate, 90 days, KMS-encrypted (`ops/terraform/compute.tf:9-14`) | No line per denied request (gap, WP-10b) |
| Database | Slow statements and errors (`ops/terraform/database.tf:25`) | `aws_cloudwatch_log_group.postgresql`, `db_log_retention_days` (default 30, `ops/terraform/variables.tf:121-124`) | - |
| City audit log | `AuditLog` rows (`apps/api/prisma/schema.prisma:1520`): sign-in locks and address blocks (`apps/api/src/routes/auth.ts:142,150,180`), single sign-on and refusals (`apps/api/src/services/auth/sso.ts:333,337`), codes (`apps/api/src/routes/mfaCodes.ts:121,131`), passkeys added and removed (`apps/api/src/routes/passkeys.ts:170,196`), each support-visit page (`apps/api/src/auth/middleware.ts:126`), and business changes | Postgres, under RLS, for the life of the account | Successful sign-ins, session start and end, refresh-token reuse and denied requests aren't recorded (WP-10); no request id or address column |
| Dev console audit | `PlatformAudit` rows (`apps/api/prisma/schema.prisma:1777`), including console locks (`apps/api/src/routes/platform/auth.ts:55-63`) | Postgres | Same as above |
| Union Hub | `union_hub.access_log` (`apps/api/db/union_hub.sql:66-72`), written on each hub action (`apps/api/src/services/union/unionHub.ts:104`) | Postgres, append-only for the hub role (`apps/api/db/union_hub.sql:74`) | No address or request id; nobody reads it in the app |
| Metrics | Sign-in failures, locks and blocks (`apps/api/src/lib/metrics.ts`) | `/metrics` with `METRICS_TOKEN` (`apps/api/src/routes/observability.ts:41-43`) | Alerts in [docs/SECURITY-OPERATIONS.md](docs/SECURITY-OPERATIONS.md) aren't deployed yet |
| Error tracking | Server and browser errors, scrubbed (`apps/api/src/lib/errorReporter.ts`, `apps/api/src/lib/scrub.ts`) | Only when `SENTRY_DSN` is set (`apps/api/src/lib/errorReporter.ts:173`) | - |

What is logged and for how long is open decision D-21 (recommended: denials plus sensitive access,
365 days for security logs, deleted at offboarding).

## 3. Deviations and open decisions

### 3.1 Deviations from the ASVS Level 3 target

These are the places where FH chooses not to follow the generic Level 3 target, or can't, with the
reason. Each is a deviation until the owner says otherwise.

| Target requirement | FH's position | Compensating control |
| :--- | :--- | :--- |
| Hardware-attested MFA on every login (6.3.3) | **Decided (decision 1):** passkeys for admin, HR and payroll roles, first. **Pending (D-38):** managers, city admins and the Dev console; other staff keep password and current second-factor rules; kiosk device sign-in | Kiosk punches only; seasonal staff on personal phones aren't locked out |
| Stateful `__Host-session` cookie (AUTH-01) | In-memory bearer access token plus a path-scoped refresh cookie (2.5) | D-12; moving to cookie-only sessions brings CSRF exposure to every route |
| Argon2id for passwords | scrypt; ASVS 11.4.2 accepts any approved KDF with current parameters | Parameters and pepper to be recorded (WP-16) |
| Column encryption of all L2 personal data (14.1.2) | Not planned: schedules and payroll are queried in SQL | RLS, volume encryption, L3 sealing (2.9) |
| Confidential computing (11.7.1) | Not planned | AWS Fargate and RDS in Canada only |
| Seven-year WORM log archive (16.4.x) | Conflicts with deleting a city's data at offboarding | D-21 |
| `Clear-Site-Data: "cookies", "storage"` (14.3.1) | Would unpair kiosks and wipe other workers' unsent punches on shared phones | "cache" plus targeted cleanup (D-11, recommended) |
| TLS 1.3 only at the edge | Older phones and tablets need TLS 1.2 | D-9 |
| 30-minute idle timeout for shift workers | **Decided (decision 2)** with a condition: punch and safety check-ins keep working through quick passkey or PIN re-entry | Planned, WP-17; the re-entry path comes first |
| Ed25519 / RFC 9421 signatures on all integrations (4.1.5) | Webhooks are HMAC-signed (section 5); bank and partner support is unknown | D-15 |
| Per-user 30/min and per-city 300/min caps, 500 ms timing floor | Would refuse shift-change punches, offline queue flushes and lone-worker check-ins | D-4, D-5, D-6 |
| Flat 365-day deletion of L2 data | Payroll and OHS records have legal retention periods | D-20e |
| One page CSP on every response | JSON answers get a deny-all CSP (`apps/api/src/app.ts:99`) and files a sandboxed one (`apps/api/src/lib/files.ts:44`); the marketing site is a static export | - |
| WebRTC, TURN, media, WebSocket and 3D requirements (V17, parts of V3 and V4) | Not applicable: FH has none of these (section 1) | - |

### 3.2 Open decisions

The owner hasn't decided these. The recommendation is the author's, not a decision.

| # | Question | Recommended (not decided) |
| :--- | :--- | :--- |
| D-1 | Is Level 3 a hard merge gate now? | The section 4 gate binds every new change; existing gaps stay in this ledger with target dates. |
| D-2 | Where the ledger lives | In this file, after the reporting policy (as here). |
| D-3 | Characters allowed in names | Refuse only control, invisible and bidirectional characters, with NFC normalisation, so First Nations orthographies and French names work. |
| D-4 | Per-person mutation cap | About 120 a minute, logged before enforced, sized from real traffic; never refuse punches, lone-work check-ins or help requests. |
| D-5 | Per-city cap | Alert at 80% of a measured ceiling; don't refuse. |
| D-6 | Human-timing floor | Anonymous public forms only, as a soft signal. |
| D-7 | Who may switch off two-person pay-run approval | Switching it off is itself a two-person action; on by default. |
| D-9 | Browser baseline and edge TLS | Safari 16.4 / Chrome 111 floor, secure-context and WebCrypto checks; TLS 1.3 at the edge only after measuring. |
| D-10 | HSTS preload | Once every planned subdomain serves valid HTTPS. |
| D-11 | Offline data on shared phones | Keep offline rosters and the timeclock, per person, expiring, minimised, purged at sign-out; `Clear-Site-Data: "cache"` only. |
| D-12 | Cookie prefix and token model | `__Secure-` with path scoping; the bearer access token recorded as a deviation. |
| D-14 | GitHub Pages demo | Sample data only, with a fuller meta CSP. |
| D-15 | Message signatures | Sign bank files where the bank verifies; RFC 9421 optional for payroll write scopes; HMAC and Ed25519 webhooks both offered. |
| D-16 | Uploads | Downscale images in the browser to 5 MiB; pixel caps on signatures and logos; per-city ceiling plus a per-uploader soft cap; asynchronous ClamAV in ca-central-1, résumés first; strip image metadata. |
| D-17 | Authentication details | No device fingerprinting; a local breached-password list rather than HIBP; keep text codes for roles that don't need a passkey; passkeys for union stewards; 5-minute passkey step-up accepted without device posture; default 12-month API key expiry; 6-digit kiosk PINs with locks capped at 1 hour. |
| D-18 | Single sign-on session coordination and kiosks | Re-check with the IdP every 12 hours; front-channel and SAML logout first; `max_age=900` for admins; no forced kiosk expiry. |
| D-19 | Risk engine and console roles | Log-only first, never deny punch or safety routes; split console powers once FH has more than two operators. |
| D-20 | Data protection | Seal unqueried free text only; confidential computing as a deviation; ask before sending location with a help alarm; keep the calendar link; law-driven retention. |
| D-21 | Logging scope | Denials plus sensitive access; no read logging; 365 days for security logs, deleted at offboarding; HR admins read the audit log through `audit.read`. |
| D-22 | RSA from third parties (Entra RS256, RSA-SHA256 SAML, RS256 passkeys, RSA PGP bank keys) | Accept them as listed interop exceptions, reviewed yearly; remove RS1 passkeys, SHA-1 SAML, SSH CTR modes and HMAC-SHA1. |
| D-25 | Key custody | Third-party secrets and data keys stay in app memory as a recorded exception; FH's own token signing key moves into KMS. |
| D-26 | Hash floor | SHA-256 is approved; new stored formats carry an algorithm id so a later change is cheap. |
| D-27 | OCSP stapling and Encrypted Client Hello | Record both as unsupported by FH's AWS edge, rather than terminating TLS at edge locations outside Canada; re-check yearly. |
| D-28 | Database time budgets | A pool wait of a few seconds; a short default statement timeout with longer ones only for named payroll, export and report paths. |
| D-29 | Rate-limit store | Keep the Postgres-backed limiter, with its own short timeouts; no Redis or Valkey. |
| D-30 | Network egress allowlist | An egress firewall at the first paying customer, with webhook ports 443 and 8443; application-level checks until then. |
| D-31 | Scheduled `JWT_SECRET` rotation | Split the secret per purpose first (WP-41), then rotate on a schedule. |
| D-32 | Heavy work off the request path | Fill the schedule and pay runs become start-then-poll background jobs, at most 2 per person. |
| D-33 | How the quick PIN re-entry of decision 2 works on a personal phone | Reuse the kiosk PIN as a device-bound re-entry factor for punch and lone-work routes only, never other screens, with a peppered KDF from the start. |
| D-34 | How short blocklist words (hr, dev) are matched | Words of 4 or more letters as substrings after leet-folding; 2-3 letter words only as whole tokens. |
| D-35 | Recovery when a passkey-mandatory person loses their only passkey | An HR-issued one-time enrolment link that needs a second HR member or the CAO, with a notice to the person. |
| D-36 | Passkey attestation | Accept synced passkeys; attestation would exclude most personal phones. |
| D-37 | Vulnerability remediation targets | Adopt the owner's ASVS target document's values: Critical (CVSS 9.0+ or known exploited) 24 hours, 48 at most; High 7 days; Medium 30 days; Low and library freshness 90 days; covering runtime, build and development dependencies. |
| D-38 | Confirm the details listed as pending in section 2.0 | Confirm them as written: the gap analysis and the work packages were planned on them. |
| D-39 | Hybrid post-quantum TLS at the edge | Adopt an AWS post-quantum hybrid policy once it is available in `ca-central-1`, checked by the Terraform plan test. |

## 4. Pre-merge gate

Every pull request answers these in its description (`.github/pull_request_template.md`):

1. **Ledger.** Did this change add or change anything section 2 lists? Then the row is updated in this
   pull request, and anything not built is marked planned or gap.
2. **Input and output.** Inputs are validated by zod in the API and encoded at the sink; no `eval`,
   unsafe parsing or backtracking regex.
3. **Sign-in, session and access.** Every new route checks sign-in, permission, the caller's city
   (RLS) and department or facility scope, and returns only the fields the caller may see; a guard
   reads the same value the handler acts on.
4. **Secrets and cryptography.** No secret in code, logs or build output; only primitives already in
   the ledger; constant-time comparison for secrets.
5. **Browser and privacy.** No sensitive data in `localStorage`, `sessionStorage`, IndexedDB or URLs
   beyond what 2.9 lists; CSP and `no-store` intact.
6. **Concurrency, errors and logging.** Check-then-act runs in one transaction or under a lock;
   outside calls have timeouts; failures are generic to the caller; security events are recorded
   without personal data.
7. **Tests.** Positive and abuse-case tests for every new endpoint, failing before the change and
   passing after.

## 5. How FH is protected today

### How the product is checked

- Every change: unit and integration tests (including `apps/api/test/integration/hardening.test.ts`,
  which replays each attack found in reviews), a dependency audit, and CodeQL static analysis
  (`.github/workflows/security.yml`, also weekly).
- Dependencies: Dependabot updates for npm, GitHub Actions, the Docker base image and the Terraform
  provider, with a cooldown before a new release is proposed; high or critical advisories fail the
  build. Actions are pinned to commit SHAs, workflow tokens are read-only unless a job needs more,
  and the whole git history is scanned for secrets with gitleaks on every change.
- Reviews: an adversarial code review and a role-by-role privacy review (November 2026), recorded in
  [docs/SECURITY-LEGAL-AUDIT.md](docs/SECURITY-LEGAL-AUDIT.md).
- Before the first city goes live and yearly after: an independent penetration test
  ([docs/SECURITY-OPERATIONS.md](docs/SECURITY-OPERATIONS.md)).
- Continuously: the Dev console's Trust area tests the platform's real state every few minutes
  (row-level security on every city table, the database role, passkeys for console admins, keys,
  headers, backups and retention, stale or departed accounts) and tracks FH's controls, evidence,
  policies, risks, vendors and customer commitments against SOC 2, ISO 27001, PIPEDA, provincial
  privacy laws and Law 25 ([docs/TRUST-CENTER.md](docs/TRUST-CENTER.md)). It's a self-assessment,
  not a certification.

### SQL injection

Layered, so no single slip opens the database:

1. **No values in SQL text.** Queries go through Prisma, or `$queryRaw` / `$executeRaw` as tagged
   templates (every `${}` is a bound parameter); the Union Hub's `pg` queries use `$1` placeholders.
   Only identifiers (table and column names from the database's own catalogue) are ever spliced in,
   through `ident()` (`apps/api/src/lib/sqlIdent.ts`), which accepts plain names only.
2. **A test that fails the build** (`apps/api/test/unit/sqlSafety.test.ts`) scans every source file for
   SQL built from values: untagged raw calls, `Prisma.raw`, `${}` in unsafe or `pg` queries, string
   concatenation. A reviewed exception has to say why, on the line above it.
3. **Every input is validated** with zod schemas (types, lengths, formats) before it reaches a query;
   the website's enquiry form has the same limits, and the site itself has no database.
4. **The database role limits the damage**: the runtime roles aren't superusers, can't bypass
   row-level security, can't create, drop or alter tables, make temporary tables, or delete from
   most tables, and have a statement time limit. Without a city chosen, row-level security shows
   no rows. The servers refuse to start in production with a more powerful role
   (`apps/api/src/lib/dbRole.ts`).
5. **Attack tests** (`apps/api/test/integration/sqlInjection.test.ts`) throw the classic payloads at
   sign-in, the organization header, path parameters, search and the enquiry form, and check the
   database role's limits directly.

### One city never sees another

- **Row-level security** on every table that holds a city's rows: inside a city's request the
  database returns and accepts that city's rows only, and with no city chosen, none. FH's own
  billing and Dev console tables (invoices, debits, support visits) show a city only its own rows
  too; only FH's billing and console, which run with no city chosen, read across cities.
- **Every request** carries a sign-in bound to one city; using it at another city's address is
  refused. Live notifications are matched on both the person and the city and carry only an id.
- **Checked in CI** (`apps/api/test/integration/crossCity.test.ts`): every table with a city's rows
  must have row-level security and a policy; every API route is called as one city's HR
  administrator and lifeguard with the other city's record ids, and fails if anything of the other
  city comes back or changes.
- **The only thing shared is anonymous:** benchmarks (`/manage/benchmarks`) compare a city with
  others only when it opts in, from cities that opted in, as quartiles, and only when at least five
  cities contribute; no city, person or count of people is identifiable. A city that opts out
  neither contributes nor sees them.

### Secrets, shared tablets and texts

- **API keys** for a city's own systems (`/api/v1`, [docs/PUBLIC-API.md](docs/PUBLIC-API.md)) are 256-bit
  random secrets with a visible prefix; only a SHA-256 is stored and the key is shown once. Each is scoped,
  optionally limited to IP ranges and an expiry date, rate-limited per key in Postgres, and every call is
  in the city's audit log. A key can only be given scopes whose data its maker can see. The organization
  is found from the hash, then every request runs under RLS. Revoking is immediate; rotating keeps the old
  key for 24 hours. Keys never work on the app's session routes.
- **API writes** are opt-in per key (write scopes, confirmed in Settings and badged “Write”), given only by
  someone holding the matching permission for the whole organization. A key writes with its maker's
  current access (re-checked on every request; it stops if they leave or lose it), through the same
  services and rules as the app, never deletes, and refuses SIN, bank, pay, birth-date and health fields.
  Ids in a body are looked up under RLS first, so another organization's record is "not found", never
  linked (foreign keys alone don't check the tenant). Every change is audited with the key as the actor
  (`AuditLog.apiKeyId`). POST needs an Idempotency-Key (kept 24 hours under RLS; a reused key with another
  body is refused), changes take If-Match/ETag (412), and writes have their own per-key rate limit.
- **Webhooks** are signed Stripe-style (`FH-Signature: t=<seconds>,v1=<HMAC-SHA256 of "t.body">`) so
  receivers can refuse forged and replayed messages. Signing secrets are sealed with the city's key
  (they must be read back to sign) and shown once. Payloads carry ids and changed field names only.
  Addresses must be https on the public internet, checked when saved and before every send, the
  connection goes to the checked address, and redirects are never followed (SSRF; `apps/api/src/lib/egress.ts`).
  Delivery records keep the response code and 500 characters of the answer, never a secret.

- **Links and devices that act without a sign-in** (a person's calendar feed, a facility kiosk) carry a
  long random secret. Only its SHA-256 hash is stored, it's shown once, and making a new one or
  removing it stops the old one at once (`apps/api/src/routes/calendar.ts`, `apps/api/src/routes/kiosk.ts`).
- **Kiosk PINs** are hashed with scrypt like passwords; easy PINs are refused. Five wrong PINs in 15
  minutes lock an employee number for 15 minutes, doubling with each further lock that day up to 24
  hours; 15 wrong PINs on one tablet in 15 minutes pause the tablet for 15 minutes
  (`apps/api/src/routes/kiosk.ts:208-217`).
- **Text-message codes** are 6 digits, so a plain hash could be reversed: they're stored as an HMAC
  keyed with the server secret, expire in 10 minutes, and sending and checking are rate-limited.
- **CSV downloads** from Reports prefix any cell that starts with `=`, `+`, `-`, `@`, a tab or a
  carriage return, so a spreadsheet won't run it as a formula
  (`apps/api/src/services/reports/catalog.ts`).
- **Punches sent later** (no signal at the time) are checked by the server like any other: re-sent ids
  are recognised (never a double punch), the phone's clock difference is measured and corrected, and
  times in the future, more than 3 days old or out of order are refused; the rest are flagged
  "Recorded offline" for review. Waiting punches are kept per person on the phone and deleted at sign-out
  (`apps/api/src/services/timeclock/punches.ts`).
- **Reporting lines** only route approvals and default reviewers: a manager hears about or acts on a
  request only when their own permissions and department scope already allow it
  (`apps/api/src/services/people/reporting.ts`).
- **Operations endpoints:** `/metrics` answers only with `METRICS_TOKEN` (404 without the setting), and
  `/readyz` shows counts and ages, never an organization's data. Error reports (server and browser) are
  scrubbed of emails, tokens, SINs and similar before they leave, and only sent when `SENTRY_DSN` is set
  (`apps/api/src/lib/errorReporter.ts`, `apps/api/src/lib/scrub.ts`).
