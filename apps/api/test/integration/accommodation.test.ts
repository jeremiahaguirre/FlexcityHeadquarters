import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { resetLimits } from '../../src/auth/rateLimit.js';
import { signAccessToken } from '../../src/auth/tokens.js';
import { app as appDb, owner, seedOpenOffer, seedTenant } from './fixtures.js';

const server = createApp();
const SUB = 'accomm';
let t: Awaited<ReturnType<typeof seedTenant>>;
let hr: string;
let sup: string;
let guard: string;
let caseId: string;
const call = (token: string) => {
  const w = (r: request.Test) => r.auth(token, { type: 'bearer' }).set('x-tenant-subdomain', SUB);
  return { get: (p: string) => w(request(server).get(p)), post: (p: string, b: object = {}) => w(request(server).post(p)).send(b), patch: (p: string, b: object) => w(request(server).patch(p)).send(b) };
};

beforeAll(async () => {
  resetLimits();
  t = await seedTenant(SUB, 1);
  const h = await owner.user.create({ data: { tenantId: t.tenant.id, roles: ['HR_ADMIN'], employmentStatus: 'FULL_TIME', firstName: 'H', lastName: 'A', email: 'hr@accomm.test' } });
  const s = await owner.user.create({ data: { tenantId: t.tenant.id, roles: ['AQUATIC_SUPERVISOR'], employmentStatus: 'FULL_TIME', firstName: 'S', lastName: 'A', email: 'sup@accomm.test' } });
  hr = await signAccessToken({ sub: h.id, tid: t.tenant.id, roles: ['HR_ADMIN'] });
  sup = await signAccessToken({ sub: s.id, tid: t.tenant.id, roles: ['AQUATIC_SUPERVISOR'] });
  guard = await signAccessToken({ sub: t.users[0]!.id, tid: t.tenant.id, roles: ['STAFF'] });
});
afterAll(async () => {
  await appDb.$disconnect();
  await owner.$disconnect();
});

describe('accommodation and return to work', () => {
  it('only HR records restrictions; the employee is told', async () => {
    const body = { label: 'Return to work', startsOn: '2026-01-01', maxShiftHours: 4 };
    expect((await call(sup).post(`/api/users/${t.users[0]!.id}/accommodations`, body)).status).toBe(403);
    const r = await call(hr).post(`/api/users/${t.users[0]!.id}/accommodations`, body);
    expect(r.status).toBe(201);
    caseId = r.body.id;
    expect(await owner.notification.count({ where: { userId: t.users[0]!.id, type: 'accommodation_set' } })).toBe(1);
  });

  it('the scheduler enforces it, telling others only that it is outside the restrictions', async () => {
    const { offer } = await seedOpenOffer(t, 5, 6);
    const r = await call(guard).post(`/api/offers/${offer.id}/claim`, {});
    expect(r.status).toBe(422);
    const block = r.body.details.blocks.find((b: { code: string }) => b.code === 'ACCOMMODATION');
    expect(block.message).toBe("Outside this person's work restrictions.");
    expect(JSON.stringify(r.body)).not.toMatch(/Return to work|4/);
  });

  it('the employee sees their own restrictions; supervisors cannot read the case', async () => {
    expect((await call(guard).get('/api/me/accommodations')).body[0].maxShiftHours).toBe(4);
    expect((await call(sup).get(`/api/users/${t.users[0]!.id}/accommodations`)).status).toBe(403);
  });

  it('closing the case lifts the restriction', async () => {
    await call(hr).patch(`/api/accommodations/${caseId}`, { close: true });
    const { offer } = await seedOpenOffer(t, 6, 6);
    expect((await call(guard).post(`/api/offers/${offer.id}/claim`, {})).body.outcome).toBe('ASSIGNED');
  });
});
