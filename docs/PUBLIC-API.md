# Public API and webhooks

A city's own systems (an ERP such as SAP, Tempest or Amanda, an HRIS, a GIS) can **read** its FlexcityHeadquarters
data through a versioned API, **send changes in** with keys given write scopes (people, departments, positions, time off),
and be **told** when something changes through signed webhooks. Both are set up in the app
under **Settings › Integrations** by an administrator (the `tenant.configure` permission, normally HR).

- Machine-readable description: `GET /api/v1/openapi.json` (OpenAPI 3.1, no key needed).
- Plan: the **API and webhooks** option (`publicApi`, integration group), standard in Multi-complex and Enterprise and
  available as an add-on elsewhere ([pricing](PRICING.md)). Without it, administrators can see what is set up but can't add
  keys or webhooks (`403 PLAN_REQUIRED`), existing keys answer `403 PLAN_REQUIRED`, and no new events are queued.
- Keys read by default. A key changes data only if it was given a **write scope** (marked “Can change data” in Settings,
  with a confirmation). See [Writing data](#writing-data).

## API keys

| | |
| --- | --- |
| Format | `fh_live_<8 characters>_<43 characters>`. The first part (the *prefix*, e.g. `fh_live_ab12cd34`) is shown on screens to tell keys apart; the rest is the secret. |
| Storage | Only a SHA-256 of the whole key is kept. The key is shown **once**, when it's made or rotated. |
| Read scopes | `people:read`, `departments:read`, `positions:read`, `facilities:read`, `schedule:read`, `timesheets:read`, `timeoff:read`, `payroll:read`. A key can only be given scopes whose data the person making it can see (e.g. `payroll:read` needs `payroll.export`). |
| Write scopes | Opt-in per key: `people:write` (needs `users.write`), `departments:write` (`tenant.configure`), `positions:write` (`positions.manage`), `timeoff:write` (`leave.manage` or `timeoff.approve`), `timeoff:approve` (`timeoff.approve`: send time off in already approved). Only someone holding the permission **for the whole organization** can give one (keys are organization-wide, so a department-limited supervisor can't). The key writes with its maker's access, checked on every request: if they leave or lose the permission, its writes answer `403 KEY_OWNER_INACTIVE` / `KEY_OWNER_LACKS_PERMISSION` (reads keep working). The key list shows a **Write** badge. |
| IP allow list | Optional IPv4/IPv6 addresses or CIDR ranges (`203.0.113.0/24`). Empty = any address. |
| Expiry | Optional date; after it the key answers `401 API_KEY_EXPIRED`. |
| Rotate | Makes a new key with the same settings. The old key keeps working for **24 hours**, so your systems can switch over. |
| Revoke | Immediate: `401 API_KEY_REVOKED`. |
| Rate limit | 120 requests a minute per key by default, counted in the database (shared by every API server). Writes also count against their own limit of 60 a minute per key (or the key's limit, if lower). Every answer carries `X-RateLimit-Limit`, `X-RateLimit-Remaining` and `X-RateLimit-Reset` (seconds until the oldest request in the minute ages out). Over a limit: `429 RATE_LIMITED` with `Retry-After` (the same number of seconds). An address that sends 20 missing, unknown, revoked or expired keys in 10 minutes gets `429 RATE_LIMITED` (`Retry-After: 600`) for the rest of that window, whatever key it sends. |
| Audit | Making, rotating and revoking keys, and **every API request** (method, path, request id), are in the organization's audit log. Every change a key makes is audited like the same change in the app, with the key as the actor (`apiKeyId`, “API key Payroll sync”) instead of a person. Settings › Integrations shows each key's last use and request count. |

Authenticate with a bearer header. API keys are not sessions: they don't work on the app's own `/api/…` routes, and a
person's session token doesn't work on `/api/v1`.

```bash
curl -H "Authorization: Bearer fh_live_ab12cd34_…" https://api.flexcityhq.example/api/v1/people?limit=100
```

The organization is the key's own; there is no organization id or subdomain to pass. Every read runs inside the
organization's database context with row-level security, so a key can never see another organization's records.

## Requests and answers

- JSON, **snake_case**, ISO-8601 timestamps in UTC (`2026-11-11T17:00:00.000Z`), dates as `YYYY-MM-DD`, money and hours
  as strings with two decimals (`"1234.50"`).
- Every answer has an `X-Request-Id` header (send your own `X-Request-Id`, 8–128 letters, digits and `._:-`, and it's kept).
- Errors are problem details (RFC 9457), `Content-Type: application/problem+json`, with a stable `code`, field errors
  where they apply, and the request id to quote to support:

```json
{ "type": "about:blank", "title": "Unprocessable content", "status": 422, "code": "VALIDATION",
  "message": "Some fields aren’t valid.", "detail": "Some fields aren’t valid.",
  "errors": [{ "field": "email", "code": "invalid_format", "message": "Invalid email address" },
             { "field": "sin", "code": "not_writable", "message": "Never accepted through the API: …" }],
  "request_id": "1b2c…", "requestId": "1b2c…" }
```
- Lists are paged: `limit` (1–500, default 100) and `cursor` (the previous page's `next_cursor`; `null` on the last page).
  Records come **oldest change first**, by `(updated_at, id)`, so `updated_since=<timestamp>` plus the cursor is a reliable
  incremental sync: keep the largest `updated_at` you've seen and ask for changes since then next time.

| Code | When |
| --- | --- |
| 400 `BAD_CURSOR`, `BAD_RANGE`, `BAD_JSON`, `IDEMPOTENCY_KEY_REQUIRED`, `IDEMPOTENCY_KEY_INVALID` | The cursor isn't one we gave, a date range is missing, reversed or longer than 93 days, the body isn't JSON, or a POST has no usable `Idempotency-Key`. |
| 401 `API_KEY_MISSING`, `API_KEY_INVALID`, `API_KEY_EXPIRED`, `API_KEY_REVOKED` | No key, an unknown key, or one that no longer works. |
| 402 `ACCOUNT_SUSPENDED` | Writes only: the organization's account is read-only until an overdue balance is paid. |
| 403 `INSUFFICIENT_SCOPE`, `IP_NOT_ALLOWED`, `PLAN_REQUIRED`, `ORG_DISABLED`, `KEY_OWNER_INACTIVE`, `KEY_OWNER_LACKS_PERMISSION` | The key lacks the scope, is used from an address not on its list, the plan lacks the option, the account is closed, or (writes) the key's maker left or lost the permission. |
| 404 `NOT_FOUND`, `FEATURE_OFF` | No such record (or it belongs to someone else), or the feature behind the scope is switched off (time clock, time off, payroll). |
| 409 `EMAIL_TAKEN`, `EMPLOYEE_NUMBER_TAKEN`, `EXTERNAL_ID_TAKEN`, `DEPARTMENT_EXISTS`, `POSITION_EXISTS`, `TIME_OFF_OVERLAPS`, `ALREADY_OFFBOARDING`, `NOT_ACTIVE`, `ALREADY_STARTED`, `IDEMPOTENCY_KEY_REUSED`, `IDEMPOTENCY_IN_PROGRESS`, `ALREADY_EXISTS` | The change conflicts with what's there (the field is named in `errors`), or an Idempotency-Key was reused with another body or is still being handled. |
| 412 `PRECONDITION_FAILED` | `If-Match` doesn't match the record's current ETag (it's in `details.etag`): read it again. |
| 415 `UNSUPPORTED_MEDIA_TYPE` | A write body that isn't `application/json`. |
| 422 `VALIDATION` and business-rule codes (`UNKNOWN_POSITION`, `UNKNOWN_DEPARTMENT`, `MANAGER_SELF`, `MANAGER_CYCLE`, `MANAGER_INACTIVE`, `LIEU_SHORT`, `BAD_REQUEST`) | A query parameter or body field failed validation (each in `errors`), a field can't be written through the API (`not_writable`), or the change breaks one of the app's rules. |
| 429 `RATE_LIMITED` | Too many requests (or changes) for this key this minute. |

## Endpoints

| Endpoint | Scope | Returns |
| --- | --- | --- |
| `GET /api/v1/people` (`?status=active\|inactive\|terminated`) | `people:read` | People: `id`, `external_id`, `employee_number`, `first_name`, `last_name`, `preferred_name`, `email` (work sign-in), `status`, `employment_status`, `hire_date`, `manager_id` (the explicit reporting line), `department_ids`, `positions`, `processing_restricted`, `created_at`, `updated_at`. |
| `GET /api/v1/people/{id}` | `people:read` | One person, with its `ETag`. |
| `GET /api/v1/departments`, `GET /api/v1/departments/{id}` | `departments:read` | `id`, `external_id`, `name`, `name_fr`, `gl_code`, `manager_ids` (one: with its `ETag`). |
| `GET /api/v1/positions`, `GET /api/v1/positions/{id}` | `positions:read` | `id`, `external_id`, `name`, `name_fr`, `department_id` (one: with its `ETag`). |
| `GET /api/v1/facilities` | `facilities:read` | `id`, `name`, `province`, `timezone`, `cost_center`. |
| `GET /api/v1/shifts?from=&to=` (`facility_id`, `person_id`, `include_cancelled=true`) | `schedule:read` | **Published** shifts overlapping the range (at most 93 days): `facility_id`, `position_id`, `person_id` (null = open), `starts_at`, `ends_at`, `type`, `title`, `status`. Drafts are never shown. |
| `GET /api/v1/timesheets?from=&to=` (`person_id`, `facility_id`) | `timesheets:read` | **Approved**, completed punches clocked in during the range: `person_id`, `facility_id`, `position_id`, `shift_id`, `clock_in`, `clock_out`, `hours`, `approved_at`. |
| `GET /api/v1/time-off` (`from`, `to`, `person_id`) | `timeoff:read` | **Approved** time off: `person_id`, `type`, `status`, `starts_at`, `ends_at`, `hours` (charged at approval), `approved_at`. |
| `GET /api/v1/time-off/{id}` | `timeoff:read` or `timeoff:write` | One request in any status (`pending`, `approved`, `denied`, `cancelled`), so a system that sent it in can follow it. |
| `GET /api/v1/pay-runs` | `payroll:read` | **Approved or paid** pay runs: period, pay date, `kind`, `status`, and `totals` (`gross`, `deductions`, `net`, `employer_cpp`, `employer_ei`, `people`). |
| `GET /api/v1/pay-runs/{id}/statements` | `payroll:read` | Per person in an approved run: `person_id`, `hours`, `gross`, `net`. Nothing else. |

### What the API never returns

Social insurance numbers, bank or deposit details, pay rates, deductions by type and year-to-date figures, dates of birth,
phone numbers and personal contacts, documents, health, accommodation, injury or incident details, notes on time-off
requests (they can hold health information), discipline, reliability, punch locations and IP addresses. People whose
processing is restricted (an erasure request) or who were anonymized keep only their `id`, `status` and
`employment_status`, with `processing_restricted: true`. This follows the [PIA](PIA.md) and the data-minimization findings
in the [security and legal audit](SECURITY-LEGAL-AUDIT.md): an integration gets what payroll and HR systems routinely need,
and no more. Time-off `type` is kept (`sick`, `protected_leave`…) because payroll codes depend on it.

### Example: sync people every hour

```bash
KEY=fh_live_ab12cd34_…
SINCE=2026-11-10T00:00:00Z
CURSOR=
while :; do
  PAGE=$(curl -s -H "Authorization: Bearer $KEY" "https://api.flexcityhq.example/api/v1/people?updated_since=$SINCE&limit=500${CURSOR:+&cursor=$CURSOR}")
  echo "$PAGE" | jq -c '.data[]'          # upsert each person by id
  CURSOR=$(echo "$PAGE" | jq -r '.next_cursor // empty')
  [ -z "$CURSOR" ] && break
done
```

## Writing data

Cities' HRIS and ERP systems push their changes in: new hires, name and status changes, departments and positions, and
time off. Every write goes through the **same services and rules as the app's own screens** (`services/people/*`), so a
change refused in the app is refused here, with the same reason.

| Endpoint | Scope | What it does |
| --- | --- | --- |
| `POST /api/v1/people` | `people:write` | Adds a person (`first_name`, `last_name`, `email`, `employment_status` required; `preferred_name`, `phone`, `employee_number`, `hire_date`, `position_ids`, `manager_id`, `external_id`, `locale` optional). They start as an employee (access roles are given in the app) and are emailed an invitation to sign in, unless `"invite": false`: then the record has no sign-in until HR invites them from the app, as with a spreadsheet import. `201` with `Location` and `ETag`. |
| `PATCH /api/v1/people/{id}` | `people:write` | Changes only the fields sent: `first_name`, `last_name`, `preferred_name`, `email` (a new sign-in email ends their sessions and tells the old address), `phone`, `employee_number`, `employment_status`, `hire_date`, `position_ids` (replaces them; departments follow positions), `manager_id` (reporting lines stay free of cycles), `external_id`. Takes `If-Match`. |
| `POST /api/v1/people/{id}/terminate` | `people:write` | Ends someone's employment: `{ "last_day": "2026-12-31", "reason": "resignation" }` (`retirement`, `end_of_season`, `end_of_contract`, `dismissal`, `layoff`, `other`). It **starts offboarding** with the same checks as the app (not yourself, not twice: `409 ALREADY_OFFBOARDING`); HR finishes the checklist (final pay, ROE, benefits, access) in the app, which ends their access and sends `person.terminated`. Nothing is ever deleted. |
| `PUT /api/v1/people/by-external-id/{external_id}` | `people:write` | Upsert by your own id: creates the person (`201`, the create fields required) when no one has that `external_id`, otherwise changes the fields sent (`200`, `If-Match` honoured). |
| `POST /api/v1/time-off` | `timeoff:write` | Requests time off for a person: `person_id`, `type` (`vacation`, `sick`, `protected_leave`, `unpaid_personal`, `other`, `lieu`), `starts_at`, `ends_at`, optional `note` (kept, never returned). **Pending** by default: their manager approves it in the app, as if the person asked. `"status": "approved"` needs `timeoff:approve` and a key maker who can approve time off; the request is then approved at once on their behalf (leave hours charged, the person told, their shifts released, `timeoff.approved` sent). The app's rules apply: no overlap (`409 TIME_OFF_OVERLAPS`), at most 120 days, banked hours for `lieu`. |
| `POST /api/v1/time-off/{id}/cancel` | `timeoff:write` | Cancels a pending request, or an approved one that hasn't started (`409 ALREADY_STARTED` otherwise). |
| `POST /api/v1/departments`, `PATCH /api/v1/departments/{id}`, `PUT /api/v1/departments/by-external-id/{external_id}` | `departments:write` | `name` (unique), `name_fr`, `external_id`. Positions, managers and the GL code stay as set in the app. Departments aren't deleted or archived through the API. |
| `POST /api/v1/positions`, `PATCH /api/v1/positions/{id}`, `PUT /api/v1/positions/by-external-id/{external_id}` | `positions:write` | `name` (unique), `name_fr`, `department_id` (moves it), `external_id`. Required certifications and driving limits stay as set in the app. Positions aren't deleted or archived through the API. |

Not offered: deleting anything, access roles, pay rates, SIN, bank, birth date, health or accommodation details (any of
these fields answers `422` with `not_writable`), and shifts (the schedule is built in the app; a draft-shift write may
come later).

**Organization-wide.** A key is the organization's: there's no department limit on what it can change (the same as its
reads). That's why only someone with the permission across the whole organization can give a write scope.

**Audit and webhooks.** Each change is in the audit log exactly as the same change made in the app (`user.create`,
`user.update`, `user.manager`, `offboarding.start`, `timeoff.request`, `timeoff.approve`, `timeoff.cancel`,
`department.create`, `position.update`…), with `apiKeyId` set and “API key <name>” as the actor. Records that need a
person (who decided a time-off request, who started an offboarding) name the key's maker. Webhooks fire from the
database for these changes as for any other (`person.created`, `person.updated` with `preferred_name` among the field
names, `timeoff.approved`, `timeoff.cancelled`), so a system that writes also hears its own changes: use the ids to
skip them.

### Idempotency-Key (every POST)

Send a unique `Idempotency-Key` header (1–255 visible characters; a UUID is ideal) with every POST, and the **same** key
when you retry that change after a timeout or a dropped connection.

- Same key, same request (method, path and JSON body, key order ignored) within **24 hours**: you get the first answer
  again (its status, body, `ETag` and `Location`), with `Idempotent-Replayed: true`, and nothing is changed twice.
  Refusals are answers too: a `422` is replayed as a `422`.
- Same key, different request: `409 IDEMPOTENCY_KEY_REUSED`. Still being handled: `409 IDEMPOTENCY_IN_PROGRESS`; retry
  in a moment. If our side failed (`5xx`), the key is released and the retry runs.
- Keys belong to one API key; they're kept 24 hours (`ApiIdempotencyKey`, row-level security), then removed.
- `PUT …/by-external-id/…` is idempotent by itself; an `Idempotency-Key` is optional there.

### ETags and If-Match (optimistic concurrency)

`GET` of one record, and every write, answer with an `ETag` (the record's version, from when it last changed). Send it
back as `If-Match` on `PATCH`, `PUT` or `…/terminate`: if someone changed the record since you read it, the answer is
`412 PRECONDITION_FAILED` with the current ETag in `details.etag`, and nothing is changed. Without `If-Match` the change
is made (last write wins); `If-Match: *` matches any version.

### External ids

`external_id` on people, departments and positions is your own system's id (letters, digits and `. _ : @ -`, up to 100),
unique in your organization (`409 EXTERNAL_ID_TAKEN`) and never shared with another organization. `PUT
…/by-external-id/{external_id}` creates the record or changes it, so a nightly sync can send everything without looking
ids up first.

### Examples

```bash
KEY=fh_live_ab12cd34_…   # a key with write scopes
API=https://api.flexcityhq.example/api/v1

# Add a person (invited to sign in)
curl -X POST "$API/people" -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -H "Idempotency-Key: 7d3f2a8e-1c4b-4f7e-9a51-0b2c6d9e8f10" \
  -d '{"first_name":"Ada","last_name":"King","preferred_name":"Addie","email":"ada.king@city.example",
       "employment_status":"part_time","hire_date":"2026-05-01","employee_number":"P-100",
       "external_id":"hris-100","position_ids":["4f0c…"]}'
# → 201, Location: /api/v1/people/b3a9…, ETag: "mhv1k2x0"

# Change a person, only if nobody changed them since you read them
curl -X PATCH "$API/people/b3a9…" -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -H 'If-Match: "mhv1k2x0"' -d '{"last_name":"Lovelace","employment_status":"full_time"}'
# → 200 with the new ETag, or 412 PRECONDITION_FAILED

# Upsert by your own id (create or change)
curl -X PUT "$API/people/by-external-id/hris-100" -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"first_name":"Ada","last_name":"Lovelace","email":"ada.king@city.example","employment_status":"full_time"}'

# End employment (starts offboarding; HR completes it)
curl -X POST "$API/people/b3a9…/terminate" -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -H "Idempotency-Key: 0e5a…" -d '{"last_day":"2026-12-31","reason":"resignation"}'

# Request time off (pending), or send it in approved (needs timeoff:approve)
curl -X POST "$API/time-off" -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -H "Idempotency-Key: 9b1c…" \
  -d '{"person_id":"b3a9…","type":"vacation","starts_at":"2026-12-21T16:00:00Z","ends_at":"2026-12-24T01:00:00Z"}'
curl -X POST "$API/time-off/5c2e…/cancel" -H "Authorization: Bearer $KEY" -H "Idempotency-Key: 2f7d…"

# Departments and positions
curl -X POST "$API/departments" -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -H "Idempotency-Key: 41aa…" -d '{"name":"Water Works","name_fr":"Travaux d’eau","external_id":"D-10"}'
curl -X PATCH "$API/departments/8d1e…" -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -H 'If-Match: "mhv1m0q4"' -d '{"name":"Water Utility"}'
curl -X PUT "$API/departments/by-external-id/D-11" -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"name":"Parks"}'
curl -X POST "$API/positions" -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -H "Idempotency-Key: 77c0…" -d '{"name":"Operator","department_id":"8d1e…","external_id":"P-1"}'
curl -X PATCH "$API/positions/3a6f…" -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"department_id":null}'
curl -X PUT "$API/positions/by-external-id/P-1" -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"name":"Operator I"}'

# A retry of the first request with the same Idempotency-Key → the same 201, Idempotent-Replayed: true
```

## Webhooks

An endpoint is an `https` address on your systems, a list of event types, and a signing secret (`whsec_…`, shown once).

### Event types

| Type | When | `data` |
| --- | --- | --- |
| `person.created` | A person is added (any way: the app, an import, a hire from an application) | `{ id }` |
| `person.updated` | A public field changes: name, preferred name, email, status, employment status, hire date, employee number, manager, positions | `{ id, changed: ["first_name", "positions", …] }` |
| `person.terminated` | Status becomes terminated (also sends `person.updated`) | `{ id }` |
| `shift.published` | A shift is published (or created already published, e.g. a call-out) | `{ id }` |
| `shift.updated` | A published shift's person, times, position or facility change | `{ id, changed: […] }` |
| `shift.cancelled` | A published shift is cancelled | `{ id }` |
| `timeoff.approved` / `timeoff.cancelled` | Time off is approved, or approved time off is cancelled | `{ id, person_id }` |
| `punch.approved` | A punch is approved | `{ id, person_id }` |
| `payrun.approved` | A pay run is approved | `{ id }` |
| `ping` | "Send test event" | `{ message }` |

Payloads are deliberately minimal (ids and the *names* of fields that changed, never their values): fetch the record from
the API with a key. A body looks like:

```json
{ "id": "6f1c…", "type": "person.updated", "created_at": "2026-11-11T17:02:11.000Z",
  "organization_id": "0f6e…", "data": { "id": "b3a9…", "changed": ["last_name"] } }
```

Headers: `Content-Type: application/json`, `User-Agent: FlexcityHeadquarters-Webhooks/1`, `FH-Event-Id` (the same for
every endpoint and every redelivery: use it to drop repeats), `FH-Event-Type`, `FH-Delivery-Id`, and `FH-Signature`.

### Verifying the signature

`FH-Signature: t=1762880531,v1=5257a869…`, where `v1` is the hex HMAC-SHA256 of `"<t>.<raw body>"` keyed with your signing
secret. Check the signature against the **raw** body, and that `t` is within 5 minutes of your clock, to refuse forged and
replayed messages. For 24 hours after you make a new secret, a second `v1=` signed with the old secret is included.

```js
import { createHmac, timingSafeEqual } from 'node:crypto';

export function verify(header, rawBody, secret, toleranceS = 300) {
  const parts = Object.groupBy(header.split(','), (p) => p.split('=')[0]);
  const t = Number(parts.t?.[0]?.split('=')[1]);
  if (!Number.isFinite(t) || Math.abs(Date.now() / 1000 - t) > toleranceS) return false;
  const want = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest();
  return (parts.v1 ?? []).some((p) => {
    const got = Buffer.from(p.slice(3), 'hex');
    return got.length === want.length && timingSafeEqual(got, want);
  });
}
```

### Delivery

- Answer with any `2xx` within **10 seconds**. Anything else (including a `3xx`: redirects are never followed) is a failure.
- Delivery is **at least once** and not strictly ordered; use `FH-Event-Id` to drop duplicates, and the API's `updated_at`
  for the current state.
- Retries after 1 min, 5 min, 30 min, 2 h, 6 h, 12 h and 24 h (8 tries over about two days), then the delivery is marked
  failed.
- After **20 failed tries in a row** the endpoint is turned off and the organization's HR administrators get an in-app
  notice and an email. Turn it back on in Settings › Integrations; failed deliveries can be sent again with **Send again**
  (same event id). **Send test event** sends a `ping` straight away.
- Delivery records (type, status, tries, response code and the first 500 characters of your answer; never a secret) are
  kept 30 days.

### Where a webhook may point

The address must be `https` and resolve only to public internet addresses: loopback, private ranges (10/8, 172.16/12,
192.168/16), link-local and cloud metadata (169.254.169.254), carrier-grade NAT, multicast, IPv6 unique-local and
link-local, and IPv4-mapped forms of all of these are refused, as are addresses with a user name or password. The check
runs when the endpoint is saved **and again before every send**, and the connection goes to the address that was checked
(TLS still verifies the certificate for the name you typed), so a DNS change can't redirect it inside FH's network.

## How it works (for FH engineers)

- Keys: `services/integrations/apiKeys.ts`; the `/api/v1` router: `routes/publicApi.ts` (reads, mounted before the
  subdomain resolver), `routes/publicApiWrite.ts` (writes), `routes/publicApiShared.ts` (scopes, problem details, ETags,
  shapes); settings routes: `routes/integrations.ts`; the OpenAPI document: `services/integrations/openapi.ts`.
- Writes: the key acts as an `AuthContext` built from its maker's current roles, custom roles and the city's role
  overrides (scope: the whole organization), and calls the services HR's screens use (`services/people/staffAdmin.ts`,
  `positionAdmin.ts`, `departmentAdmin.ts`, `timeOff.ts`). `actAsApiKey(tx)` (`lib/db.ts`) makes every `audit()` in that
  transaction record the key (`AuditLog.apiKeyId`) instead of a person. Ids from the body (positions, managers,
  departments, people) are looked up under RLS first, so another organization's id is "not found", never linked.
  Idempotency: `services/integrations/idempotency.ts` (claimed with `ON CONFLICT DO NOTHING`, answered, kept 24 hours).
  The organization is found from the key's hash through the `api_key_tenant()` SECURITY DEFINER function, then the key is
  read again under RLS.
- Events: Postgres triggers in `db/rls.sql` (`fh_public_event`) write to the event outbox in the transaction of the change,
  only when an enabled endpoint wants that type, so every code path is covered. The outbox dispatcher
  (`lib/outbox.ts`) calls `queueWebhookDeliveries()`, which adds one `WebhookDelivery` per endpoint with a dedupe key.
- Sending: `services/integrations/webhooks.ts`. The worker claims due deliveries with `FOR UPDATE SKIP LOCKED` and a
  2-minute lease, sends outside any transaction, and records the outcome. Secrets are sealed with the organization's key
  (envelope encryption), since they must be read back to sign.
- Metrics: `fh_public_api_requests_total{route,status}` (route pattern only) and
  `fh_webhook_deliveries_total{type,outcome}`.
- Settings: `WEBHOOK_MAX_ATTEMPTS` (8), `WEBHOOK_DISABLE_AFTER` (20), `WEBHOOK_TIMEOUT_MS` (10000). `ApiKey.rateLimitPerMinute`
  can be raised per key by FH on request.
- Dev console: a city's **API and webhooks** tab shows whether the option is in its plan, active keys, request counts and
  delivery counts. Never keys, secrets or payloads.
- Tests: `test/integration/publicApi.test.ts`, `test/integration/publicApiWrite.test.ts`, `test/unit/integrations.test.ts`, `test/unit/egress.test.ts`.
