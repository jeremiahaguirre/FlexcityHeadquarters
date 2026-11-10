import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { signAccessToken } from '../../src/auth/tokens.js';
import { withTenant } from '../../src/lib/db.js';
import { coverageAlerts } from '../../src/services/coverage/gaps.js';
import { app as appDb, owner, seedTenant } from './fixtures.js';

const server = createApp();
const SUB = 'arena';
let t: Awaited<ReturnType<typeof seedTenant>>;
let hr: string;
let hrId: string;
let cert: string;
let ops: { a: string; b: string };
const call = (token: string) => ({
  get: (p: string) => request(server).get(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }),
  post: (p: string, b: object = {}) => request(server).post(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }).send(b),
});
// A day a week out; times in the facility's zone (Regina: no daylight saving), checked against UTC instants.
const day = (() => new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10))();
const local = (hour: number) => {
  const d = new Date(`${day}T00:00:00`);
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), hour + 6)); // CST all year
};

beforeAll(async () => {
  t = await seedTenant(SUB, 0);
  await owner.facility.update({ where: { id: t.facility.id }, data: { timezone: 'America/Regina' } });
  cert = (await owner.certification.create({ data: { tenantId: t.tenant.id, name: 'Refrigeration Plant Operator', issuingBody: 'Technical Safety BC' } })).id;
  const mk = async (name: string, holds: boolean) => {
    const u = await owner.user.create({ data: { tenantId: t.tenant.id, roles: ['EMPLOYEE'], employmentStatus: 'FULL_TIME', firstName: name, lastName: 'X', email: `${name}@arena.test` } });
    if (holds) await owner.userCertification.create({ data: { tenantId: t.tenant.id, userId: u.id, certificationId: cert, issueDate: new Date('2024-01-01'), verifiedAt: new Date() } });
    return u.id;
  };
  ops = { a: await mk('ana', true), b: await mk('bo', false) };
  hrId = (await owner.user.create({ data: { tenantId: t.tenant.id, roles: ['HR_ADMIN'], employmentStatus: 'FULL_TIME', firstName: 'H', lastName: 'R', email: 'hr@arena.test' } })).id;
  hr = await signAccessToken({ sub: hrId, tid: t.tenant.id, roles: ['HR_ADMIN'], aat: Math.floor(Date.now() / 1000) });
  const shift = (userId: string, from: number, to: number) => owner.shift.create({ data: { tenantId: t.tenant.id, facilityId: t.facility.id, positionId: t.position.id, userId, startsAt: local(from), endsAt: local(to), status: 'PUBLISHED' } });
  await shift(ops.a, 6, 14); // certified, morning
  await shift(ops.b, 14, 23); // not certified, evening
});
afterAll(async () => {
  await appDb.$disconnect();
  await owner.$disconnect();
});

describe('required coverage', () => {
  it('finds the stretch with no certified operator, and nothing outside the window', async () => {
    const dow = new Date(`${day}T12:00:00Z`).getUTCDay();
    const r = await call(hr).post('/api/coverage/rules', { facilityId: t.facility.id, name: 'Ice plant operator on site', certificationId: cert, minCount: 1, daysOfWeek: [dow], startMinute: 6 * 60, endMinute: 23 * 60 });
    expect(r.status).toBe(201);
    const gaps = (await call(hr).get(`/api/coverage/gaps?from=${day}&days=1`)).body;
    expect(gaps).toEqual([expect.objectContaining({ rule: 'Ice plant operator on site', from: local(14).toISOString(), to: local(23).toISOString(), have: 0, need: 1 })]);
  });

  it('expired or unverified certificates don’t count', async () => {
    await owner.userCertification.updateMany({ where: { userId: ops.a }, data: { expiryDate: new Date('2025-01-01') } });
    const gaps = (await call(hr).get(`/api/coverage/gaps?from=${day}&days=1`)).body;
    expect(gaps[0]).toMatchObject({ from: local(6).toISOString(), to: local(23).toISOString() });
    await owner.userCertification.updateMany({ where: { userId: ops.a }, data: { expiryDate: null } });
  });

  it('alerts once a day about gaps in the next two days', async () => {
    const at = new Date(local(5).getTime() - 24 * 3_600_000);
    expect(await withTenant(t.tenant.id, (tx) => coverageAlerts(tx, at))).toBe(1);
    expect(await withTenant(t.tenant.id, (tx) => coverageAlerts(tx, at))).toBe(0);
    expect(await owner.notification.count({ where: { userId: hrId, type: 'coverage_gap' } })).toBe(1);
  });

  it('staff without scheduling or coverage rights can’t see it', async () => {
    const worker = await signAccessToken({ sub: ops.b, tid: t.tenant.id, roles: ['EMPLOYEE'], aat: Math.floor(Date.now() / 1000) });
    expect((await call(worker).get(`/api/coverage/gaps?from=${day}`)).status).toBe(404);
  });
});
