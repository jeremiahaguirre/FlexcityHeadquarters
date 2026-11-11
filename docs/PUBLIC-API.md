# Public API and webhooks

A city's own systems (an ERP such as SAP, Tempest or Amanda, an HRIS, a GIS) can **read** its FlexcityHeadquarters
data through a versioned API, and be **told** when something changes through signed webhooks. Both are set up in the app
under **Settings › Integrations** by an administrator (the `tenant.configure` permission, normally HR).

- Machine-readable description: `GET /api/v1/openapi.json` (OpenAPI 3.1, no key needed).
- Plan: the **API and webhooks** option (`publicApi`, integration group), standard in Multi-complex and Enterprise and
  available as an add-on elsewhere ([pricing](PRICING.md)). Without it, administrators can see what is set up but can't add
  keys or webhooks (`403 PLAN_REQUIRED`), existing keys answer `403 PLAN_REQUIRED`, and no new events are queued.
- Version 1 is **read-only**. Nothing in the API can change your data.

## API keys

| | |
| --- | --- |
| Format | `fh_live_<8 characters>_<43 characters>`. The first part (the *prefix*, e.g. `fh_live_ab12cd34`) is shown on screens to tell keys apart; the rest is the secret. |
| Storage | Only a SHA-256 of the whole key is kept. The key is shown **once**, when it's made or rotated. |
| Scopes | `people:read`, `departments:read`, `positions:read`, `facilities:read`, `schedule:read`, `timesheets:read`, `timeoff:read`, `payroll:read`. A key can only be given scopes whose data the person making it can see (e.g. `payroll:read` needs `payroll.export`). |
| IP allow list | Optional IPv4/IPv6 addresses or CIDR ranges (`203.0.113.0/24`). Empty = any address. |
| Expiry | Optional date; after it the key answers `401 API_KEY_EXPIRED`. |
| Rotate | Makes a new key with the same settings. The old key keeps working for **24 hours**, so your systems can switch over. |
| Revoke | Immediate: `401 API_KEY_REVOKED`. |
| Rate limit | 120 requests a minute per key by default, counted in the database (shared by every API server). Over the limit: `429 RATE_LIMITED` with `Retry-After: 60`. Every answer carries `X-RateLimit-Limit`. |
| Audit | Making, rotating and revoking keys, and **every API request** (method, path, request id), are in the organization's audit log. Settings › Integrations shows each key's last use and request count. |

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
- Every answer has an `X-Request-Id` header. Errors look like
  `{ "code": "INSUFFICIENT_SCOPE", "message": "…", "requestId": "…" }`; quote the request id to support.
- Lists are paged: `limit` (1–500, default 100) and `cursor` (the previous page's `next_cursor`; `null` on the last page).
  Records come **oldest change first**, by `(updated_at, id)`, so `updated_since=<timestamp>` plus the cursor is a reliable
  incremental sync: keep the largest `updated_at` you've seen and ask for changes since then next time.

| Code | When |
| --- | --- |
| 400 `VALIDATION`, `BAD_CURSOR`, `BAD_RANGE` | A parameter is wrong, the cursor isn't one we gave, or a date range is missing, reversed or longer than 93 days. |
| 401 `API_KEY_MISSING`, `API_KEY_INVALID`, `API_KEY_EXPIRED`, `API_KEY_REVOKED` | No key, an unknown key, or one that no longer works. |
| 403 `INSUFFICIENT_SCOPE`, `IP_NOT_ALLOWED`, `PLAN_REQUIRED`, `ORG_DISABLED` | The key lacks the scope, is used from an address not on its list, the plan lacks the option, or the account is closed. |
| 404 `NOT_FOUND`, `FEATURE_OFF` | No such record (or it belongs to someone else), or the feature behind the scope is switched off (time clock, time off, payroll). |
| 429 `RATE_LIMITED` | Too many requests for this key this minute. |

## Endpoints

| Endpoint | Scope | Returns |
| --- | --- | --- |
| `GET /api/v1/people` (`?status=active\|inactive\|terminated`) | `people:read` | People: `id`, `employee_number`, `first_name`, `last_name`, `email` (work sign-in), `status`, `employment_status`, `hire_date`, `manager_id` (the explicit reporting line), `department_ids`, `positions`, `processing_restricted`, `created_at`, `updated_at`. |
| `GET /api/v1/people/{id}` | `people:read` | One person. |
| `GET /api/v1/departments` | `departments:read` | `id`, `name`, `name_fr`, `gl_code`, `manager_ids`. |
| `GET /api/v1/positions` | `positions:read` | `id`, `name`, `name_fr`, `department_id`. |
| `GET /api/v1/facilities` | `facilities:read` | `id`, `name`, `province`, `timezone`, `cost_center`. |
| `GET /api/v1/shifts?from=&to=` (`facility_id`, `person_id`, `include_cancelled=true`) | `schedule:read` | **Published** shifts overlapping the range (at most 93 days): `facility_id`, `position_id`, `person_id` (null = open), `starts_at`, `ends_at`, `type`, `title`, `status`. Drafts are never shown. |
| `GET /api/v1/timesheets?from=&to=` (`person_id`, `facility_id`) | `timesheets:read` | **Approved**, completed punches clocked in during the range: `person_id`, `facility_id`, `position_id`, `shift_id`, `clock_in`, `clock_out`, `hours`, `approved_at`. |
| `GET /api/v1/time-off` (`from`, `to`, `person_id`) | `timeoff:read` | **Approved** time off: `person_id`, `type`, `starts_at`, `ends_at`, `hours` (charged at approval), `approved_at`. |
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

## Webhooks

An endpoint is an `https` address on your systems, a list of event types, and a signing secret (`whsec_…`, shown once).

### Event types

| Type | When | `data` |
| --- | --- | --- |
| `person.created` | A person is added (any way: the app, an import, a hire from an application) | `{ id }` |
| `person.updated` | A public field changes: name, email, status, employment status, hire date, employee number, manager, positions | `{ id, changed: ["first_name", "positions", …] }` |
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

- Keys: `services/integrations/apiKeys.ts`; the `/api/v1` router: `routes/publicApi.ts` (mounted before the
  subdomain resolver); settings routes: `routes/integrations.ts`; the OpenAPI document: `services/integrations/openapi.ts`.
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
- Tests: `test/integration/publicApi.test.ts`, `test/unit/integrations.test.ts`, `test/unit/egress.test.ts`.
