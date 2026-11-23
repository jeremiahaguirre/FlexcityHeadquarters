/**
 * Department limits hold on every route. Signed in with a role that holds every capability in the
 * catalogue but is limited to one department (Aquatics), every route the API has is called: each
 * path parameter is filled with ids from another department (Water Works: the department, its
 * position, a person and their shift, punch, time off, conduct note, attendance event, discipline
 * record and accommodation), plain and percent-encoded, and every route without parameters is
 * called as is. A write that answers 400 VALIDATION is sent again with what zod asked for (the
 * API returns zod's issues), so it reaches the handler's own checks rather than stopping at the body.
 *
 * It fails on
 * - any 2xx answer holding anything of the other department (ids, name, email, record text);
 * - any 2xx write aimed at the other department's records, or at an organization-wide setting;
 * - any change to those records, the organization's settings, departments, positions or managers;
 * - any request with no answer within 15 seconds;
 * - any route the sweep never got past validation or a missing id on, for the limited role or for
 *   HR replaying the same request, unless it's in UNREACHED with the reason.
 * Exceptions are checked in below, each with its reason.
 */
import { randomBytes } from 'node:crypto';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { signAccessToken } from '../../src/auth/tokens.js';
import { forgetCustomPermissions } from '../../src/services/people/customRoles.js';
import { FEATURE_KEYS, forgetFeatures } from '../../src/services/platform/features.js';
import { app as appDb, owner, seedTenant } from './fixtures.js';

process.env.LOCAL_KEK_BASE64 ||= randomBytes(32).toString('base64');
const server = createApp();
const SUB = 'scopesweep';
let t: Awaited<ReturnType<typeof seedTenant>>;
const tok = { limited: '', hr: '' };
const ids = { hr: '', limited: '', mine: '', theirs: '' };
const kinds: Record<string, string[]> = {};
const markers: string[] = [];

/** Routes not swept at all, each with the reason. */
const EXCLUDED: Array<{ test: (method: string, path: string) => boolean; why: string }> = [
  { test: (_m, p) => /^\/api\/platform(\/|$)/.test(p), why: 'the FH Dev console: its own sessions (requirePlatform), not a city sign-in' },
  { test: (_m, p) => /^\/api\/v1(\/|$)/.test(p), why: 'the public API: API keys, which are whole-organization only to make (integrations.ts) and to use (publicApiWrite keyActor)' },
  { test: (_m, p) => /^\/api\/(marketing|public)(\/|$)/.test(p), why: 'anonymous marketing and public pages: no sign-in, no department' },
  { test: (m, p) => m === 'GET' && p === '/api/notifications/stream', why: 'the live stream stays open by design; it carries only the caller’s own ids and topics' },
];

/** Answers a department-limited admin may get as a 2xx write, each with the reason. Keep it short. */
const ALLOWED: Array<{ route: string; why: string }> = [
  { route: 'POST /api/kiosk/unpair', why: 'clears the calling browser’s own kiosk cookie; touches no data' },
  { route: 'POST /api/auth/support/end', why: 'clears the calling browser’s own support-visit cookie' },
  { route: 'POST /api/auth/logout', why: 'signs the caller out' },
  { route: 'POST /api/auth/passkey/options', why: 'a sign-in challenge for the caller; stores only the challenge' },
  { route: 'POST /api/auth/step-up/options', why: 'a step-up challenge for the caller' },
  { route: 'POST /api/auth/refresh', why: 'the caller’s own session' },
  { route: 'POST /api/auth/forgot', why: 'anonymous: asks for a reset link to the address given; answers the same whether or not it exists' },
  { route: 'POST /api/client-errors', why: 'the browser’s own error report; stores nothing about anyone' },
  { route: 'POST /api/notifications/read', why: 'marks the caller’s own notifications read' },
  { route: 'POST /api/reports/saved', why: 'the caller’s own saved report; running it still follows their limits' },
  { route: 'POST /api/logbook', why: 'the caller’s own logbook entry at a facility' },
  { route: 'POST /api/incidents', why: 'anyone on duty reports an incident; reading reports follows department limits' },
  // Facilities are shared by every department (an empty facility list on a role means every facility,
  // customRoles.ts), so a department's leads set up the facilities they work at.
  { route: 'POST /api/coverage/rules', why: 'a facility’s staffing rule; facilities are shared across departments by design' },
  { route: 'POST /api/deck/stations', why: 'a pool’s guard stations; facilities are shared across departments by design' },
  { route: 'POST /api/deck/rotate', why: 'rotates the guards on duty at a facility; acts on that facility’s deck only' },
  { route: 'POST /api/deck/close', why: 'closes a deck rotation at a facility' },
  { route: 'POST /api/ops/pools', why: 'a facility’s pool; facilities are shared across departments by design' },
  { route: 'POST /api/ops/page-head-guard', why: 'pages the head guard on duty; changes nothing' },
  { route: 'POST /api/kiosks', why: 'pairs a facility kiosk; facilities are shared across departments by design (audit: rejected candidate)' },
  { route: 'POST /api/bookable-services', why: 'a facility’s bookable service, member services' },
  // Member services (members.manage, lessons.plan, fees.manage, bookings.manage) is not a supervisory
  // capability and isn't department-limited by design: front desk serves every family.
  { route: 'POST /api/households', why: 'member services: a new family record' },
  { route: 'POST /api/fees', why: 'member services: the price list (fees.manage), shared by design' },
  { route: 'POST /api/campaigns', why: 'member services: a program campaign; set changes follow department limits (SEC-29)' },
  { route: 'POST /api/swim-levels', why: 'member services: the program levels catalogue' },
  { route: 'POST /api/swim-levels/presets', why: 'member services: adds a standard set of levels' },
  // Adds a record of the caller's own area; changing someone else's is an aimed write, checked above.
  { route: 'POST /api/vehicles', why: 'adds a vehicle to the fleet; nothing of another department changes' },
  { route: 'POST /api/winter/routes', why: 'adds a winter route; nothing of another department changes' },
  { route: 'POST /api/announcements', why: 'refused unless addressed to the caller’s own positions or facilities (communication.ts)' },
  { route: 'POST /api/shifts/publish', why: 'publishes only the caller’s own department’s draft shifts (shiftsWhere)' },
  { route: 'POST /api/shifts/publish/check', why: 'a dry run of publishing the caller’s own shifts' },
  { route: 'POST /api/schedule/rotations/generate', why: 'generates shifts from the caller’s own rotations' },
];
const allowed = (method: string, path: string) => ALLOWED.some((x) => x.route === `${method} ${path}`);
/** The caller's own pages: a write there changes only the caller. Their answers are still checked for others' data. */
const ownPage = (path: string) => /^\/api\/me(\/|$)/.test(path);

