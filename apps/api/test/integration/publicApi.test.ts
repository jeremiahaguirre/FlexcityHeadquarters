import { randomBytes } from 'node:crypto';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { signAccessToken } from '../../src/auth/tokens.js';
import { withTenant } from '../../src/lib/db.js';
import { dispatchTenant } from '../../src/lib/outbox.js';
import { hashKey } from '../../src/services/integrations/apiKeys.js';
import { verifySignature } from '../../src/services/integrations/signing.js';
import { deliverTenantWebhooks, queueWebhookDeliveries } from '../../src/services/integrations/webhooks.js';
import { forgetFeatures } from '../../src/services/platform/features.js';
import { app as appDb, owner, seedTenant } from './fixtures.js';

// Signing secrets are sealed with the city's key; the receiver below runs on localhost.
process.env.LOCAL_KEK_BASE64 ||= randomBytes(32).toString('base64');
process.env.WEBHOOK_LOCAL_TARGETS = 'on';

const server = createApp();
const A = 'apicity';
const B = 'apiother';
let a: Awaited<ReturnType<typeof seedTenant>>;
let b: Awaited<ReturnType<typeof seedTenant>>;
const tok: Record<string, string> = {};
let keyA = '';
let keyB = '';
let peopleOnly = '';
let hrA = '';

const as = (who: string, sub = A) => ({
  get: (p: string) => request(server).get(p).set('x-tenant-subdomain', sub).auth(tok[who]!, { type: 'bearer' }),
  post: (p: string, body: object = {}) => request(server).post(p).set('x-tenant-subdomain', sub).auth(tok[who]!, { type: 'bearer' }).send(body),
  patch: (p: string, body: object) => request(server).patch(p).set('x-tenant-subdomain', sub).auth(tok[who]!, { type: 'bearer' }).send(body),
  del: (p: string) => request(server).delete(p).set('x-tenant-subdomain', sub).auth(tok[who]!, { type: 'bearer' }),
});
const v1 = (key: string, p: string) => request(server).get(`/api/v1${p}`).auth(key, { type: 'bearer' });
const ALL = ['people:read', 'departments:read', 'positions:read', 'facilities:read', 'schedule:read', 'timesheets:read', 'timeoff:read', 'payroll:read'];

/* ---------- A receiver for webhooks ---------- */
let receiver: Server;
let hookUrl = '';
let answer = 200;
const received: Array<{ headers: IncomingHttpHeaders; body: string }> = [];

const day = (n: number) => new Date(Date.now() + n * 86_400_000);

