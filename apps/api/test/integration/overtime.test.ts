import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { resetLimits } from '../../src/auth/rateLimit.js';
import { signAccessToken } from '../../src/auth/tokens.js';
import { app as appDb, owner, seedTenant } from './fixtures.js';

const server = createApp();
const SUB = 'otfair';
let t: Awaited<ReturnType<typeof seedTenant>>;
let sup: string;
let steward: string;
let guard: string;
let shiftId: string;
const [A, B, C] = [0, 1, 2];
const id = (i: number) => t.users[i]!.id;
const call = (token: string) => {
  const w = (r: request.Test) => r.auth(token, { type: 'bearer' }).set('x-tenant-subdomain', SUB);
  return { get: (p: string) => w(request(server).get(p)), post: (p: string, b: object = {}) => w(request(server).post(p)).send(b), put: (p: string, b: object) => w(request(server).put(p)).send(b) };
};

beforeAll(async () => {
  resetLimits();
  t = await seedTenant(SUB, 3);
  // A is most senior, C least.
  for (const [i, d] of [[A, '2010-05-01'], [B, '2015-05-01'], [C, '2020-05-01']] as const) await owner.user.update({ where: { id: id(i) }, data: { seniorityDate: new Date(`${d}T00:00:00Z`) } });
  const s = await owner.user.create({ data: { tenantId: t.tenant.id, roles: ['AQUATIC_SUPERVISOR'], employmentStatus: 'FULL_TIME', firstName: 'S', lastName: 'V', email: 'sup@otfair.test' } });
  const st = await owner.user.create({ data: { tenantId: t.tenant.id, roles: ['UNION_STEWARD'], employmentStatus: 'FULL_TIME', firstName: 'U', lastName: 'S', email: 'steward@otfair.test' } });
  sup = await signAccessToken({ sub: s.id, tid: t.tenant.id, roles: ['AQUATIC_SUPERVISOR'] });
  steward = await signAccessToken({ sub: st.id, tid: t.tenant.id, roles: ['UNION_STEWARD'] });
  guard = await signAccessToken({ sub: id(A), tid: t.tenant.id, roles: ['STAFF'] });
  // A 10-hour shift: 2 hours of daily overtime in BC for anyone.
  // 8 a.m. Vancouver, four days out, so the whole shift falls on one local day whatever time the test runs.
  const day = new Date(Date.now() + 4 * 86_400_000);
  const start = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 16));
  const shift = await owner.shift.create({ data: { tenantId: t.tenant.id, facilityId: t.facility.id, positionId: t.position.id, startsAt: start, endsAt: new Date(start.getTime() + 10 * 3_600_000), status: 'PUBLISHED' } });
  shiftId = shift.id;
});
afterAll(async () => {
  await appDb.$disconnect();
  await owner.$disconnect();
});

describe('overtime equalization', () => {
  it('ranks by charged hours, then seniority; refusals are charged by default', async () => {
    await call(sup).post('/api/overtime/entries', { userId: id(A), positionId: t.position.id, kind: 'ACCEPTED', hours: '6', occurredAt: new Date().toISOString() });
    await call(sup).post('/api/overtime/entries', { userId: id(B), positionId: t.position.id, kind: 'REFUSED', hours: '4', occurredAt: new Date().toISOString(), note: 'Called 7:10 a.m., declined' });
    const r = await call(sup).get(`/api/overtime/standings?positionId=${t.position.id}`);
    expect(r.body.rows.map((x: { userId: string }) => x.userId)).toEqual([id(C), id(B), id(A)]);
    expect(r.body.rows.find((x: { userId: string }) => x.userId === id(B))).toMatchObject({ chargedHours: 4, refusals: 1 });
  });

  it('the city can choose not to charge refusals', async () => {
    await call(sup).put('/api/overtime/policy', { countRefusals: false, clause: 'Article 12.3', periodStartMonth: 1 });
    const r = await call(sup).get(`/api/overtime/standings?positionId=${t.position.id}`);
    // B (0 charged, 2015) now ties C (0, 2020) and wins on seniority.
    expect(r.body.rows.map((x: { userId: string }) => x.userId)).toEqual([id(B), id(C), id(A)]);
  });

  it('warns before overtime goes out of order, naming who would be skipped and the clause', async () => {
    const check = await call(sup).get(`/api/overtime/check?shiftId=${shiftId}&userId=${id(A)}`);
    expect(check.body.overtime).toBe(true);
    expect(check.body.skipped.map((s: { userId: string }) => s.userId)).toEqual([id(B), id(C)]);
    expect(check.body.clause).toBe('Article 12.3');
    const assign = await call(sup).post(`/api/shifts/${shiftId}/assign`, { userId: id(A), expectedVersion: 0 });
    expect(assign.status).toBe(409);
    expect(assign.body.details.skipped).toHaveLength(2);
  });

  it('assigning overtime charges the hours to the person', async () => {
    const ok = await call(sup).post(`/api/shifts/${shiftId}/assign`, { userId: id(B), expectedVersion: 0, acknowledgeOvertime: true });
    expect(ok.status).toBe(200);
    const r = await call(sup).get(`/api/overtime/standings?positionId=${t.position.id}`);
    expect(r.body.rows.find((x: { userId: string }) => x.userId === id(B)).acceptedHours).toBeGreaterThan(0);
  });

  it('union stewards can read the standings (with the union hub on); staff cannot', async () => {
    await owner.tenant.update({ where: { id: t.tenant.id }, data: { features: { union: true } } });
    (await import('../../src/services/platform/features.js')).forgetFeatures();
    expect((await call(steward).get(`/api/overtime/standings?positionId=${t.position.id}`)).status).toBe(200);
    expect((await call(guard).get(`/api/overtime/standings?positionId=${t.position.id}`)).status).toBe(403);
    expect((await call(steward).post('/api/overtime/entries', {})).status).toBe(403);
  });
});