/** Bodies the fuzzer can't build on its own, for writes whose department checks matter. */
const BODIES: Record<string, () => Record<string, unknown>> = {
  'POST /api/punches/decision': () => ({ ids: kinds.punch, decision: 'APPROVE' }),
  'POST /api/roles': () => ({ name: 'Swept role', permissions: ['schedule.read', 'users.read'] }),
  'POST /api/notifications/read': () => ({ ids: [] }),
  'PUT /api/users/:id/roles': () => ({ customRoleIds: [] }),
  'PUT /api/roles/:id': () => ({ name: 'Water Works lead', permissions: ['schedule.read', 'users.read', 'users.write'] }),
  // Query parameters read one by one (zod reports no field name for them).
  'GET /api/payroll/t4': () => ({ year: 2025 }),
  'GET /api/payroll/t4.xml': () => ({ year: 2025 }),
  'GET /api/payroll/t4a.xml': () => ({ year: 2025 }),
  'GET /api/payroll/rl1': () => ({ year: 2025 }),
  'GET /api/payroll/rl1.xml': () => ({ year: 2025 }),
  'GET /api/payroll/quebec/training': () => ({ year: 2025 }),
  'GET /api/payroll/remittance': () => ({ month: '2025-01' }),
  'GET /api/overtime/standings': () => ({ positionId: kinds.position![0] }),
  'PUT /api/users/:id/manager': () => ({ managerId: null }),
  'POST /api/users/:id/pay-rates': () => ({ positionId: kinds.position![0], hourlyRate: '25.00', effectiveFrom: '2026-01-05' }),
  'POST /api/users/:id/bank-accounts': () => ({ holderName: 'Sweep Holder', institution: '001', transit: '12345', account: '1234567', agree: true }),
  'POST /api/users/:id/documents': () => ({ kind: 'OTHER', title: 'Sweep document', fileName: 'sweep.pdf', data: `data:application/pdf;base64,${Buffer.from('%PDF-1.4\n%%EOF\n').toString('base64')}` }),
};

/**
 * Routes the sweep can't reach yet (no body or id it can build, for the limited role or for HR
 * replaying it), each with the reason. A new route doesn't belong here: give the fuzzer what it
 * needs (BODIES, a seeded id) instead. A listed route the sweep reaches fails until it's removed.
 */