beforeAll(async () => {
  a = await seedTenant(A, 3);
  b = await seedTenant(B, 2);
  const now = Math.floor(Date.now() / 1000);
  const hr = await owner.user.create({ data: { tenantId: a.tenant.id, roles: ['HR_ADMIN'], employmentStatus: 'FULL_TIME', firstName: 'Hana', lastName: 'Admin', email: `hr@${A}.test`, phone: '250-555-0199' } });
  hrA = hr.id;
  tok.hr = await signAccessToken({ sub: hr.id, tid: a.tenant.id, roles: ['HR_ADMIN'], aat: now });
  const hrB = await owner.user.create({ data: { tenantId: b.tenant.id, roles: ['HR_ADMIN'], employmentStatus: 'FULL_TIME', firstName: 'Bo', lastName: 'Admin', email: `hr@${B}.test` } });
  tok.hrB = await signAccessToken({ sub: hrB.id, tid: b.tenant.id, roles: ['HR_ADMIN'], aat: now });
  const sup = await owner.user.create({ data: { tenantId: a.tenant.id, roles: ['AQUATIC_SUPERVISOR'], employmentStatus: 'FULL_TIME', firstName: 'Sam', lastName: 'Sup', email: `sup@${A}.test` } });
  tok.sup = await signAccessToken({ sub: sup.id, tid: a.tenant.id, roles: ['AQUATIC_SUPERVISOR'], aat: now });
  await owner.user.update({ where: { id: a.users[0]!.id }, data: { employeeNumber: 'E1', hireDate: new Date('2024-05-01'), reportsToId: sup.id, phone: '250-555-0101' } });

  // Things the API reads, in city A.
  const s = await owner.shift.create({ data: { tenantId: a.tenant.id, facilityId: a.facility.id, positionId: a.position.id, userId: a.users[0]!.id, startsAt: day(1), endsAt: new Date(day(1).getTime() + 4 * 3_600_000), status: 'PUBLISHED' } });
  await owner.shift.create({ data: { tenantId: a.tenant.id, facilityId: a.facility.id, positionId: a.position.id, startsAt: day(2), endsAt: new Date(day(2).getTime() + 4 * 3_600_000), status: 'DRAFT' } });
  await owner.timePunch.create({ data: { tenantId: a.tenant.id, userId: a.users[0]!.id, facilityId: a.facility.id, shiftId: s.id, positionId: a.position.id, clockIn: day(-1), clockOut: new Date(day(-1).getTime() + 3.5 * 3_600_000), status: 'APPROVED', ipAddress: '198.51.100.23', latitude: 49.88, longitude: -119.44, reviewedAt: new Date() } });
  await owner.timePunch.create({ data: { tenantId: a.tenant.id, userId: a.users[1]!.id, facilityId: a.facility.id, positionId: a.position.id, clockIn: day(-1), clockOut: new Date(day(-1).getTime() + 3_600_000), status: 'PENDING' } });
  await owner.timeOffRequest.create({ data: { tenantId: a.tenant.id, userId: a.users[1]!.id, type: 'SICK', startsAt: day(3), endsAt: day(4), status: 'APPROVED', note: 'migraine and doctor visit', decidedAt: new Date() } });
  const run = await owner.payRun.create({ data: { tenantId: a.tenant.id, periodStart: new Date('2026-10-01'), periodEnd: new Date('2026-10-14'), payDate: new Date('2026-10-20'), periodsPerYear: 26, status: 'APPROVED', preparedById: hr.id, approvedAt: new Date(), totals: { gross: 1234.5, deductions: 234.5, net: 1000, employerCpp: 50, employerEi: 20, people: 1 } } });
  await owner.payRun.create({ data: { tenantId: a.tenant.id, periodStart: new Date('2026-10-15'), periodEnd: new Date('2026-10-28'), payDate: new Date('2026-11-03'), periodsPerYear: 26, status: 'DRAFT', preparedById: hr.id } });
  await owner.payStatement.create({ data: { tenantId: a.tenant.id, payRunId: run.id, userId: a.users[0]!.id, province: 'BC', year: 2026, payDate: new Date('2026-10-20'), hours: 40, earnings: [], deductions: { cpp: 60 }, gross: 1234.5, totalDeductions: 234.5, net: 1000, employerCpp: 50, employerEi: 20, ytd: {}, depositLast4: '6789' } });

  receiver = createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    received.push({ headers: req.headers, body });
    if (answer >= 300 && answer < 400) res.setHeader('location', 'http://169.254.169.254/latest/meta-data');
    res.statusCode = answer;
    res.end(answer === 200 ? 'ok' : 'x'.repeat(5000));
  });
  await new Promise<void>((r) => receiver.listen(0, '127.0.0.1', r));
  hookUrl = `http://localhost:${(receiver.address() as AddressInfo).port}/hooks/fh`;
});
afterAll(async () => {
  receiver.close();
  await appDb.$disconnect();
  await owner.$disconnect();
});

describe('API keys (Settings › Integrations)', () => {
  it('HR makes a key; it is shown once and only its hash is kept; staff and supervisors can’t', async () => {
    expect((await as('sup').get('/api/integrations')).status).toBe(403);
    const r = await as('hr').post('/api/integrations/api-keys', { name: 'SAP HR sync', scopes: ALL, expiresAt: null });
    expect(r.status).toBe(201);
    keyA = r.body.key;
    expect(keyA).toMatch(/^fh_live_[a-z0-9]{8}_[A-Za-z0-9_-]{43}$/);
    expect(r.body.apiKey.prefix).toBe(keyA.slice(0, 16));
    const row = await owner.apiKey.findUniqueOrThrow({ where: { id: r.body.apiKey.id } });
    expect(row.keyHash).toBe(hashKey(keyA));
    expect(JSON.stringify(row)).not.toContain(keyA.slice(17));
    const list = await as('hr').get('/api/integrations');
    expect(list.body.inPlan).toBe(true);
    expect(JSON.stringify(list.body)).not.toContain(keyA.slice(17));
    const log = await owner.auditLog.findFirstOrThrow({ where: { tenantId: a.tenant.id, action: 'api_key.create' } });
    expect(JSON.stringify(log)).not.toContain(keyA.slice(17));

    keyB = (await as('hrB', B).post('/api/integrations/api-keys', { name: 'Other city', scopes: ALL })).body.key;
    peopleOnly = (await as('hr').post('/api/integrations/api-keys', { name: 'GIS', scopes: ['people:read'] })).body.key;
    expect(keyB && peopleOnly).toBeTruthy();
  });

  it('refuses bad allow lists, past expiry, and unknown scopes', async () => {
    expect((await as('hr').post('/api/integrations/api-keys', { name: 'Bad', scopes: ['people:read'], allowedIps: ['not-an-ip'] })).status).toBe(400);
    expect((await as('hr').post('/api/integrations/api-keys', { name: 'Bad', scopes: ['people:read'], expiresAt: '2020-01-01' })).status).toBe(400);
    expect((await as('hr').post('/api/integrations/api-keys', { name: 'Bad', scopes: ['payroll:write'] })).status).toBe(400);
  });
});

