import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { signAccessToken } from '../../src/auth/tokens.js';
import { forgetActive } from '../../src/services/people/customRoles.js';
import { applyRetention } from '../../src/services/privacy/retention.js';
import { withTenant } from '../../src/lib/db.js';
import { app as appDb, owner, seedTenant } from './fixtures.js';

const server = createApp();
const A = 'apiwrite';
const B = 'apiwriteb';
let a: Awaited<ReturnType<typeof seedTenant>>;
let b: Awaited<ReturnType<typeof seedTenant>>;
const tok: Record<string, string> = {};
let hrId = '';
let writeKey = '';
let writeKeyId = '';
let readKey = '';
let pendingOnlyKey = '';
let keyB = '';

const WRITE = ['people:read', 'people:write', 'departments:read', 'departments:write', 'positions:read', 'positions:write', 'timeoff:read', 'timeoff:write', 'timeoff:approve'];
const hr = (sub = A, who = 'hr') => ({
  post: (p: string, body: object = {}) => request(server).post(p).set('x-tenant-subdomain', sub).auth(tok[who]!, { type: 'bearer' }).send(body),
  get: (p: string) => request(server).get(p).set('x-tenant-subdomain', sub).auth(tok[who]!, { type: 'bearer' }),
});
const v1 = (key: string) => ({
  get: (p: string) => request(server).get(`/api/v1${p}`).auth(key, { type: 'bearer' }),
  post: (p: string, body?: object, idem: string | null = randomUUID()) => {
    const r = request(server).post(`/api/v1${p}`).auth(key, { type: 'bearer' });
    if (idem) r.set('Idempotency-Key', idem);
    return body === undefined ? r : r.send(body);
  },
  patch: (p: string, body: object, etag?: string) => {
    const r = request(server).patch(`/api/v1${p}`).auth(key, { type: 'bearer' });
    if (etag) r.set('If-Match', etag);
    return r.send(body);
  },
  put: (p: string, body: object, etag?: string) => {
    const r = request(server).put(`/api/v1${p}`).auth(key, { type: 'bearer' });
    if (etag) r.set('If-Match', etag);
    return r.send(body);
  },
  del: (p: string) => request(server).delete(`/api/v1${p}`).auth(key, { type: 'bearer' }),
});
const day = (n: number) => new Date(Date.now() + n * 86_400_000);
const at9 = (n: number) => {
  const d = day(n);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 16)).toISOString();
};
const outbox = (type: string) => owner.eventOutbox.findMany({ where: { tenantId: a.tenant.id, type } });

beforeAll(async () => {
  a = await seedTenant(A, 2);
  b = await seedTenant(B, 1);
  const now = Math.floor(Date.now() / 1000);
  // HR who also approves time off (so the key can be given timeoff:approve).
  const u = await owner.user.create({ data: { tenantId: a.tenant.id, roles: ['HR_ADMIN', 'AQUATIC_SUPERVISOR'], employmentStatus: 'FULL_TIME', firstName: 'Hana', lastName: 'Admin', email: `hr@${A}.test` } });
  hrId = u.id;
  tok.hr = await signAccessToken({ sub: u.id, tid: a.tenant.id, roles: ['HR_ADMIN', 'AQUATIC_SUPERVISOR'], aat: now });
  const plainHr = await owner.user.create({ data: { tenantId: a.tenant.id, roles: ['HR_ADMIN'], employmentStatus: 'FULL_TIME', firstName: 'Paul', lastName: 'Admin', email: `hr2@${A}.test` } });
  tok.plainHr = await signAccessToken({ sub: plainHr.id, tid: a.tenant.id, roles: ['HR_ADMIN'], aat: now });
  const hrB = await owner.user.create({ data: { tenantId: b.tenant.id, roles: ['HR_ADMIN'], employmentStatus: 'FULL_TIME', firstName: 'Bo', lastName: 'Admin', email: `hr@${B}.test` } });
  tok.hrB = await signAccessToken({ sub: hrB.id, tid: b.tenant.id, roles: ['HR_ADMIN'], aat: now });
  // A webhook endpoint that wants people and time-off events (so the database records them).
  await owner.webhookEndpoint.create({ data: { tenantId: a.tenant.id, url: 'https://hooks.example.com/fh', events: ['person.created', 'person.updated', 'timeoff.approved', 'timeoff.cancelled'], secret: { c: 'x' }, createdById: u.id } });
});
afterAll(async () => {
  await appDb.$disconnect();
  await owner.$disconnect();
});