const UNREACHED: Array<{ route: string; why: string }> = [
  { route: 'DELETE /api/coverage/rules/:id', why: 'needs a coverage rule or kiosk the sweep doesn’t seed (coverage.test.ts, kiosk.test.ts)' },
  { route: 'DELETE /api/kiosks/:id', why: 'needs a coverage rule or kiosk the sweep doesn’t seed (coverage.test.ts, kiosk.test.ts)' },
  { route: 'DELETE /api/messages/:id', why: 'needs a conversation or message the sweep doesn’t seed (the rule of two is tested in messagingSecurity.test.ts)' },
  { route: 'DELETE /api/messages/conversations/:id/members/:userId', why: 'needs a conversation or message the sweep doesn’t seed (the rule of two is tested in messagingSecurity.test.ts)' },
  { route: 'DELETE /api/reports/saved/:id', why: 'needs a saved report the sweep doesn’t seed; the caller’s own (reports.test.ts)' },
  { route: 'GET /api/applications/:id/resume', why: 'needs a job posting or application the sweep doesn’t seed (applications.test.ts, jobs.test.ts)' },
  { route: 'GET /api/bids/rounds/:id', why: 'needs a bid round the sweep doesn’t seed (bidding.test.ts)' },
  { route: 'GET /api/calendar/:tenantId/:file', why: 'a signed link, webhook or calendar token, not a sign-in' },
  { route: 'GET /api/campaigns/:id', why: 'needs a member-services record the sweep doesn’t seed (programs.test.ts, signup.test.ts, lessons.test.ts)' },
  { route: 'GET /api/documents/:id/file', why: 'needs an uploaded document the sweep doesn’t seed (documents.test.ts)' },
  { route: 'GET /api/email/unsubscribe', why: 'a signed link, webhook or calendar token, not a sign-in' },
  { route: 'GET /api/incidents/:id', why: 'needs an incident report the sweep doesn’t seed (features.test.ts)' },
  { route: 'GET /api/messages/:id/file', why: 'needs a conversation or message the sweep doesn’t seed (the rule of two is tested in messagingSecurity.test.ts)' },
  { route: 'GET /api/messages/conversations/:id', why: 'needs a conversation or message the sweep doesn’t seed (the rule of two is tested in messagingSecurity.test.ts)' },
  { route: 'GET /api/payroll/runs/:id', why: 'needs a pay run, statement or payroll order the sweep doesn’t seed (payroll.test.ts, fullPayroll.test.ts)' },
  { route: 'GET /api/payroll/runs/:id/deposit-file', why: 'needs a pay run, statement or payroll order the sweep doesn’t seed (payroll.test.ts, fullPayroll.test.ts)' },
  { route: 'GET /api/payroll/runs/:id/register.csv', why: 'needs a pay run, statement or payroll order the sweep doesn’t seed (payroll.test.ts, fullPayroll.test.ts)' },
  { route: 'GET /api/payroll/statements/:id', why: 'needs a pay run, statement or payroll order the sweep doesn’t seed (payroll.test.ts, fullPayroll.test.ts)' },
  { route: 'GET /api/union/locals', why: 'the Union Hub isn’t configured in tests (no UNION_DATABASE_URL); membership, not employer roles, decides access' },
  { route: 'GET /api/union/locals/:local/directory', why: 'the Union Hub isn’t configured in tests (no UNION_DATABASE_URL); membership, not employer roles, decides access' },
  { route: 'GET /api/union/locals/:local/seniority', why: 'the Union Hub isn’t configured in tests (no UNION_DATABASE_URL); membership, not employer roles, decides access' },
  { route: 'GET /api/union/locals/:local/threads', why: 'the Union Hub isn’t configured in tests (no UNION_DATABASE_URL); membership, not employer roles, decides access' },
  { route: 'GET /api/union/locals/:local/threads/:thread', why: 'the Union Hub isn’t configured in tests (no UNION_DATABASE_URL); membership, not employer roles, decides access' },
  { route: 'GET /api/users/:id/sin', why: 'needs a pay profile with a sealed SIN, which the sweep doesn’t seed (payroll.test.ts)' },
  { route: 'PATCH /api/applications/:id', why: 'needs a job posting or application the sweep doesn’t seed (applications.test.ts, jobs.test.ts)' },
  { route: 'PATCH /api/bookable-services/:id', why: 'needs a member-services record the sweep doesn’t seed (programs.test.ts, signup.test.ts, lessons.test.ts)' },
  { route: 'PATCH /api/coverage/rules/:id', why: 'needs a coverage rule or kiosk the sweep doesn’t seed (coverage.test.ts, kiosk.test.ts)' },
  { route: 'PATCH /api/fees/:id', why: 'needs a member-services record the sweep doesn’t seed (programs.test.ts, signup.test.ts, lessons.test.ts)' },
  { route: 'PATCH /api/grievances/:id', why: 'needs an HR record the sweep doesn’t seed (hr.test.ts, injury.test.ts)' },
  { route: 'PATCH /api/injury-claims/:id', why: 'needs an HR record the sweep doesn’t seed (hr.test.ts, injury.test.ts)' },
  { route: 'PATCH /api/jobs/:id', why: 'needs a job posting or application the sweep doesn’t seed (applications.test.ts, jobs.test.ts)' },
  { route: 'PATCH /api/messages/:id', why: 'needs a conversation or message the sweep doesn’t seed (the rule of two is tested in messagingSecurity.test.ts)' },
  { route: 'PATCH /api/offboarding/:id/items/:key', why: 'needs an HR record the sweep doesn’t seed (hr.test.ts, injury.test.ts)' },
  { route: 'PATCH /api/reports/saved/:id', why: 'needs a saved report the sweep doesn’t seed; the caller’s own (reports.test.ts)' },
  { route: 'PATCH /api/vehicles/:id', why: 'needs a vehicle or winter route the sweep doesn’t seed (fleet.test.ts, winter.test.ts)' },
  { route: 'PATCH /api/winter/routes/:id', why: 'needs a vehicle or winter route the sweep doesn’t seed (fleet.test.ts, winter.test.ts)' },
  { route: 'POST /api/announcements/:id/end', why: 'needs an announcement the sweep doesn’t seed (communication.test.ts)' },
  { route: 'POST /api/applications/:id/hire', why: 'needs a job posting or application the sweep doesn’t seed (applications.test.ts, jobs.test.ts)' },
  { route: 'POST /api/auth/passkey', why: 'a sign-in step: needs a live challenge, code or emailed token' },
  { route: 'POST /api/auth/passkeys', why: 'a sign-in step: needs a live challenge, code or emailed token' },
  { route: 'POST /api/auth/reset', why: 'a sign-in step: needs a live challenge, code or emailed token' },
  { route: 'POST /api/auth/sso/exchange', why: 'a sign-in step: needs a live challenge, code or emailed token' },
  { route: 'POST /api/auth/step-up', why: 'a sign-in step: needs a live challenge, code or emailed token' },
  { route: 'POST /api/auth/step-up/options', why: 'a sign-in step: needs a live challenge, code or emailed token' },
  { route: 'POST /api/bank-accounts/:id/verify', why: 'needs a pending bank account the sweep doesn’t seed (payroll.test.ts)' },
  { route: 'POST /api/bids/rounds', why: 'needs a bid round the sweep doesn’t seed (bidding.test.ts)' },
  { route: 'POST /api/bids/rounds/:id/cancel', why: 'needs a bid round the sweep doesn’t seed (bidding.test.ts)' },
  { route: 'POST /api/bids/rounds/:id/confirm', why: 'needs a bid round the sweep doesn’t seed (bidding.test.ts)' },
  { route: 'POST /api/billing/stripe/webhook', why: 'a signed link, webhook or calendar token, not a sign-in' },
  { route: 'POST /api/bookings/:id/decide', why: 'needs a member-services record the sweep doesn’t seed (programs.test.ts, signup.test.ts, lessons.test.ts)' },
  { route: 'POST /api/call-outs/:id/cancel', why: 'needs a call-out the sweep doesn’t seed (winter.test.ts)' },
  { route: 'POST /api/call-outs/:id/contacts/:contactId', why: 'needs a call-out the sweep doesn’t seed (winter.test.ts)' },
  { route: 'POST /api/care/checkins/:id/done', why: 'needs a care check-in the sweep doesn’t seed (care.test.ts)' },
  { route: 'POST /api/email/unsubscribe', why: 'a signed link, webhook or calendar token, not a sign-in' },
  { route: 'POST /api/injury-claims/:id/filed', why: 'needs an HR record the sweep doesn’t seed (hr.test.ts, injury.test.ts)' },
  { route: 'POST /api/jobs', why: 'needs a job posting or application the sweep doesn’t seed (applications.test.ts, jobs.test.ts)' },
  { route: 'POST /api/lessons/attendance', why: 'needs a member-services record the sweep doesn’t seed (programs.test.ts, signup.test.ts, lessons.test.ts)' },
  { route: 'POST /api/messages/:id/report', why: 'needs a conversation or message the sweep doesn’t seed (the rule of two is tested in messagingSecurity.test.ts)' },
  { route: 'POST /api/messages/conversations/:id/members', why: 'needs a conversation or message the sweep doesn’t seed (the rule of two is tested in messagingSecurity.test.ts)' },
  { route: 'POST /api/messages/conversations/:id/messages', why: 'needs a conversation or message the sweep doesn’t seed (the rule of two is tested in messagingSecurity.test.ts)' },
  { route: 'POST /api/messages/conversations/:id/mute', why: 'needs a conversation or message the sweep doesn’t seed (the rule of two is tested in messagingSecurity.test.ts)' },
  { route: 'POST /api/messages/conversations/:id/read', why: 'needs a conversation or message the sweep doesn’t seed (the rule of two is tested in messagingSecurity.test.ts)' },
  { route: 'POST /api/offboarding/:id/complete', why: 'needs an HR record the sweep doesn’t seed (hr.test.ts, injury.test.ts)' },
  { route: 'POST /api/payroll/runs', why: 'needs a pay run, statement or payroll order the sweep doesn’t seed (payroll.test.ts, fullPayroll.test.ts)' },
  { route: 'POST /api/payroll/runs/:id/approve', why: 'needs a pay run, statement or payroll order the sweep doesn’t seed (payroll.test.ts, fullPayroll.test.ts)' },
  { route: 'POST /api/payroll/runs/:id/paid', why: 'needs a pay run, statement or payroll order the sweep doesn’t seed (payroll.test.ts, fullPayroll.test.ts)' },
  { route: 'POST /api/payroll/runs/:id/recalculate', why: 'needs a pay run, statement or payroll order the sweep doesn’t seed (payroll.test.ts, fullPayroll.test.ts)' },
  { route: 'POST /api/payroll/runs/:id/send', why: 'needs a pay run, statement or payroll order the sweep doesn’t seed (payroll.test.ts, fullPayroll.test.ts)' },
  { route: 'POST /api/payroll/runs/:id/void', why: 'needs a pay run, statement or payroll order the sweep doesn’t seed (payroll.test.ts, fullPayroll.test.ts)' },
  { route: 'POST /api/reviews', why: 'needs a review cycle the sweep doesn’t seed (hr.test.ts)' },
  { route: 'POST /api/reviews/:id/acknowledge', why: 'needs a review cycle the sweep doesn’t seed (hr.test.ts)' },
  { route: 'POST /api/schedule/changes/:id/waive', why: 'needs a late schedule change the sweep doesn’t seed (workRules.test.ts)' },
  { route: 'POST /api/training/records', why: 'needs an HR record the sweep doesn’t seed (hr.test.ts, injury.test.ts)' },
  { route: 'POST /api/union/locals/:local/members', why: 'the Union Hub isn’t configured in tests (no UNION_DATABASE_URL); membership, not employer roles, decides access' },
  { route: 'POST /api/union/locals/:local/threads', why: 'the Union Hub isn’t configured in tests (no UNION_DATABASE_URL); membership, not employer roles, decides access' },
  { route: 'POST /api/union/locals/:local/threads/:thread/messages', why: 'the Union Hub isn’t configured in tests (no UNION_DATABASE_URL); membership, not employer roles, decides access' },
  { route: 'POST /api/users/:id/payroll-orders', why: 'needs a pay run, statement or payroll order the sweep doesn’t seed (payroll.test.ts, fullPayroll.test.ts)' },
  { route: 'POST /api/users/:id/payroll-orders/:orderId/end', why: 'needs a pay run, statement or payroll order the sweep doesn’t seed (payroll.test.ts, fullPayroll.test.ts)' },
  { route: 'POST /api/vehicles/:id/return', why: 'needs a vehicle or winter route the sweep doesn’t seed (fleet.test.ts, winter.test.ts)' },
  { route: 'PUT /api/bids/rounds/:id/awards/:itemId', why: 'needs a bid round the sweep doesn’t seed (bidding.test.ts)' },
  { route: 'PUT /api/reviews/:id/manager', why: 'needs a review cycle the sweep doesn’t seed (hr.test.ts)' },
  { route: 'PUT /api/reviews/:id/self', why: 'needs a review cycle the sweep doesn’t seed (hr.test.ts)' },
  { route: 'PUT /api/users/:id/emergency-contacts', why: 'the body is a list, which the fuzzer doesn’t build (emergencyContacts.test.ts)' },
];