describe('the public API', () => {
  it('answers with the key, and 401 without it or with a wrong one', async () => {
    const r = await v1(keyA, '/people');
    expect(r.status).toBe(200);
    expect(r.headers['x-request-id']).toBeTruthy();
    expect(r.body.data.length).toBe(5);
    expect((await request(server).get('/api/v1/people')).body.code).toBe('API_KEY_MISSING');
    expect((await v1('nonsense', '/people')).status).toBe(401);
    const wrong = `${keyA.slice(0, 17)}${'A'.repeat(43)}`;
    const w = await v1(wrong, '/people');
    expect(w.status).toBe(401);
    expect(w.body).toMatchObject({ code: 'API_KEY_INVALID' });
    expect(w.body.requestId).toBeTruthy();
  });

  it('a person session token is not an API key, and the key is not a session', async () => {
    expect((await v1(tok.hr!, '/people')).status).toBe(401);
    expect((await request(server).get('/api/staff').set('x-tenant-subdomain', A).auth(keyA, { type: 'bearer' })).status).toBe(401);
  });

  it('checks the scope per endpoint', async () => {
    expect((await v1(peopleOnly, '/people')).status).toBe(200);
    const r = await v1(peopleOnly, '/shifts?from=2026-01-01&to=2026-02-01');
    expect(r.status).toBe(403);
    expect(r.body).toMatchObject({ code: 'INSUFFICIENT_SCOPE', details: { scope: 'schedule:read' } });
    expect((await v1(peopleOnly, '/pay-runs')).status).toBe(403);
  });

  it('never shows another city’s data', async () => {
    const mine = (await v1(keyA, '/people?limit=500')).body.data.map((p: { id: string }) => p.id);
    const theirs = (await v1(keyB, '/people?limit=500')).body.data.map((p: { id: string }) => p.id);
    expect(mine).not.toContain(b.users[0]!.id);
    expect(theirs).not.toContain(a.users[0]!.id);
    expect(theirs).toHaveLength(3);
    expect((await v1(keyA, `/people/${b.users[0]!.id}`)).status).toBe(404);
    expect((await v1(keyB, `/people/${a.users[0]!.id}`)).status).toBe(404);
    expect((await v1(keyB, '/pay-runs')).body.data).toEqual([]);
    const from = day(-5).toISOString();
    const to = day(20).toISOString();
    expect((await v1(keyB, `/shifts?from=${from}&to=${to}`)).body.data).toEqual([]);
    expect((await v1(keyB, `/timesheets?from=${from}&to=${to}`)).body.data).toEqual([]);
    expect((await v1(keyB, '/facilities')).body.data.map((f: { id: string }) => f.id)).toEqual([b.facility.id]);
  });

  it('shapes are stable and leave out sensitive fields', async () => {
    const p = (await v1(keyA, `/people/${a.users[0]!.id}`)).body;
    expect(p).toEqual({
      id: a.users[0]!.id,
      external_id: null,
      employee_number: 'E1',
      first_name: 'Guard0',
      last_name: A,
      preferred_name: null,
      email: `guard0@${A}.test`,
      status: 'active',
      employment_status: 'part_time',
      hire_date: '2024-05-01',
      manager_id: expect.any(String),
      department_ids: [],
      positions: [{ id: a.position.id, name: 'Lifeguard', department_id: null }],
      processing_restricted: false,
      created_at: expect.any(String),
      updated_at: expect.any(String),
    });
    const from = day(-5).toISOString();
    const to = day(20).toISOString();
    const all = JSON.stringify([
      (await v1(keyA, '/people?limit=500')).body,
      (await v1(keyA, `/shifts?from=${from}&to=${to}`)).body,
      (await v1(keyA, `/timesheets?from=${from}&to=${to}`)).body,
      (await v1(keyA, '/time-off')).body,
      (await v1(keyA, '/pay-runs')).body,
    ]);
    for (const secret of ['2000-01-01', '250-555-0101', '250-555-0199', 'migraine', '198.51.100.23', 'deposit', '49.88', 'dateOfBirth', '"sin"', 'bank', 'passwordHash', 'reliability', 'phone', 'birth']) expect(all).not.toContain(secret);

    const shifts = (await v1(keyA, `/shifts?from=${from}&to=${to}`)).body.data;
    expect(shifts).toHaveLength(1); // published only, not the draft
    expect(shifts[0]).toMatchObject({ person_id: a.users[0]!.id, status: 'published' });
    const ts = (await v1(keyA, `/timesheets?from=${from}&to=${to}`)).body.data;
    expect(ts).toHaveLength(1); // approved only
    expect(ts[0]).toMatchObject({ hours: '3.50', person_id: a.users[0]!.id });
    expect((await v1(keyA, '/time-off')).body.data[0]).toMatchObject({ type: 'sick', person_id: a.users[1]!.id });
    const runs = (await v1(keyA, '/pay-runs')).body.data;
    expect(runs).toHaveLength(1); // approved only
    expect(runs[0].totals).toEqual({ gross: '1234.50', deductions: '234.50', net: '1000.00', employer_cpp: '50.00', employer_ei: '20.00', people: 1 });
    const st = (await v1(keyA, `/pay-runs/${runs[0].id}/statements`)).body.data;
    expect(st).toEqual([{ id: expect.any(String), person_id: a.users[0]!.id, hours: '40.00', gross: '1234.50', net: '1000.00' }]);
    const draft = await owner.payRun.findFirstOrThrow({ where: { tenantId: a.tenant.id, status: 'DRAFT' } });
    expect((await v1(keyA, `/pay-runs/${draft.id}/statements`)).status).toBe(404);
  });

  it('people whose processing is restricted keep only their id and status', async () => {
    await owner.user.update({ where: { id: a.users[2]!.id }, data: { processingRestrictedAt: new Date(), status: 'TERMINATED' } });
    const p = (await v1(keyA, `/people/${a.users[2]!.id}`)).body;
    expect(p).toMatchObject({ status: 'terminated', processing_restricted: true, first_name: null, last_name: null, email: null, employee_number: null, positions: [] });
    expect((await v1(keyA, '/people?status=terminated')).body.data.map((x: { id: string }) => x.id)).toEqual([a.users[2]!.id]);
  });

  it('pages with a cursor, oldest change first, and filters by updated_since', async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const r: { body: { data: Array<{ id: string; updated_at: string }>; next_cursor: string | null } } = await v1(keyA, `/people?limit=2${cursor ? `&cursor=${cursor}` : ''}`);
      seen.push(...r.body.data.map((p) => p.id));
      cursor = r.body.next_cursor;
      pages++;
    } while (cursor && pages < 10);
    expect(pages).toBe(3);
    expect(new Set(seen).size).toBe(5);
    expect((await v1(keyA, '/people?cursor=garbage')).body.code).toBe('BAD_CURSOR');
    const mark = new Date();
    await new Promise((r) => setTimeout(r, 5));
    await owner.user.update({ where: { id: a.users[1]!.id }, data: { lastName: 'Changed' } });
    const since = (await v1(keyA, `/people?updated_since=${mark.toISOString()}`)).body.data;
    expect(since.map((p: { id: string }) => p.id)).toEqual([a.users[1]!.id]);
    expect((await v1(keyA, '/shifts?from=2026-01-01&to=2026-12-31')).body.code).toBe('BAD_RANGE');
  });

  it('serves its OpenAPI description; every documented read answers and every documented write exists', async () => {
    const spec = (await request(server).get('/api/v1/openapi.json')).body;
    expect(spec.openapi).toBe('3.1.0');
    const run = (await v1(keyA, '/pay-runs')).body.data[0].id;
    const ids: Record<string, string> = {
      '/people': a.users[0]!.id,
      '/pay-runs': run,
      '/departments': (await owner.department.upsert({ where: { tenantId_name: { tenantId: a.tenant.id, name: 'Aquatics' } }, update: {}, create: { tenantId: a.tenant.id, name: 'Aquatics' } })).id,
      '/positions': a.position.id,
      '/time-off': (await owner.timeOffRequest.findFirstOrThrow({ where: { tenantId: a.tenant.id } })).id,
    };
    for (const [path, ops] of Object.entries(spec.paths as Record<string, Record<string, unknown>>)) {
      const base = Object.keys(ids).find((p) => path.startsWith(p))!;
      const url = path.replace('{id}', ids[base]!).replace('{externalId}', 'X-1') + (/shifts|timesheets/.test(path) ? `?from=${day(-5).toISOString()}&to=${day(20).toISOString()}` : '');
      if (ops.get) expect([path, (await v1(keyA, url)).status]).toEqual([path, 200]);
      // keyA reads only: a documented write answers 403 for its scope, never 404.
      for (const method of ['post', 'patch', 'put'] as const) {
        if (!ops[method]) continue;
        const r = await request(server)[method](`/api/v1${url}`).auth(keyA, { type: 'bearer' }).send({});
        expect([method, path, r.status, r.body.code]).toEqual([method, path, 403, 'INSUFFICIENT_SCOPE']);
      }
    }
    expect((await v1(keyA, '/nothing-here')).status).toBe(404);
  });

  it('records each call: last used, a count, and the audit log', async () => {
    const k = await owner.apiKey.findFirstOrThrow({ where: { keyHash: hashKey(keyA) } });
    expect(k.requestCount).toBeGreaterThan(10);
    expect(k.lastUsedAt).toBeTruthy();
    expect(await owner.auditLog.count({ where: { tenantId: a.tenant.id, action: 'api.request', entityId: k.id } })).toBe(k.requestCount);
  });

  it('limits requests per key (in the database)', async () => {
    const r = await as('hr').post('/api/integrations/api-keys', { name: 'Busy', scopes: ['facilities:read'] });
    await owner.apiKey.update({ where: { id: r.body.apiKey.id }, data: { rateLimitPerMinute: 3 } });
    for (let i = 0; i < 3; i++) {
      const ok = await v1(r.body.key, '/facilities');
      expect(ok.status).toBe(200);
      expect(ok.headers['x-ratelimit-limit']).toBe('3');
      expect(ok.headers['x-ratelimit-remaining']).toBe(String(2 - i));
      expect(Number(ok.headers['x-ratelimit-reset'])).toBeGreaterThanOrEqual(1);
      expect(Number(ok.headers['x-ratelimit-reset'])).toBeLessThanOrEqual(60);
    }
    const over = await v1(r.body.key, '/facilities');
    expect(over.status).toBe(429);
    expect(over.headers['x-ratelimit-remaining']).toBe('0');
    // Retry-After: when the oldest request in the minute ages out, not a flat minute.
    expect(Number(over.headers['retry-after'])).toBeGreaterThanOrEqual(1);
    expect(Number(over.headers['retry-after'])).toBeLessThanOrEqual(60);
    expect(over.headers['retry-after']).toBe(over.headers['x-ratelimit-reset']);
    expect(over.body.code).toBe('RATE_LIMITED');
    // Another key isn't affected.
    expect((await v1(keyA, '/facilities')).status).toBe(200);
  });

  it('limits failed key checks per address: 20 in 10 minutes, then 429 before any lookup', async () => {
    const from = (ip: string, key: string) => request(server).get('/api/v1/facilities').set('X-Forwarded-For', ip).auth(key, { type: 'bearer' });
    const bad = `fh_live_abcdefgh_${'x'.repeat(43)}`;
    for (let i = 0; i < 20; i++) expect((await from('198.51.100.77', bad)).body.code).toBe('API_KEY_INVALID');
    const blocked = await from('198.51.100.77', bad);
    expect(blocked.status).toBe(429);
    expect(blocked.headers['retry-after']).toBe('600');
    // Even a real key from that address waits; other addresses are unaffected.
    expect((await from('198.51.100.77', keyA)).status).toBe(429);
    expect((await from('198.51.100.78', keyA)).status).toBe(200);
  });

  it('honours the IP allow list', async () => {
    const off = await as('hr').post('/api/integrations/api-keys', { name: 'Office only', scopes: ['facilities:read'], allowedIps: ['203.0.113.0/24'] });
    expect(off.body.apiKey.allowedIps).toEqual(['203.0.113.0/24']);
    expect((await v1(off.body.key, '/facilities')).body.code).toBe('IP_NOT_ALLOWED');
    const on = await as('hr').post('/api/integrations/api-keys', { name: 'Here', scopes: ['facilities:read'], allowedIps: ['127.0.0.1', '::1'] });
    expect((await v1(on.body.key, '/facilities')).status).toBe(200);
  });

  it('expired, revoked and rotated keys', async () => {
    const r = await as('hr').post('/api/integrations/api-keys', { name: 'Temp', scopes: ['facilities:read'] });
    await owner.apiKey.update({ where: { id: r.body.apiKey.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await v1(r.body.key, '/facilities')).body.code).toBe('API_KEY_EXPIRED');

    const k = await as('hr').post('/api/integrations/api-keys', { name: 'To rotate', scopes: ['facilities:read'] });
    const rot = await as('hr').post(`/api/integrations/api-keys/${k.body.apiKey.id}/rotate`);
    expect(rot.status).toBe(201);
    expect(rot.body.key).not.toBe(k.body.key);
    // The old one keeps working for a day; the new one works now.
    expect((await v1(k.body.key, '/facilities')).status).toBe(200);
    expect((await v1(rot.body.key, '/facilities')).status).toBe(200);
    const old = await owner.apiKey.findUniqueOrThrow({ where: { id: k.body.apiKey.id } });
    expect(old.expiresAt!.getTime()).toBeLessThanOrEqual(Date.now() + 24 * 3_600_000 + 1000);

    expect((await as('hr').del(`/api/integrations/api-keys/${rot.body.apiKey.id}`)).status).toBe(204);
    expect((await v1(rot.body.key, '/facilities')).body.code).toBe('API_KEY_REVOKED');
    // Another city can't revoke this city's key.
    expect((await as('hrB', B).del(`/api/integrations/api-keys/${k.body.apiKey.id}`)).status).toBe(404);
    expect(await owner.auditLog.count({ where: { tenantId: a.tenant.id, action: { in: ['api_key.rotate', 'api_key.revoke'] } } })).toBe(2);
  });

  it('a plan without the option: keys can’t be made, and existing ones stop answering', async () => {
    await owner.billingAccount.create({ data: { tenantId: b.tenant.id, legalName: 'Other', email: 'ap@other.test', province: 'BC', plan: 'MUNICIPAL', level: 'BUSINESS' } });
    forgetFeatures(b.tenant.id);
    try {
      expect((await as('hrB', B).post('/api/integrations/api-keys', { name: 'X', scopes: ['people:read'] })).body.code).toBe('PLAN_REQUIRED');
      expect((await as('hrB', B).get('/api/integrations')).body.inPlan).toBe(false);
      expect((await v1(keyB, '/people')).body.code).toBe('PLAN_REQUIRED');
    } finally {
      await owner.billingAccount.delete({ where: { tenantId: b.tenant.id } });
      forgetFeatures(b.tenant.id);
    }
    expect((await v1(keyB, '/people')).status).toBe(200);
  });
});