describe('write scopes on keys (Settings › Integrations)', () => {
  it('lists write scopes as such; a key with one is marked write; read-only stays the default', async () => {
    const view = (await hr().get('/api/integrations')).body;
    const scopes = Object.fromEntries(view.scopes.map((s: { scope: string; write: boolean; allowed: boolean }) => [s.scope, s]));
    expect(scopes['people:read']).toMatchObject({ write: false, allowed: true });
    expect(scopes['people:write']).toMatchObject({ write: true, allowed: true });
    expect(scopes['timeoff:approve']).toMatchObject({ write: true, allowed: true });
    const r = await hr().post('/api/integrations/api-keys', { name: 'Payroll sync', scopes: WRITE });
    expect(r.status).toBe(201);
    expect(r.body.apiKey.write).toBe(true);
    writeKey = r.body.key;
    writeKeyId = r.body.apiKey.id;
    const ro = await hr().post('/api/integrations/api-keys', { name: 'GIS', scopes: ['people:read', 'timeoff:read'] });
    expect(ro.body.apiKey.write).toBe(false);
    readKey = ro.body.key;
    keyB = (await hr(B, 'hrB').post('/api/integrations/api-keys', { name: 'Other city', scopes: ['people:read', 'people:write', 'timeoff:write', 'positions:write'] })).body.key;
    expect(keyB).toBeTruthy();
  });

  it('only someone holding the permission can give a write scope', async () => {
    // Plain HR can't approve time off, so can't give timeoff:approve.
    const r = await hr(A, 'plainHr').post('/api/integrations/api-keys', { name: 'Leave approvals', scopes: ['timeoff:approve'] });
    expect(r.status).toBe(403);
    expect(r.body).toMatchObject({ code: 'SCOPE_NOT_YOURS', details: { scopes: ['timeoff:approve'] } });
    expect((await hr(A, 'plainHr').get('/api/integrations')).body.scopes.find((s: { scope: string }) => s.scope === 'timeoff:approve').allowed).toBe(false);
    pendingOnlyKey = (await hr(A, 'plainHr').post('/api/integrations/api-keys', { name: 'HRIS leave', scopes: ['timeoff:write', 'timeoff:read'] })).body.key;
    expect(pendingOnlyKey).toBeTruthy();
  });
});