/** Every route as [method, path], as crossCity.test.ts finds them. */
const MOUNTS = ['/api/platform', '/api/v1', '/api'];
function routes(appOrRouter: Express): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  type Matcher = (path: string) => false | { path: string };
  const prefix = (layer: { slash?: boolean; matchers: Matcher[] }) => {
    if (layer.slash) return '';
    for (const m of MOUNTS) {
      const hit = layer.matchers[0]!(`${m}/__probe`);
      if (hit && hit.path === m) return m;
    }
    throw new Error('A router is mounted on a path scopeSweep.test.ts doesn’t know: add it to MOUNTS.');
  };
  const walk = (stack: Array<{ route?: { path: string | string[]; methods: Record<string, boolean> }; handle?: { stack?: unknown[] }; slash?: boolean; matchers: Matcher[] }>, base: string) => {
    for (const layer of stack) {
      if (layer.route) {
        for (const p of [layer.route.path].flat()) for (const m of Object.keys(layer.route.methods)) out.push([m.toUpperCase(), `${base}${p}`]);
      } else if (layer.handle?.stack) walk(layer.handle.stack as never, base + prefix(layer));
    }
  };
  walk((appOrRouter as unknown as { router: { stack: never[] } }).router.stack, '');
  return out;
}


/** The organization's own settings, departments, positions and who manages what. */
async function orgSnapshot() {
  const [tenant, departments, allPositions, managers] = await Promise.all([
    owner.tenant.findUnique({ where: { id: t.tenant.id } }).then((x) => ({ ...x, updatedAt: undefined })),
    owner.department.findMany({ where: { tenantId: t.tenant.id }, orderBy: { id: 'asc' } }),
    owner.position.findMany({ where: { tenantId: t.tenant.id }, orderBy: { id: 'asc' } }),
    owner.departmentManager.findMany({ where: { tenantId: t.tenant.id }, orderBy: [{ departmentId: 'asc' }, { userId: 'asc' }] }),
  ]);
  return JSON.stringify({ tenant, departments, allPositions, managers });
}

