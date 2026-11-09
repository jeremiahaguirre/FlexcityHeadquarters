import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { resetLimits } from '../../src/auth/rateLimit.js';
import { signAccessToken } from '../../src/auth/tokens.js';
import { app as appDb, owner, seedTenant } from './fixtures.js';

// Incident reports are encrypted; tests use a throwaway key.
process.env.LOCAL_KEK_BASE64 ||= randomBytes(32).toString('base64');

const server = createApp();
const SUB = 'carefollow';
let t: Awaited<ReturnType<typeof seedTenant>>;
let sup: string;
let supId: string;
const tok: string[] = [];
const call = (token: string) => {
  const w = (r: request.Test) => r.auth(token, { type: 'bearer' }).set('x-tenant-subdomain', SUB);
  return { get: (p: string) => w(request(server).get(p)), post: (p: string, b: object = {}) => w(request(server).post(p)).send(b), put: (p: string, b: object) => w(request(server).put(p)).send(b) };
};
const narrative = (emsCalled: boolean) => ({ summary: 'Swimmer pulled from deep end', peopleInvolved: 'swimmer, about 9', actionsTaken: 'Rescue and first aid', emsCalled });

beforeAll(async () => {
  resetLimits();
  t = await seedTenant(SUB, 3);
  const s = await owner.user.create({ data: { tenantId: t.tenant.id, roles: ['AQUATIC_SUPERVISOR'], employmentStatus: 'FULL_TIME', firstName: 'S', lastName: 'C', email: 'sup@carefollow.test' } });
  supId = s.id;
  sup = await signAccessToken({ sub: s.id, tid: t.tenant.id, roles: ['AQUATIC_SUPERVISOR'] });
  for (const u of t.users) tok.push(await signAccessToken({ sub: u.id, tid: t.tenant.id, roles: ['STAFF'] }));
  // Guards 0 and 1 are on duty; guard 2 is not.
  for (const u of t.users.slice(0, 2)) await owner.timePunch.create({ data: { tenantId: t.tenant.id, userId: u.id, facilityId: t.facility.id, positionId: t.position.id, clockIn: new Date(Date.now() - 2 * 3_600_000) } });
});
afterAll(async () => {
  await appDb.$disconnect();
  await owner.$disconnect();
});

describe('care after critical incidents', () => {
  it('a minor first-aid report offers nothing', async () => {
    const r = await call(tok[0]!).post('/api/incidents', { facilityId: t.facility.id, occurredAt: new Date().toISOString(), category: 'FIRST_AID', narrative: narrative(false) });
    expect(r.status).toBe(201);
    expect(await owner.careCheckIn.count({ where: { tenantId: t.tenant.id } })).toBe(0);
  });

  it('a rescue offers a check-in to the reporter and everyone on duty, and tells supervisors', async () => {
    await call(sup).put('/api/care/settings', { eap: 'Employee and Family Assistance: 1-800-555-0100, 24/7, confidential' });
    const r = await call(tok[0]!).post('/api/incidents', { facilityId: t.facility.id, occurredAt: new Date().toISOString(), category: 'RESCUE', narrative: narrative(true) });
    expect(r.status).toBe(201);
    const list = await call(sup).get('/api/care/checkins');
    expect(list.body.map((c: { userId: string }) => c.userId).sort()).toEqual([t.users[0]!.id, t.users[1]!.id].sort());
    expect(await owner.notification.count({ where: { userId: supId, type: 'care_checkins_due' } })).toBe(1);
    const mine = await call(tok[1]!).get('/api/me/care');
    expect(mine.body.open).toHaveLength(1);
    expect(mine.body.eap).toMatch(/1-800/);
    expect((await call(tok[2]!).get('/api/me/care')).body.open).toHaveLength(0);
  });

  it('a guard can ask for time off the chair; supervisors hear right away', async () => {
    const [c] = (await call(tok[1]!).get('/api/me/care')).body.open;
    expect((await call(tok[1]!).post(`/api/me/care/${c.id}/break`)).status).toBe(200);
    expect(await owner.notification.count({ where: { userId: supId, type: 'care_break_requested' } })).toBe(1);
    expect((await call(tok[0]!).post(`/api/me/care/${c.id}/break`)).status).toBe(404);
  });

  it('the supervisor records the check-in; only that it happened is kept', async () => {
    const list = (await call(sup).get('/api/care/checkins')).body;
    const c = list.find((x: { userId: string }) => x.userId === t.users[1]!.id);
    expect((await call(sup).post(`/api/care/checkins/${c.id}/done`)).status).toBe(200);
    const stored = await owner.careCheckIn.findUniqueOrThrow({ where: { id: c.id } });
    expect(stored.status).toBe('CHECKED_IN');
    expect(Object.keys(stored)).not.toContain('notes');
    expect((await call(tok[0]!).get('/api/care/checkins')).status).toBe(403);
  });
});
