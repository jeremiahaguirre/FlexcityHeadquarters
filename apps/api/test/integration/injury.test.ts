import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { signAccessToken } from '../../src/auth/tokens.js';
import { withTenant } from '../../src/lib/db.js';
import { injuryReminders } from '../../src/routes/injury.js';
import { app as appDb, owner, seedTenant } from './fixtures.js';

const server = createApp();
const SUB = 'injury';
let t: Awaited<ReturnType<typeof seedTenant>>;
let hr: string;
let hrId: string;
const call = (token: string) => ({
  get: (p: string) => request(server).get(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }),
  post: (p: string, b: object = {}) => request(server).post(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }).send(b),
  patch: (p: string, b: object = {}) => request(server).patch(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }).send(b),
});

beforeAll(async () => {
  t = await seedTenant(SUB, 1);
  hrId = (await owner.user.create({ data: { tenantId: t.tenant.id, roles: ['HR_ADMIN'], employmentStatus: 'FULL_TIME', firstName: 'H', lastName: 'R', email: 'hr@injury.test' } })).id;
  hr = await signAccessToken({ sub: hrId, tid: t.tenant.id, roles: ['HR_ADMIN'], aat: Math.floor(Date.now() / 1000) });
});
afterAll(async () => {
  await appDb.$disconnect();
  await owner.$disconnect();
});

describe('injury reports to the board', () => {
  let id: string;
  it('uses the facility province’s board and deadline (BC: WorkSafeBC, 3 days)', async () => {
    const learned = new Date(Date.now() - 2 * 3_600_000);
    const r = await call(hr).post('/api/injury-claims', { userId: t.users[0]!.id, facilityId: t.facility.id, occurredAt: new Date(Date.now() - 3 * 3_600_000), learnedAt: learned, lostTime: true, healthCare: false, description: 'Sprained right ankle on pool deck stairs' });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ board: 'WorkSafeBC', status: 'OPEN', province: 'BC' });
    expect(new Date(r.body.dueAt).getTime() - learned.getTime()).toBe(3 * 86_400_000);
    id = r.body.id;
  });

  it('first aid only is kept on file without a report; finding lost time later makes it due', async () => {
    const r = await call(hr).post('/api/injury-claims', { userId: t.users[0]!.id, facilityId: t.facility.id, occurredAt: new Date(Date.now() - 3_600_000), learnedAt: new Date(), lostTime: false, healthCare: false, description: 'Small cut on finger, bandaged' });
    expect(r.body.status).toBe('NOT_REQUIRED');
    await call(hr).patch(`/api/injury-claims/${r.body.id}`, { healthCare: true });
    expect((await owner.injuryClaim.findUniqueOrThrow({ where: { id: r.body.id } })).status).toBe('OPEN');
  });

  it('reminds a day before and when overdue, once each; filing closes it', async () => {
    const due = (await owner.injuryClaim.findUniqueOrThrow({ where: { id } })).dueAt;
    expect(await withTenant(t.tenant.id, (tx) => injuryReminders(tx, new Date(due.getTime() - 3 * 3_600_000)))).toBeGreaterThanOrEqual(1);
    expect(await owner.notification.count({ where: { userId: hrId, type: 'injury_due_soon' } })).toBeGreaterThanOrEqual(1);
    const before = await owner.notification.count({ where: { userId: hrId, type: 'injury_due_soon' } });
    await withTenant(t.tenant.id, (tx) => injuryReminders(tx, new Date(due.getTime() - 2 * 3_600_000)));
    expect(await owner.notification.count({ where: { userId: hrId, type: 'injury_due_soon' } })).toBe(before);
    await withTenant(t.tenant.id, (tx) => injuryReminders(tx, new Date(due.getTime() + 60_000)));
    expect(await owner.notification.count({ where: { userId: hrId, type: 'injury_overdue' } })).toBeGreaterThanOrEqual(1);
    expect((await call(hr).post(`/api/injury-claims/${id}/filed`, { claimNumber: 'WSBC-123456' })).status).toBe(200);
    const list = (await call(hr).get('/api/injury-claims')).body.claims;
    expect(list.find((c: { id: string }) => c.id === id)).toMatchObject({ status: 'FILED', claimNumber: 'WSBC-123456', person: expect.any(String) });
  });

  it('staff can’t see injury reports', async () => {
    const guard = await signAccessToken({ sub: t.users[0]!.id, tid: t.tenant.id, roles: ['STAFF'], aat: Math.floor(Date.now() / 1000) });
    expect((await call(guard).get('/api/injury-claims')).status).toBe(403);
  });
});