describe('people', () => {
  let personId = '';
  let etag = '';

  it('adds a person: 201, Location, ETag, invited, audited as the key, webhook event recorded', async () => {
    const r = await v1(writeKey).post('/people', { first_name: 'Ada', last_name: 'Lovelace', preferred_name: 'Addie', email: 'ADA@apiwrite.test', employment_status: 'part_time', hire_date: '2026-05-01', employee_number: 'P-100', external_id: 'hris-100', position_ids: [a.position.id], phone: '250-555-0100' });
    expect(r.status).toBe(201);
    personId = r.body.id;
    expect(r.headers.location).toBe(`/api/v1/people/${personId}`);
    expect(r.headers.etag).toMatch(/^"[0-9a-z]+"$/);
    expect(r.body).toMatchObject({ first_name: 'Ada', preferred_name: 'Addie', email: 'ada@apiwrite.test', employee_number: 'P-100', external_id: 'hris-100', status: 'active', employment_status: 'part_time', hire_date: '2026-05-01', positions: [{ id: a.position.id }] });
    expect(JSON.stringify(r.body)).not.toContain('250-555-0100');
    const u = await owner.user.findUniqueOrThrow({ where: { id: personId } });
    expect(u).toMatchObject({ tenantId: a.tenant.id, roles: ['EMPLOYEE'], phone: '250-555-0100', passwordHash: null });
    expect(await owner.emailOutbox.count({ where: { tenantId: a.tenant.id, toEmail: 'ada@apiwrite.test', template: 'invite' } })).toBe(1);
    const log = await owner.auditLog.findFirstOrThrow({ where: { tenantId: a.tenant.id, action: 'user.create', entityId: personId } });
    expect(log).toMatchObject({ actorId: null, apiKeyId: writeKeyId });
    expect(log.after).toMatchObject({ actor: 'API key Payroll sync', email: 'ada@apiwrite.test' });
    expect((await outbox('person.created')).map((e) => (e.payload as { data: { id: string } }).data.id)).toContain(personId);
    const got = await v1(writeKey).get(`/people/${personId}`);
    expect(got.headers.etag).toBe(r.headers.etag);
    etag = r.headers.etag!;
  });

  it('a record without sign-in: invite false sends nothing', async () => {
    const r = await v1(writeKey).post('/people', { first_name: 'No', last_name: 'Login', email: 'nologin@apiwrite.test', employment_status: 'casual', invite: false });
    expect(r.status).toBe(201);
    expect(await owner.emailOutbox.count({ where: { toEmail: 'nologin@apiwrite.test' } })).toBe(0);
  });

  it('needs the write scope (403, problem details with the request id)', async () => {
    const r = await v1(readKey).post('/people', { first_name: 'X', last_name: 'Y', email: 'x@apiwrite.test', employment_status: 'casual' });
    expect(r.status).toBe(403);
    expect(r.headers['content-type']).toContain('application/problem+json');
    expect(r.body).toMatchObject({ type: 'about:blank', title: 'Forbidden', status: 403, code: 'INSUFFICIENT_SCOPE', details: { scope: 'people:write' } });
    expect(r.body.request_id).toBe(r.headers['x-request-id']);
    expect((await v1(readKey).patch(`/people/${personId}`, { first_name: 'X' })).status).toBe(403);
  });

  it('POST needs an Idempotency-Key', async () => {
    const r = await v1(writeKey).post('/people', { first_name: 'X', last_name: 'Y', email: 'nokey@apiwrite.test', employment_status: 'casual' }, null);
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
    expect(await owner.user.count({ where: { email: 'nokey@apiwrite.test' } })).toBe(0);
  });

  it('validation is 422 with field errors; sensitive fields are refused and nothing is written', async () => {
    const r = await v1(writeKey).post('/people', { first_name: 'X', last_name: 'Y', employment_status: 'sometimes', surprise: 1 });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('VALIDATION');
    const fields = r.body.errors.map((e: { field: string }) => e.field);
    expect(fields).toEqual(expect.arrayContaining(['email', 'employment_status', 'surprise']));
    for (const field of ['sin', 'date_of_birth', 'bank_account', 'medical', 'pay_rate', 'roles']) {
      const s = await v1(writeKey).post('/people', { first_name: 'X', last_name: 'Y', email: `s-${field}@apiwrite.test`, employment_status: 'casual', [field]: field === 'roles' ? ['HR_ADMIN'] : '046 454 286' });
      expect([field, s.status]).toEqual([field, 422]);
      expect(s.body.errors).toEqual([expect.objectContaining({ field, code: 'not_writable' })]);
    }
    const p = await v1(writeKey).patch(`/people/${personId}`, { sin: '046454286' });
    expect(p.status).toBe(422);
    expect(await owner.user.count({ where: { email: { startsWith: 's-' }, tenantId: a.tenant.id } })).toBe(0);
    // Business rules too: an email someone already uses.
    const dup = await v1(writeKey).post('/people', { first_name: 'Two', last_name: 'Ada', email: 'ada@apiwrite.test', employment_status: 'casual' });
    expect(dup.status).toBe(409);
    expect(dup.body).toMatchObject({ code: 'EMAIL_TAKEN', errors: [{ field: 'email' }] });
  });

  it('idempotency: a retry gets the same answer; the same key with another body is refused', async () => {
    const key = randomUUID();
    const body = { first_name: 'Grace', last_name: 'Hopper', email: 'grace@apiwrite.test', employment_status: 'full_time' };
    const first = await v1(writeKey).post('/people', body, key);
    expect(first.status).toBe(201);
    const again = await v1(writeKey).post('/people', { employment_status: 'full_time', email: 'grace@apiwrite.test', last_name: 'Hopper', first_name: 'Grace' }, key);
    expect(again.status).toBe(201);
    expect(again.headers['idempotent-replayed']).toBe('true');
    expect(again.body).toEqual(first.body);
    expect(again.headers.etag).toBe(first.headers.etag);
    expect(await owner.user.count({ where: { email: 'grace@apiwrite.test' } })).toBe(1);
    expect(await owner.emailOutbox.count({ where: { toEmail: 'grace@apiwrite.test' } })).toBe(1);
    const other = await v1(writeKey).post('/people', { ...body, first_name: 'Gracie' }, key);
    expect(other.status).toBe(409);
    expect(other.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
    // A refusal is replayed too.
    const k2 = randomUUID();
    const bad = await v1(writeKey).post('/people', { first_name: 'Bad' }, k2);
    expect(bad.status).toBe(422);
    expect((await v1(writeKey).post('/people', { first_name: 'Bad' }, k2)).body.errors).toEqual(bad.body.errors);
    // Keys are per API key: another key can use the same value.
    const row = await owner.apiIdempotencyKey.findFirstOrThrow({ where: { key } });
    expect(row).toMatchObject({ tenantId: a.tenant.id, apiKeyId: writeKeyId, status: 201 });
    expect(row.expiresAt.getTime() - Date.now()).toBeGreaterThan(23 * 3_600_000);
  });

  it('idempotency keys are removed after 24 hours', async () => {
    const row = await owner.apiIdempotencyKey.findFirstOrThrow({ where: { tenantId: a.tenant.id } });
    await owner.apiIdempotencyKey.update({ where: { id: row.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await withTenant(a.tenant.id, (tx) => applyRetention(tx), { prisma: appDb });
    expect(await owner.apiIdempotencyKey.count({ where: { id: row.id } })).toBe(0);
  });

  it('PATCH changes only what is sent; If-Match with an old ETag is 412', async () => {
    const r = await v1(writeKey).patch(`/people/${personId}`, { last_name: 'King', preferred_name: null, employment_status: 'full_time' }, etag);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ first_name: 'Ada', last_name: 'King', preferred_name: null, employment_status: 'full_time', email: 'ada@apiwrite.test' });
    expect(r.headers.etag).not.toBe(etag);
    const stale = await v1(writeKey).patch(`/people/${personId}`, { first_name: 'Augusta' }, etag);
    expect(stale.status).toBe(412);
    expect(stale.body).toMatchObject({ code: 'PRECONDITION_FAILED', details: { etag: r.headers.etag } });
    expect((await owner.user.findUniqueOrThrow({ where: { id: personId } })).firstName).toBe('Ada');
    // Without If-Match, the change is made.
    const free = await v1(writeKey).patch(`/people/${personId}`, { first_name: 'Augusta' });
    expect(free.body.first_name).toBe('Augusta');
    etag = free.headers.etag!;
    // An empty change is refused.
    expect((await v1(writeKey).patch(`/people/${personId}`, {})).status).toBe(422);
  });

  it('changes positions and manager with the app’s rules; a new email tells the old address', async () => {
    const lead = await owner.user.create({ data: { tenantId: a.tenant.id, roles: ['AQUATIC_SUPERVISOR'], employmentStatus: 'FULL_TIME', firstName: 'Lea', lastName: 'Lead', email: `lead@${A}.test` } });
    const r = await v1(writeKey).patch(`/people/${personId}`, { manager_id: lead.id, position_ids: [], email: 'ada.king@apiwrite.test' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ manager_id: lead.id, positions: [], email: 'ada.king@apiwrite.test' });
    expect(await owner.emailOutbox.count({ where: { toEmail: 'ada@apiwrite.test', template: 'email_changed' } })).toBe(1);
    // Nobody reports to themselves.
    expect((await v1(writeKey).patch(`/people/${personId}`, { manager_id: personId })).body.code).toBe('MANAGER_SELF');
    const ev = (await outbox('person.updated')).map((e) => (e.payload as { data: { id: string; changed: string[] } }).data).filter((d) => d.id === personId);
    expect(ev.flatMap((d) => d.changed)).toEqual(expect.arrayContaining(['last_name', 'manager_id', 'positions', 'email']));
  });

  it('another organization’s records can’t be reached or linked', async () => {
    expect((await v1(keyB).patch(`/people/${personId}`, { first_name: 'Mallory' })).status).toBe(404);
    expect((await v1(keyB).post(`/people/${personId}/terminate`, { last_day: '2026-12-31', reason: 'other' })).status).toBe(404);
    const p = await v1(writeKey).patch(`/people/${personId}`, { position_ids: [b.position.id] });
    expect(p.status).toBe(422);
    expect(p.body).toMatchObject({ code: 'UNKNOWN_POSITION', errors: [{ field: 'position_ids' }] });
    expect((await v1(writeKey).patch(`/people/${personId}`, { manager_id: b.users[0]!.id })).status).toBe(404);
    expect((await v1(keyB).post('/time-off', { person_id: a.users[0]!.id, type: 'vacation', starts_at: at9(30), ends_at: at9(31) })).status).toBe(404);
    // A person made with another city's key lands in that city only.
    const made = await v1(keyB).post('/people', { first_name: 'Bea', last_name: 'B', email: 'ada.king@apiwrite.test', employment_status: 'casual' });
    expect(made.status).toBe(201);
    expect((await owner.user.findUniqueOrThrow({ where: { id: made.body.id } })).tenantId).toBe(b.tenant.id);
    expect((await v1(writeKey).get(`/people/${made.body.id}`)).status).toBe(404);
  });

  it('upserts by external id: creates, then changes the same person', async () => {
    const first = await v1(writeKey).put('/people/by-external-id/EMP-42', { first_name: 'Ken', last_name: 'Thompson', email: 'ken@apiwrite.test', employment_status: 'casual', invite: false });
    expect(first.status).toBe(201);
    expect(first.body.external_id).toBe('EMP-42');
    const second = await v1(writeKey).put('/people/by-external-id/EMP-42', { employment_status: 'part_time' }, first.headers.etag);
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ id: first.body.id, employment_status: 'part_time', first_name: 'Ken' });
    expect((await v1(writeKey).put('/people/by-external-id/EMP-42', { first_name: 'Kenneth' }, first.headers.etag)).status).toBe(412);
    // Creating needs the required fields.
    const missing = await v1(writeKey).put('/people/by-external-id/EMP-43', { first_name: 'Only' });
    expect(missing.status).toBe(422);
    expect((await v1(writeKey).put('/people/by-external-id/bad%20id', { first_name: 'X' })).status).toBe(422);
    // External ids are unique in the organization.
    const taken = await v1(writeKey).patch(`/people/${personId}`, { external_id: 'EMP-42' });
    expect(taken.status).toBe(409);
    expect(taken.body).toMatchObject({ code: 'EXTERNAL_ID_TAKEN', errors: [{ field: 'external_id' }] });
    // The same external id in another city is another person.
    expect((await v1(keyB).put('/people/by-external-id/EMP-42', { first_name: 'Ken', last_name: 'B', email: 'ken@apiwriteb.test', employment_status: 'casual', invite: false })).status).toBe(201);
  });

  it('terminating starts offboarding with the last day; nothing is deleted; once only', async () => {
    const r = await v1(writeKey).post(`/people/${personId}/terminate`, { last_day: '2026-12-31', reason: 'resignation' });
    expect(r.status).toBe(200);
    expect(r.body.offboarding).toMatchObject({ last_day: '2026-12-31', reason: 'resignation', completed: false });
    const o = await owner.offboarding.findUniqueOrThrow({ where: { userId: personId } });
    expect(o.lastDay.toISOString().slice(0, 10)).toBe('2026-12-31');
    expect(await owner.user.count({ where: { id: personId } })).toBe(1);
    const again = await v1(writeKey).post(`/people/${personId}/terminate`, { last_day: '2026-12-31', reason: 'resignation' });
    expect(again.body.code).toBe('ALREADY_OFFBOARDING');
    expect((await v1(writeKey).post(`/people/${personId}/terminate`, { last_day: '2026-12-31', reason: 'fired' })).status).toBe(422);
    expect((await owner.auditLog.findFirstOrThrow({ where: { action: 'offboarding.start', entityId: personId } })).apiKeyId).toBe(writeKeyId);
    // There's no delete.
    expect((await v1(writeKey).del(`/people/${personId}`)).status).toBe(404);
  });

  it('stops changing data when its maker loses the permission', async () => {
    await owner.user.update({ where: { id: hrId }, data: { roles: ['STAFF'] } });
    try {
      const r = await v1(writeKey).patch(`/people/${a.users[0]!.id}`, { first_name: 'Nope' });
      expect(r.status).toBe(403);
      expect(r.body.code).toBe('KEY_OWNER_LACKS_PERMISSION');
      // Reading still works (read scopes follow the existing rules).
      expect((await v1(writeKey).get(`/people/${a.users[0]!.id}`)).status).toBe(200);
      await owner.user.update({ where: { id: hrId }, data: { roles: ['HR_ADMIN', 'AQUATIC_SUPERVISOR'], status: 'TERMINATED' } });
      forgetActive(hrId);
      expect((await v1(writeKey).patch(`/people/${a.users[0]!.id}`, { first_name: 'Nope' })).body.code).toBe('KEY_OWNER_INACTIVE');
    } finally {
      await owner.user.update({ where: { id: hrId }, data: { roles: ['HR_ADMIN', 'AQUATIC_SUPERVISOR'], status: 'ACTIVE' } });
      forgetActive(hrId);
    }
    expect((await v1(writeKey).patch(`/people/${a.users[0]!.id}`, { preferred_name: 'G' })).status).toBe(200);
  });
});