async function snapshot() {
  const where = { userId: ids.theirs };
  const [user, shifts, punches, timeOff, discipline, notes, events, rates, positions, accommodations, tenant, departments, allPositions, managers] = await Promise.all([
    owner.user.findUnique({ where: { id: ids.theirs } }),
    owner.shift.findMany({ where, orderBy: { id: 'asc' } }),
    owner.timePunch.findMany({ where, orderBy: { id: 'asc' } }),
    owner.timeOffRequest.findMany({ where, orderBy: { id: 'asc' } }),
    owner.disciplinaryRecord.findMany({ where, orderBy: { id: 'asc' } }),
    owner.conductNote.findMany({ where, orderBy: { id: 'asc' } }),
    owner.reliabilityEvent.findMany({ where, orderBy: { id: 'asc' } }),
    owner.payRate.findMany({ where, orderBy: { id: 'asc' } }),
    owner.userPosition.findMany({ where, orderBy: { positionId: 'asc' } }),
    owner.accommodationCase.findMany({ where, orderBy: { id: 'asc' } }),
    // Organization-wide: the tenant's settings, departments, positions and who manages what.
    owner.tenant.findUnique({ where: { id: t.tenant.id } }).then((x) => ({ ...x, updatedAt: undefined })),
    owner.department.findMany({ where: { tenantId: t.tenant.id }, orderBy: { id: 'asc' } }),
    owner.position.findMany({ where: { tenantId: t.tenant.id }, orderBy: { id: 'asc' } }),
    owner.departmentManager.findMany({ where: { tenantId: t.tenant.id }, orderBy: [{ departmentId: 'asc' }, { userId: 'asc' }] }),
  ]);
  return JSON.stringify({ user, shifts, punches, timeOff, discipline, notes, events, rates, positions, accommodations, tenant, departments, allPositions, managers });
}

/** Sets `value` at `path` in `body`, making the objects and arrays on the way. */
function setAt(body: Record<string, unknown>, path: Array<string | number>, value: unknown) {
  if (!path.length) return;
  let at: Record<string | number, unknown> = body;
  for (let i = 0; i < path.length - 1; i++) {
    const k = path[i]!;
    if (at[k] === null || typeof at[k] !== 'object') at[k] = typeof path[i + 1] === 'number' ? [] : {};
    at = at[k] as Record<string | number, unknown>;
  }
  at[path[path.length - 1]!] = value;
}

/** An id of the other department's records that suits a field or parameter name. */
function idFor(name: string): string {
  const n = name.toLowerCase();
  // Shared records a body may need (not another department's): the facility and the certification.
  if (n.startsWith('facilit')) return t.facility.id;
  if (n.startsWith('certification')) return t.nls.id;
  for (const [k, xs] of Object.entries(kinds)) if (n.startsWith(k) || n.includes(`${k}id`)) return xs[0]!;
  if (/^(id|ids|userids?|personids?|memberids?|subjectids?|employeeids?|managerids?)$/.test(n)) return kinds.user![0]!;
  return kinds.user![0]!;
}

/** Ends of a range come after their starts; things that happened are in the past (dates relative to now). */
const later = (k: string) => /(end|close|to$|until|expir|last|max)/.test(k);
const earlier = (k: string) => /(start|open|from|issue|first|min)/.test(k);
function day(k: string): string {
  const shift = later(k) ? -20 : earlier(k) ? -21 : /(occurred|learned|completed|happened|on$)/.test(k) ? -22 : -21;
  return new Date(Date.now() + shift * 86_400_000).toISOString().slice(0, 10);
}

