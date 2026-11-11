import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { signAccessToken } from '../../src/auth/tokens.js';
import { enableInlineDispatch } from '../../src/lib/outbox.js';
import { forgetFeatures } from '../../src/services/platform/features.js';
import { app as appDb, owner, seedTenant } from './fixtures.js';

const server = createApp();
const SUB = 'phi';
let t: Awaited<ReturnType<typeof seedTenant>>;
let staff: string;
let sup: string;
const call = (token: string) => ({
  get: (p: string) => request(server).get(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }),
  post: (p: string, b: object = {}) => request(server).post(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }).send(b),
});
async function setFeatures(features: object) {
  await owner.tenant.update({ where: { id: t.tenant.id }, data: { features } });
  forgetFeatures(t.tenant.id);
}

// Same as server.ts: events recorded with a change are delivered right after its commit.
const stopDispatch = enableInlineDispatch({ prisma: appDb });

beforeAll(async () => {
  t = await seedTenant(SUB, 1);
  const s = await owner.user.create({ data: { tenantId: t.tenant.id, roles: ['AQUATIC_SUPERVISOR'], employmentStatus: 'FULL_TIME', firstName: 'S', lastName: 'Up', email: 'sup@phi.test' } });
  staff = await signAccessToken({ sub: t.users[0]!.id, tid: t.tenant.id, roles: ['STAFF'] });
  sup = await signAccessToken({ sub: s.id, tid: t.tenant.id, roles: ['AQUATIC_SUPERVISOR'] });
});
afterAll(async () => {
  await stopDispatch();
  await appDb.$disconnect();
  await owner.$disconnect();
});

describe('feature switches', () => {
  it('a switched-off feature disappears from my permissions and its routes refuse', async () => {
    await setFeatures({ shiftBoard: false, lessons: false });
    const me = await call(staff).get('/api/me');
    expect(me.body.features).toMatchObject({ shiftBoard: false, lessons: false, timeclock: true, union: false });
    expect(me.body.permissions).not.toContain('shiftboard.claim');
    expect(me.body.permissions).toContain('timeclock.punch');
    expect((await call(staff).get('/api/shiftboard/offers')).status).toBe(403);
    const lessons = await call(staff).get('/api/me/lessons?from=2026-11-02&to=2026-11-15');
    expect(lessons.status).toBe(404);
    expect(lessons.body.code).toBe('FEATURE_OFF');
  });

  it('switching it back on restores it', async () => {
    await setFeatures({});
    expect((await call(staff).get('/api/shiftboard/offers')).status).toBe(200);
    expect((await call(staff).get('/api/me/lessons?from=2026-11-02&to=2026-11-15')).status).toBe(200);
  });

  it('the public careers page goes away with job postings', async () => {
    await setFeatures({ jobs: false });
    expect((await request(server).get('/api/public/jobs').set('x-tenant-subdomain', SUB)).status).toBe(404);
    await setFeatures({});
    expect((await request(server).get('/api/public/jobs').set('x-tenant-subdomain', SUB)).status).toBe(200);
  });

  it('notification emails stop while the switch is off, in-app notifications keep coming', async () => {
    await setFeatures({ emailNotifications: false });
    const req = await call(staff).post('/api/me/time-off', { type: 'VACATION', startsAt: '2027-02-01T08:00:00Z', endsAt: '2027-02-02T08:00:00Z' });
    expect(req.status).toBe(201);
    const before = await owner.emailOutbox.count({ where: { tenantId: t.tenant.id, template: 'time_off_decided' } });
    expect((await call(sup).post(`/api/time-off/${req.body.request.id}/decision`, { decision: 'APPROVE' })).status).toBe(200);
    expect(await owner.emailOutbox.count({ where: { tenantId: t.tenant.id, template: 'time_off_decided' } })).toBe(before);
    // In-app notifications are written right after the decision commits.
    await expect.poll(() => owner.notification.count({ where: { userId: t.users[0]!.id, type: 'time_off_decided' } })).toBe(1);

    // Back on: the same decision emails again.
    await setFeatures({});
    const again = await call(staff).post('/api/me/time-off', { type: 'VACATION', startsAt: '2027-03-01T08:00:00Z', endsAt: '2027-03-02T08:00:00Z' });
    await call(sup).post(`/api/time-off/${again.body.request.id}/decision`, { decision: 'APPROVE' });
    await expect.poll(() => owner.emailOutbox.count({ where: { tenantId: t.tenant.id, template: 'time_off_decided' } })).toBe(before + 1);
  });
});