describe('time off', () => {
  let requestId = '';

  it('requests time off for someone: pending by default, audited, no note returned', async () => {
    const r = await v1(writeKey).post('/time-off', { person_id: a.users[0]!.id, type: 'vacation', starts_at: at9(20), ends_at: at9(22), note: 'family trip' });
    expect(r.status).toBe(201);
    requestId = r.body.id;
    expect(r.body).toMatchObject({ person_id: a.users[0]!.id, type: 'vacation', status: 'pending', approved_at: null });
    expect(JSON.stringify(r.body)).not.toContain('family');
    expect(r.headers.location).toBe(`/api/v1/time-off/${requestId}`);
    expect((await owner.auditLog.findFirstOrThrow({ where: { action: 'timeoff.request', entityId: requestId } })).apiKeyId).toBe(writeKeyId);
    expect((await v1(readKey).get(`/time-off/${requestId}`)).body.status).toBe('pending');
    // Pending isn't in the approved list.
    expect((await v1(readKey).get('/time-off')).body.data.map((x: { id: string }) => x.id)).not.toContain(requestId);
  });

  it('the app’s rules: no overlap, ends after it starts, a real type', async () => {
    const overlap = await v1(writeKey).post('/time-off', { person_id: a.users[0]!.id, type: 'sick', starts_at: at9(21), ends_at: at9(23) });
    expect(overlap.status).toBe(409);
    expect(overlap.body.code).toBe('TIME_OFF_OVERLAPS');
    const backwards = await v1(writeKey).post('/time-off', { person_id: a.users[0]!.id, type: 'sick', starts_at: at9(41), ends_at: at9(40) });
    expect(backwards.status).toBe(422);
    expect((await v1(writeKey).post('/time-off', { person_id: a.users[0]!.id, type: 'holiday', starts_at: at9(50), ends_at: at9(51) })).status).toBe(422);
  });

  it('pre-approved only with timeoff:approve, from a maker who approves time off', async () => {
    const no = await v1(pendingOnlyKey).post('/time-off', { person_id: a.users[1]!.id, type: 'vacation', starts_at: at9(60), ends_at: at9(61), status: 'approved' });
    expect(no.status).toBe(403);
    expect(no.body).toMatchObject({ code: 'INSUFFICIENT_SCOPE', details: { scope: 'timeoff:approve' } });
    const ok = await v1(writeKey).post('/time-off', { person_id: a.users[1]!.id, type: 'vacation', starts_at: at9(60), ends_at: at9(61), status: 'approved' });
    expect(ok.status).toBe(201);
    expect(ok.body.status).toBe('approved');
    expect(ok.body.hours).toBe('8.00');
    const row = await owner.timeOffRequest.findUniqueOrThrow({ where: { id: ok.body.id } });
    expect(row.decidedById).toBe(hrId);
    expect((await owner.auditLog.findFirstOrThrow({ where: { action: 'timeoff.approve', entityId: ok.body.id } })).apiKeyId).toBe(writeKeyId);
    expect((await outbox('timeoff.approved')).map((e) => (e.payload as { data: { id: string } }).data.id)).toContain(ok.body.id);
    // The person is told, as when a manager approves (through the outbox).
    const told = (await outbox('notify')).map((n) => JSON.stringify(n.payload));
    expect(told.some((p) => p.includes('time_off_decided') && p.includes(a.users[1]!.id))).toBe(true);
    expect(told.some((p) => p.includes('time_off_requested') && p.includes(ok.body.id))).toBe(false);
    // Cancelling an approved request that hasn't started: the webhook tells the payroll system.
    const c = await v1(writeKey).post(`/time-off/${ok.body.id}/cancel`);
    expect(c.status).toBe(200);
    expect(c.body.status).toBe('cancelled');
    expect((await outbox('timeoff.cancelled')).map((e) => (e.payload as { data: { id: string } }).data.id)).toContain(ok.body.id);
    expect((await v1(writeKey).post(`/time-off/${ok.body.id}/cancel`)).body.code).toBe('NOT_ACTIVE');
  });

  it('cancels a pending request; another city can’t', async () => {
    expect((await v1(keyB).post(`/time-off/${requestId}/cancel`)).status).toBe(404);
    const r = await v1(writeKey).post(`/time-off/${requestId}/cancel`);
    expect(r.body.status).toBe('cancelled');
    expect((await owner.auditLog.findFirstOrThrow({ where: { action: 'timeoff.cancel', entityId: requestId } })).apiKeyId).toBe(writeKeyId);
  });
});