/** A value that satisfies one zod issue (the API answers 400 VALIDATION with zod's issues). */
function valueFor(issue: { code: string; path: Array<string | number>; expected?: string; format?: string; pattern?: string; values?: unknown[]; origin?: string; minimum?: number | string; maximum?: number | string; inclusive?: boolean; errors?: unknown[][] }): unknown {
  const key = String([...issue.path].reverse().find((p) => typeof p === 'string') ?? '');
  const k = key.toLowerCase();
  const text = (min = 1) => 'Sample text for the sweep. '.repeat(Math.ceil(Math.max(min, 1) / 27)).slice(0, Math.max(min, 12));
  const stringFor = () => {
    if (/(^|[^a-z])id$|id$/.test(k) && !k.endsWith('paid')) return idFor(key);
    if (k.includes('email')) return 'someone@example.test';
    if (k.endsWith('on') || k.includes('date') || k === 'from' || k === 'to' || k === 'day') return day(k);
    if (k.endsWith('at') || k.includes('time')) return `${day(k)}T16:00:00.000Z`;
    return text();
  };
  switch (issue.code) {
    case 'invalid_type':
      if (issue.expected === 'string') return stringFor();
      if (issue.expected === 'number' || issue.expected === 'int') return later(k) ? 600 : earlier(k) ? 540 : 1;
      if (issue.expected === 'boolean') return true;
      if (issue.expected === 'array') return k.endsWith('ids') ? [idFor(key.slice(0, -1))] : [];
      if (issue.expected === 'object' || issue.expected === 'record') return {};
      if (issue.expected === 'date') return `${day(k)}T16:00:00.000Z`;
      return text();
    case 'invalid_format': {
      if (issue.format === 'uuid' || issue.format === 'guid') return idFor(key);
      if (issue.format === 'email') return 'someone@example.test';
      if (issue.format === 'datetime') return `${day(k)}T16:00:00.000Z`;
      if (issue.format === 'date') return day(k);
      if (issue.format === 'url') return 'https://example.test/x';
      const p = issue.pattern ?? '';
      if (p.includes('\\d{4}-\\d{2}-\\d{2}')) return '2026-12-01';
      if (p.includes('\\d{2}-\\d{2}')) return '11-01';
      if (p.includes(':')) return '09:00';
      if (/#|\[0-9a-fA-F\]\{6\}/.test(p)) return '#336699';
      if (/\[A-Za-z\]\\d/.test(p)) return 'V1V 1V1';
      // A run of digits: \d{3}, \d{4,6}…
      const digits = /\\d\{(\d+)/.exec(p);
      return digits ? '1234567890'.slice(0, Number(digits[1])) : '1';
    }
    case 'invalid_value':
      return issue.values?.[0];
    case 'too_small':
      if (issue.origin === 'string') return text(Number(issue.minimum ?? 1));
      if (issue.origin === 'array' || issue.origin === 'set') return Array.from({ length: Number(issue.minimum ?? 1) }, () => (k.endsWith('ids') ? idFor(key.slice(0, -1)) : text()));
      return Number(issue.minimum ?? 0) + (issue.inclusive === false ? 1 : 0);
    case 'too_big':
      if (issue.origin === 'string') return 'x';
      if (issue.origin === 'array') return [];
      return Number(issue.maximum ?? 0) - (issue.inclusive === false ? 1 : 0);
    case 'invalid_union': {
      const first = (issue.errors?.[0] ?? []) as Array<Parameters<typeof valueFor>[0]>;
      return first.length ? valueFor({ ...first[0]!, path: issue.path }) : text();
    }
    default:
      return undefined;
  }
}

type Answer = { status: number; code?: string; text: string };
/** An answer that shows the route ran its checks: not validation (400), a missing id (404), a crash (5xx) or no answer. */
const tested = (status: number) => status !== 0 && status !== 400 && status !== 404 && status < 500;
const slow: string[] = [];

/** Sends a request; on 400 VALIDATION, fills what zod asked for and tries again (a few rounds). */
async function send(token: string, method: string, url: string, collectSlow: boolean, path = ''): Promise<Answer & { body: Record<string, unknown> }> {
  const body: Record<string, unknown> = BODIES[`${method} ${path}`]?.() ?? {};
  let last: Answer = { status: 0, text: '' };
  for (let round = 0; round < 8; round++) {
    const req = request(server)[method.toLowerCase() as 'get'](url).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }).timeout(15_000);
    // GETs take what zod asked for in the query string, writes in the body.
    const r = await (method === 'GET' ? req.query(Object.fromEntries(Object.entries(body).map(([k, v]) => [k, Array.isArray(v) ? v.join(',') : String(v)]))) : req.send(body))
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks).toString('latin1')));
      })
      .catch((e: Error) => {
        if (collectSlow) slow.push(`${method} ${url}: ${e.message}`);
        return { status: 0, body: '' };
      });
    const text = String(r.body ?? '');
    let parsed: { code?: string; details?: unknown } = {};
    try {
      parsed = (JSON.parse(text) as typeof parsed | null) ?? {};
    } catch {
      /* not JSON */
    }
    last = { status: r.status, code: parsed.code, text };
    if (r.status !== 400 || parsed.code !== 'VALIDATION' || !Array.isArray(parsed.details)) break;
    let changed = false;
    for (const issue of parsed.details as Array<Parameters<typeof valueFor>[0]>) {
      const v = valueFor(issue);
      if (v === undefined) continue;
      setAt(body, issue.path, v);
      changed = true;
    }
    if (!changed) break;
  }
  return { ...last, body };
}