describe('webhooks', () => {
  let endpointId = '';
  let secret = '';
  beforeEach(() => {
    answer = 200;
    received.length = 0;
    process.env.WEBHOOK_LOCAL_TARGETS = 'on';
  });

  it('refuses addresses that aren’t https on the public internet', async () => {
    process.env.WEBHOOK_LOCAL_TARGETS = 'off';
    const bad = [
      'http://example.com/hook',
      'https://10.0.0.5/hook',
      'https://192.168.1.10/hook',
      'https://172.16.0.1/hook',
      'https://169.254.169.254/latest/meta-data',
      'https://127.0.0.1/hook',
      'https://[::1]/hook',
      'https://[fd00::1]/hook',
      'https://[::ffff:10.0.0.1]/hook',
      'https://100.64.0.1/hook',
      'https://0.0.0.0/hook',
      hookUrl,
      'https://user:pw@example.com/hook',
      'ftp://example.com/hook',
    ];
    for (const url of bad) {
      const r = await as('hr').post('/api/integrations/webhooks', { url, events: ['person.updated'] });
      expect([url, r.status]).toEqual([url, 400]);
    }
    expect(await owner.webhookEndpoint.count({ where: { tenantId: a.tenant.id } })).toBe(0);
  });

  it('HR adds an endpoint; the signing secret is shown once and sealed', async () => {
    const r = await as('hr').post('/api/integrations/webhooks', { url: hookUrl, description: 'Tempest', events: ['person.updated', 'person.created', 'shift.published', 'timeoff.approved'] });
    expect(r.status).toBe(201);
    secret = r.body.secret;
    endpointId = r.body.webhook.id;
    expect(secret).toMatch(/^whsec_/);
    const row = await owner.webhookEndpoint.findUniqueOrThrow({ where: { id: endpointId } });
    expect(JSON.stringify(row)).not.toContain(secret.slice(6));
    expect(JSON.stringify((await as('hr').get('/api/integrations')).body)).not.toContain(secret.slice(6));
  });

  it('“Send test event” signs with a timestamp; the signature catches tampering and replays', async () => {
    const r = await as('hr').post(`/api/integrations/webhooks/${endpointId}/test`);
    expect(r.body).toMatchObject({ status: 'SUCCEEDED', responseStatus: 200, eventType: 'ping', test: true });
    expect(received).toHaveLength(1);
    const { headers, body } = received[0]!;
    const sig = String(headers['fh-signature']);
    expect(sig).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
    expect(verifySignature(sig, body, secret)).toBe(true);
    expect(verifySignature(sig, body.replace('ping', 'pong'), secret)).toBe(false);
    expect(verifySignature(sig, body, 'whsec_wrong')).toBe(false);
    const t = Number(/t=(\d+)/.exec(sig)![1]);
    expect(verifySignature(sig, body, secret, { now: t + 3600 })).toBe(false);
    expect(JSON.parse(body)).toMatchObject({ type: 'ping', organization_id: a.tenant.id, id: headers['fh-event-id'] });
    // The delivery record keeps no secret.
    const d = await owner.webhookDelivery.findUniqueOrThrow({ where: { id: r.body.id } });
    expect(JSON.stringify(d)).not.toContain(secret.slice(6));
  });

  it('changes become events with ids and changed field names only; one delivery per event', async () => {
    await withTenant(a.tenant.id, (tx) => tx.user.update({ where: { id: a.users[0]!.id }, data: { firstName: 'Renamed', failedLoginCount: 2 } }), { prisma: appDb });
    // Not a public field: no event.
    await withTenant(a.tenant.id, (tx) => tx.user.update({ where: { id: a.users[1]!.id }, data: { failedLoginCount: 3 } }), { prisma: appDb });
    // Not subscribed: no delivery.
    await withTenant(a.tenant.id, (tx) => tx.timePunch.updateMany({ where: { userId: a.users[1]!.id }, data: { status: 'APPROVED' } }), { prisma: appDb });
    const draft = await owner.shift.findFirstOrThrow({ where: { tenantId: a.tenant.id, status: 'DRAFT' } });
    await withTenant(a.tenant.id, (tx) => tx.shift.update({ where: { id: draft.id }, data: { status: 'PUBLISHED' } }), { prisma: appDb });
    await dispatchTenant(a.tenant.id, { prisma: appDb });
    const queued = await owner.webhookDelivery.findMany({ where: { endpointId, test: false } });
    expect(queued.map((q) => q.eventType).sort()).toEqual(['person.updated', 'shift.published']);
    await deliverTenantWebhooks(a.tenant.id, { prisma: appDb });
    const bodies = received.map((r) => JSON.parse(r.body));
    expect(bodies.find((x) => x.type === 'person.updated').data).toEqual({ id: a.users[0]!.id, changed: ['first_name'] });
    expect(bodies.find((x) => x.type === 'shift.published').data).toEqual({ id: draft.id });
    expect(received.every((r) => verifySignature(String(r.headers['fh-signature']), r.body, secret))).toBe(true);
    expect(JSON.stringify(bodies)).not.toContain('Renamed');
    expect((await owner.webhookDelivery.findMany({ where: { endpointId, test: false } })).every((d) => d.status === 'SUCCEEDED')).toBe(true);

    // The outbox delivers at least once: the same event twice still queues one delivery.
    const again = await withTenant(a.tenant.id, (tx) => queueWebhookDeliveries(tx, { type: 'person.updated', tenantId: a.tenant.id, data: { id: a.users[0]!.id, changed: ['first_name'] } }, queued[0]!.eventId), { prisma: appDb });
    expect(again).toBe(0);
  });

  it('a city without webhooks records no events', async () => {
    const before = await owner.eventOutbox.count({ where: { tenantId: b.tenant.id } });
    await owner.user.update({ where: { id: b.users[0]!.id }, data: { firstName: 'Nobody listens' } });
    expect(await owner.eventOutbox.count({ where: { tenantId: b.tenant.id } })).toBe(before);
  });

  it('retries with backoff, gives up after the last try, and never follows redirects', async () => {
    answer = 500;
    const ev = await owner.webhookDelivery.create({ data: { tenantId: a.tenant.id, endpointId, eventId: crypto.randomUUID(), eventType: 'person.created', payload: { type: 'person.created' } } });
    await deliverTenantWebhooks(a.tenant.id, { prisma: appDb });
    let d = await owner.webhookDelivery.findUniqueOrThrow({ where: { id: ev.id } });
    expect(d).toMatchObject({ status: 'PENDING', attempts: 1, responseStatus: 500 });
    expect(d.responseBody!.length).toBe(500);
    expect(d.nextAttemptAt.getTime() - Date.now()).toBeGreaterThan(55_000);
    expect(d.nextAttemptAt.getTime() - Date.now()).toBeLessThan(65_000);
    // Not due yet: nothing is sent.
    received.length = 0;
    await deliverTenantWebhooks(a.tenant.id, { prisma: appDb });
    expect(received).toHaveLength(0);
    await owner.webhookDelivery.update({ where: { id: ev.id }, data: { nextAttemptAt: new Date(Date.now() - 1000) } });
    answer = 302;
    await deliverTenantWebhooks(a.tenant.id, { prisma: appDb });
    d = await owner.webhookDelivery.findUniqueOrThrow({ where: { id: ev.id } });
    expect(d).toMatchObject({ status: 'PENDING', attempts: 2, responseStatus: 302 });
    expect(d.error).toContain('redirects');
    expect(d.nextAttemptAt.getTime() - Date.now()).toBeGreaterThan(4 * 60_000);
    // The last try.
    await owner.webhookDelivery.update({ where: { id: ev.id }, data: { attempts: 7, nextAttemptAt: new Date(Date.now() - 1000) } });
    await deliverTenantWebhooks(a.tenant.id, { prisma: appDb });
    expect(await owner.webhookDelivery.findUniqueOrThrow({ where: { id: ev.id } })).toMatchObject({ status: 'FAILED', attempts: 8 });
    expect((await owner.webhookEndpoint.findUniqueOrThrow({ where: { id: endpointId } })).consecutiveFailures).toBe(3);
  });

  it('checks the address again when sending', async () => {
    process.env.WEBHOOK_LOCAL_TARGETS = 'off';
    const ev = await owner.webhookDelivery.create({ data: { tenantId: a.tenant.id, endpointId, eventId: crypto.randomUUID(), eventType: 'person.created', payload: { type: 'person.created' } } });
    await deliverTenantWebhooks(a.tenant.id, { prisma: appDb });
    expect(received).toHaveLength(0);
    const d = await owner.webhookDelivery.findUniqueOrThrow({ where: { id: ev.id } });
    expect(d.error).toMatch(/https|public internet/);
    await owner.webhookDelivery.update({ where: { id: ev.id }, data: { status: 'FAILED' } });
  });

  it('turns an endpoint off after too many failures in a row, and tells the administrators', async () => {
    answer = 503;
    await owner.webhookEndpoint.update({ where: { id: endpointId }, data: { consecutiveFailures: 19 } });
    const ev = await owner.webhookDelivery.create({ data: { tenantId: a.tenant.id, endpointId, eventId: crypto.randomUUID(), eventType: 'person.created', payload: { type: 'person.created' } } });
    const waiting = await owner.webhookDelivery.create({ data: { tenantId: a.tenant.id, endpointId, eventId: crypto.randomUUID(), eventType: 'person.created', payload: { type: 'person.created' }, nextAttemptAt: day(1) } });
    await deliverTenantWebhooks(a.tenant.id, { prisma: appDb });
    const ep = await owner.webhookEndpoint.findUniqueOrThrow({ where: { id: endpointId } });
    expect(ep).toMatchObject({ enabled: false, disabledReason: 'failures', consecutiveFailures: 20 });
    expect((await owner.webhookDelivery.findUniqueOrThrow({ where: { id: waiting.id } })).status).toBe('FAILED');
    expect(await owner.notification.count({ where: { userId: hrA, type: 'webhook_disabled' } })).toBe(1);
    expect(await owner.emailOutbox.count({ where: { tenantId: a.tenant.id, template: 'webhook_disabled' } })).toBe(1);
    expect(await owner.auditLog.count({ where: { tenantId: a.tenant.id, action: 'webhook.auto_disable' } })).toBe(1);
    // Turned off: changes no longer queue anything.
    const before = await owner.eventOutbox.count({ where: { tenantId: a.tenant.id } });
    await owner.user.update({ where: { id: a.users[0]!.id }, data: { lastName: 'Quiet' } });
    expect(await owner.eventOutbox.count({ where: { tenantId: a.tenant.id } })).toBe(before);

    // Redeliver once it's fixed: the same event id, sent now; then turn it back on.
    answer = 200;
    const re = await as('hr').post(`/api/integrations/deliveries/${ev.id}/redeliver`);
    expect(re.body).toMatchObject({ status: 'SUCCEEDED', redelivery: true, eventId: ev.eventId });
    expect(received.at(-1)!.headers['fh-event-id']).toBe(ev.eventId);
    const on = await as('hr').patch(`/api/integrations/webhooks/${endpointId}`, { enabled: true });
    expect(on.body).toMatchObject({ enabled: true, consecutiveFailures: 0, disabledReason: null });
  });

  it('lists recent deliveries for this city only; another city can’t redeliver or delete', async () => {
    const list = (await as('hr').get(`/api/integrations/deliveries?endpointId=${endpointId}`)).body;
    expect(list.length).toBeGreaterThan(3);
    expect(JSON.stringify(list)).not.toContain(secret.slice(6));
    expect((await as('hrB', B).get('/api/integrations/deliveries')).body).toEqual([]);
    expect((await as('hrB', B).post(`/api/integrations/deliveries/${list[0].id}/redeliver`)).status).toBe(404);
    expect((await as('hrB', B).del(`/api/integrations/webhooks/${endpointId}`)).status).toBe(404);
    expect((await as('hrB', B).post(`/api/integrations/webhooks/${endpointId}/test`)).status).toBe(404);
  });

  it('rotating the secret signs with both for a day', async () => {
    const r = await as('hr').post(`/api/integrations/webhooks/${endpointId}/rotate-secret`);
    expect(r.body.secret).toMatch(/^whsec_/);
    await as('hr').post(`/api/integrations/webhooks/${endpointId}/test`);
    const last = received.at(-1)!;
    const sig = String(last.headers['fh-signature']);
    expect(sig.split(',').filter((p) => p.startsWith('v1='))).toHaveLength(2);
    expect(verifySignature(sig, last.body, r.body.secret)).toBe(true);
    expect(verifySignature(sig, last.body, secret)).toBe(true);
  });

  it('deleting an endpoint removes its deliveries', async () => {
    expect((await as('hr').del(`/api/integrations/webhooks/${endpointId}`)).status).toBe(204);
    expect(await owner.webhookDelivery.count({ where: { endpointId } })).toBe(0);
  });
});