describe('departments and positions', () => {
  let deptId = '';
  let posId = '';

  it('adds and changes a department; names unique; If-Match; upsert by external id; no delete', async () => {
    const r = await v1(writeKey).post('/departments', { name: 'Water Works', name_fr: 'Eaux', external_id: 'D-10' });
    expect(r.status).toBe(201);
    deptId = r.body.id;
    expect(r.body).toMatchObject({ name: 'Water Works', name_fr: 'Eaux', external_id: 'D-10', manager_ids: [] });
    expect((await owner.auditLog.findFirstOrThrow({ where: { action: 'department.create', entityId: deptId } })).apiKeyId).toBe(writeKeyId);
    const dup = await v1(writeKey).post('/departments', { name: 'water works' });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('DEPARTMENT_EXISTS');
    const etag = (await v1(writeKey).get(`/departments/${deptId}`)).headers.etag;
    const ch = await v1(writeKey).patch(`/departments/${deptId}`, { name: 'Water Utility' }, etag);
    expect(ch.body).toMatchObject({ name: 'Water Utility', name_fr: 'Eaux' });
    expect((await v1(writeKey).patch(`/departments/${deptId}`, { name: 'Old' }, etag)).status).toBe(412);
    const up = await v1(writeKey).put('/departments/by-external-id/D-10', { name_fr: 'Services d’eau' });
    expect(up.status).toBe(200);
    expect(up.body).toMatchObject({ id: deptId, name: 'Water Utility', name_fr: 'Services d’eau' });
    const made = await v1(writeKey).put('/departments/by-external-id/D-11', { name: 'Parks' });
    expect(made.status).toBe(201);
    expect((await v1(writeKey).put('/departments/by-external-id/D-12', { name_fr: 'Sans nom' })).status).toBe(422);
    expect((await v1(writeKey).del(`/departments/${deptId}`)).status).toBe(404);
    expect(await owner.department.count({ where: { id: deptId } })).toBe(1);
  });

  it('adds a position in a department, moves it, upserts it; another city’s department is unknown', async () => {
    const r = await v1(writeKey).post('/positions', { name: 'Operator', department_id: deptId, external_id: 'P-1' });
    expect(r.status).toBe(201);
    posId = r.body.id;
    expect(r.body).toMatchObject({ name: 'Operator', department_id: deptId, external_id: 'P-1' });
    const other = await owner.department.create({ data: { tenantId: b.tenant.id, name: 'Elsewhere' } });
    const bad = await v1(writeKey).patch(`/positions/${posId}`, { department_id: other.id });
    expect(bad.status).toBe(422);
    expect(bad.body.code).toBe('UNKNOWN_DEPARTMENT');
    const moved = await v1(writeKey).patch(`/positions/${posId}`, { department_id: null, name_fr: 'Opérateur' });
    expect(moved.body).toMatchObject({ department_id: null, name_fr: 'Opérateur' });
    expect((await v1(writeKey).post('/positions', { name: 'lifeguard' })).body.code).toBe('POSITION_EXISTS');
    const up = await v1(writeKey).put('/positions/by-external-id/P-1', { department_id: deptId });
    expect(up.body).toMatchObject({ id: posId, department_id: deptId });
    expect((await v1(keyB).patch(`/positions/${posId}`, { name: 'Mine' })).status).toBe(404);
    expect((await owner.auditLog.findFirstOrThrow({ where: { action: 'position.update', entityId: posId } })).apiKeyId).toBe(writeKeyId);
    // Certification requirements set in the app stay as they are.
    await owner.positionCertRequirement.create({ data: { tenantId: a.tenant.id, positionId: posId, certificationId: a.nls.id } });
    await v1(writeKey).patch(`/positions/${posId}`, { name: 'Operator II' });
    expect(await owner.positionCertRequirement.count({ where: { positionId: posId } })).toBe(1);
  });

  it('needs the scope', async () => {
    expect((await v1(readKey).post('/departments', { name: 'X' })).status).toBe(403);
    expect((await v1(keyB).post('/departments', { name: 'X' })).body.code).toBe('INSUFFICIENT_SCOPE');
  });
});

describe('limits', () => {
  it('writes have their own per-key limit', async () => {
    const r = await hr().post('/api/integrations/api-keys', { name: 'Burst', scopes: ['departments:write'] });
    await owner.apiKey.update({ where: { id: r.body.apiKey.id }, data: { rateLimitPerMinute: 2 } });
    expect((await v1(r.body.key).post('/departments', { name: 'Burst one' })).status).toBe(201);
    expect((await v1(r.body.key).post('/departments', { name: 'Burst two' })).status).toBe(201);
    const over = await v1(r.body.key).post('/departments', { name: 'Burst three' });
    expect(over.status).toBe(429);
    expect(over.body.code).toBe('RATE_LIMITED');
  });

  it('a body that isn’t JSON is refused', async () => {
    const r = await request(server).post('/api/v1/departments').auth(writeKey, { type: 'bearer' }).set('Idempotency-Key', randomUUID()).set('Content-Type', 'application/json').send('{"name":');
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('BAD_JSON');
    const form = await request(server).post('/api/v1/departments').auth(writeKey, { type: 'bearer' }).set('Idempotency-Key', randomUUID()).type('form').send('name=Forms');
    expect(form.status).toBe(415);
  });
});