beforeAll(async () => {
  t = await seedTenant(SUB, 0);
  // Every feature on, so no route answers 404 FEATURE_OFF instead of being tested.
  await owner.tenant.update({ where: { id: t.tenant.id }, data: { features: Object.fromEntries(FEATURE_KEYS.map((k) => [k, true])) } });
  forgetFeatures(t.tenant.id);
  const now = Math.floor(Date.now() / 1000);
  const guard = (await owner.position.create({ data: { tenantId: t.tenant.id, name: 'Pool Lifeguard' } })).id;
  const water = (await owner.position.create({ data: { tenantId: t.tenant.id, name: 'Water Operator' } })).id;
  const mk = async (roles: Array<'HR_ADMIN' | 'STAFF' | 'EMPLOYEE'>, first: string, last: string, position?: string) => {
    const u = await owner.user.create({ data: { tenantId: t.tenant.id, roles, employmentStatus: 'FULL_TIME', firstName: first, lastName: last, email: `${first.toLowerCase()}.${last.toLowerCase()}@${SUB}.test`, dateOfBirth: new Date('1990-01-01') } });
    if (position) await owner.userPosition.create({ data: { tenantId: t.tenant.id, userId: u.id, positionId: position } });
    return u.id;
  };
  ids.hr = await mk(['HR_ADMIN'], 'Hana', 'Admin');
  ids.mine = await mk(['STAFF'], 'Pat', 'Poolside', guard);
  ids.theirs = await mk(['EMPLOYEE'], 'Wendell', 'Waterworksonly', water);
  tok.hr = await signAccessToken({ sub: ids.hr, tid: t.tenant.id, roles: ['HR_ADMIN'], aat: now, mfa: true });
  const hr = (m: 'post' | 'get', p: string, b?: object) => request(server)[m](p).set('x-tenant-subdomain', SUB).auth(tok.hr, { type: 'bearer' }).send(b);
  const aquatics = (await hr('post', '/api/departments', { name: 'Aquatics', aquatic: true, positionIds: [guard] })).body.id as string;
  const waterWorks = (await hr('post', '/api/departments', { name: 'Water Works', positionIds: [water] })).body.id as string;
  const catalog = (await hr('get', '/api/roles')).body.catalog as Record<string, string[]>;
  const role = await hr('post', '/api/roles', { name: 'Aquatics everything', permissions: Object.values(catalog).flat(), scopeDepartmentIds: [aquatics] });
  if (role.status !== 201) throw new Error(`role: ${role.status} ${JSON.stringify(role.body)}`);
  ids.limited = await mk(['EMPLOYEE'], 'Lim', 'Ited', guard);
  await owner.userCustomRole.create({ data: { tenantId: t.tenant.id, userId: ids.limited, customRoleId: role.body.id } });
  forgetCustomPermissions(t.tenant.id);
  tok.limited = await signAccessToken({ sub: ids.limited, tid: t.tenant.id, roles: ['EMPLOYEE'], aat: now, mfa: true });

  // The Water Works person's records, and Water Works itself, whose ids fill every path.
  const shift = await owner.shift.create({ data: { tenantId: t.tenant.id, facilityId: t.facility.id, positionId: water, userId: ids.theirs, startsAt: new Date(Date.now() + 86_400_000), endsAt: new Date(Date.now() + 90_000_000), status: 'PUBLISHED' } });
  const punch = await owner.timePunch.create({ data: { tenantId: t.tenant.id, userId: ids.theirs, facilityId: t.facility.id, positionId: water, clockIn: new Date(Date.now() - 3 * 3_600_000), clockOut: new Date(Date.now() - 3_600_000), status: 'PENDING' } });
  const timeOff = await owner.timeOffRequest.create({ data: { tenantId: t.tenant.id, userId: ids.theirs, startsAt: new Date(Date.now() + 5 * 86_400_000), endsAt: new Date(Date.now() + 6 * 86_400_000), type: 'VACATION', note: 'Waterworks-only trip' } });
  const note = await owner.conductNote.create({ data: { tenantId: t.tenant.id, userId: ids.theirs, recordedById: ids.hr, category: 'CONDUCT', summary: 'Waterworks-only conduct note text.', occurredAt: new Date() } });
  const event = await owner.reliabilityEvent.create({ data: { tenantId: t.tenant.id, userId: ids.theirs, type: 'NO_SHOW', occurredAt: new Date(Date.now() - 86_400_000), note: 'Waterworks-only no-show', recordedById: ids.hr } });
  const discipline = await owner.disciplinaryRecord.create({ data: { tenantId: t.tenant.id, userId: ids.theirs, issuedById: ids.hr, issuedAt: new Date(), summary: 'Waterworks-only written warning text.' } });
  const accommodation = await owner.accommodationCase.create({ data: { tenantId: t.tenant.id, userId: ids.theirs, label: 'Waterworks-only accommodation', startsOn: new Date('2026-01-01'), createdById: ids.hr } });
  // Water Works' own custom role, and an onboarding item (the checklist routes take its id).
  const waterRole = await hr('post', '/api/roles', { name: 'Water Works lead', permissions: ['schedule.read', 'users.read'], scopeDepartmentIds: [waterWorks] });
  if (waterRole.status !== 201) throw new Error(`water role: ${waterRole.status}`);
  const expense = await owner.expenseClaim.create({ data: { tenantId: t.tenant.id, userId: ids.theirs, title: 'Waterworks-only mileage', total: 42.5 } });
  const alone = await owner.loneWorkSession.create({ data: { tenantId: t.tenant.id, userId: ids.theirs, location: 'Waterworks-only pump station', intervalMinutes: 30, nextDueAt: new Date(Date.now() + 1_800_000) } });
  const cert = await owner.userCertification.create({ data: { tenantId: t.tenant.id, userId: ids.theirs, certificationId: t.nls.id, issueDate: new Date('2026-01-01'), expiryDate: new Date('2028-01-01') } });
  const item = await owner.onboardingItem.create({ data: { tenantId: t.tenant.id, name: 'Sweep orientation (organization catalogue)', owner: 'SUPERVISOR', kind: 'TASK' } });
  await owner.payRate.create({ data: { tenantId: t.tenant.id, userId: ids.theirs, positionId: water, hourlyRate: 47.13, effectiveFrom: new Date('2025-01-01') } });
  Object.assign(kinds, {
    user: [ids.theirs],
    shift: [shift.id],
    punch: [punch.id],
    department: [waterWorks],
    position: [water],
    timeoff: [timeOff.id],
    note: [note.id],
    event: [event.id],
    record: [discipline.id],
    accommodation: [accommodation.id],
    role: [waterRole.body.id as string],
    item: [item.id],
    expense: [expense.id],
    lonework: [alone.id],
    certification: [cert.id],
  });
  markers.push(ids.theirs, shift.id, punch.id, timeOff.id, note.id, event.id, discipline.id, accommodation.id, expense.id, alone.id, cert.id, 'Waterworksonly', `wendell.waterworksonly@${SUB}.test`, 'Waterworks-only');
});
afterAll(async () => {
  await appDb.$disconnect();
  await owner.$disconnect();
});

describe('department limits hold on every route', () => {
  it('a department-limited role with every capability reaches no one outside its department, and no organization-wide setting', async () => {
    const before = await snapshot();
    const all = routes(server as unknown as Express).filter(([m, p]) => p.startsWith('/api/') && !EXCLUDED.some((x) => x.test(m, p)));
    expect(all.length).toBeGreaterThan(300);
    const encode = (id: string) => `%${id.charCodeAt(0).toString(16)}${id.slice(1)}`;
    /** Every id the parameter could take: by its name, or one of each kind for a bare :id. */
    const candidates = (param: string) => {
      const p = param.slice(1).toLowerCase();
      for (const [k, xs] of Object.entries(kinds)) if (p.startsWith(k)) return xs;
      if (/^(local|thread|item|key|choice|code|year|tenantid|file|token|lang|period)/.test(p)) return [kinds.user![0]!];
      return Object.values(kinds).map((xs) => xs[0]!);
    };
    const jobs: Array<{ method: string; path: string; url: string; aimed: boolean }> = [];
    for (const [method, path] of all) {
      const params = path.match(/:\w+/g) ?? [];
      if (!params.length) {
        jobs.push({ method, path, url: path, aimed: false });
        continue;
      }
      const [first, ...rest] = params;
      for (const id of candidates(first!)) {
        for (const form of [id, encode(id)]) {
          let url = path.replace(first!, form);
          for (const r of rest) url = url.replace(r, candidates(r)[0]!);
          jobs.push({ method, path, url: url.replace(/\(\.\*\)|\*/g, ''), aimed: true });
        }
      }
    }
    const problems: string[] = [];
    const answers = new Map<number, Answer & { body: Record<string, unknown> }>();
    // Reads in parallel; writes one at a time, so the same requests give the same answers each run.
    const reads = jobs.map((j, n) => ({ j, n })).filter(({ j }) => j.method === 'GET');
    const writes = jobs.map((j, n) => ({ j, n })).filter(({ j }) => j.method !== 'GET');
    let i = 0;
    await Promise.all(Array.from({ length: 6 }, async () => {
      while (i < reads.length) {
        const { j, n } = reads[i++]!;
        answers.set(n, await send(tok.limited, j.method, j.url, true, j.path));
      }
    }));
    // A write without parameters creates something or changes a setting: it's a problem when it
    // changed the organization's own settings, departments, positions or managers.
    const changedOrg = new Set<number>();
    for (const { j, n } of writes) {
      const orgBefore = j.aimed ? '' : await orgSnapshot();
      answers.set(n, await send(tok.limited, j.method, j.url, true, j.path));
      if (!j.aimed && (await orgSnapshot()) !== orgBefore) changedOrg.add(n);
    }
    for (const [n, a] of answers) {
      const j = jobs[n]!;
      if (a.status < 200 || a.status >= 300 || allowed(j.method, j.path)) continue;
      const hit = markers.find((m) => a.text.includes(m));
      if (hit) problems.push(`${j.method} ${j.url} → ${a.status} holds ${hit}`);
      else if (j.method !== 'GET' && j.aimed) problems.push(`${j.method} ${j.url} → ${a.status} (a write aimed at another department)`);
      // Any other write that succeeds without parameters must be listed in ALLOWED with its reason:
      // a write that changes something organization-wide isn't always in the four tables compared.
      else if (j.method !== 'GET' && !ownPage(j.path)) problems.push(`${j.method} ${j.url} → ${a.status} (${changedOrg.has(n) ? 'changed an organization-wide setting' : 'a write without parameters: list it in ALLOWED with the reason, or refuse it'})`);
    }
    console.log(`department sweep: ${jobs.length} requests over ${all.length} routes`);
    expect(slow, 'no answer within 15 s').toEqual([]);
    expect(problems.sort()).toEqual([]);
    expect(await snapshot()).toBe(before);

    // Coverage: a route the sweep never got past validation or a missing id on is a route it
    // didn't test. Each request that ended in 400 or 404 is replayed as HR (unlimited), with the
    // same body; a route where neither ever got further must be listed in UNREACHED with a reason.
    const reachedRoutes = new Set<string>();
    const pending: Array<{ j: (typeof jobs)[number]; a: Answer & { body: Record<string, unknown> } }> = [];
    for (const [n, a] of answers) {
      const j = jobs[n]!;
      // A crash (5xx) or no answer isn't a test of the route's limits: it counts as not reached.
      if (tested(a.status)) reachedRoutes.add(`${j.method} ${j.path}`);
      else pending.push({ j, a });
    }
    for (const { j } of pending) {
      const key = `${j.method} ${j.path}`;
      if (reachedRoutes.has(key)) continue;
      // HR's answer to the same request: past validation and the id (any status but 400/404) means the
      // limited role's 400/404 came from its limits, so the route was tested. GETs only, and writes
      // through the fuzzer (HR may change things now; the snapshot above is already taken).
      const hrAnswer = await send(tok.hr, j.method, j.url, false, j.path);
      if (tested(hrAnswer.status)) reachedRoutes.add(key);
    }
    // The caller's own pages (/api/me) can't reach anyone else: they're not held to coverage.
    const covered = [...new Set(all.filter(([, p]) => !ownPage(p)).map(([m, p]) => `${m} ${p}`))];
    const unreached = covered.filter((r) => !reachedRoutes.has(r) && !UNREACHED.some((u) => u.route === r)).sort();
    if (process.env.SWEEP_DEBUG) {
      for (const r of covered.filter((x) => !reachedRoutes.has(x)).sort()) {
        const n = jobs.findIndex((j) => `${j.method} ${j.path}` === r);
        const a = answers.get(n);
        console.log('UNREACHED', r, a?.status, a?.text.slice(0, 160), JSON.stringify(a?.body).slice(0, 200));
      }
    }
    const stale = UNREACHED.filter((u) => reachedRoutes.has(u.route)).map((u) => u.route);
    console.log(`department sweep coverage: ${reachedRoutes.size} routes tested; ${UNREACHED.length} listed as unreachable`);
    expect(unreached, 'routes the sweep can’t reach: give the fuzzer what it needs, or list them in UNREACHED with the reason').toEqual([]);
    expect(stale, 'routes listed in UNREACHED that the sweep now reaches: remove them from the list').toEqual([]);
  }, 900_000);
});
