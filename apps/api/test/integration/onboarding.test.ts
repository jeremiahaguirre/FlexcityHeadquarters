import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { resetLimits } from '../../src/auth/rateLimit.js';
import { signAccessToken } from '../../src/auth/tokens.js';
import { withTenant } from '../../src/lib/db.js';
import { onboardingReminders } from '../../src/services/jobs/daily.js';
import { app as appDb, owner, seedOpenOffer, seedTenant } from './fixtures.js';

const server = createApp();
const SUB = 'onboard';
let t: Awaited<ReturnType<typeof seedTenant>>;
let hr: string;
let sup: string;
let guard: string;
let guardId: string;
let items: Array<{ id: string; key: string | null; owner: string; positionIds: string[] }>;
const call = (token: string) => {
  const w = (r: request.Test) => r.auth(token, { type: 'bearer' }).set('x-tenant-subdomain', SUB);
  return { get: (p: string) => w(request(server).get(p)), post: (p: string, b: object = {}) => w(request(server).post(p)).send(b), put: (p: string, b: object) => w(request(server).put(p)).send(b), patch: (p: string, b: object) => w(request(server).patch(p)).send(b) };
};
const key = (k: string) => items.find((i) => i.key === k)!.id;
const today = new Date().toISOString().slice(0, 10);

beforeAll(async () => {
  resetLimits();
  t = await seedTenant(SUB, 2);
  guardId = t.users[0]!.id;
  const h = await owner.user.create({ data: { tenantId: t.tenant.id, roles: ['HR_ADMIN'], employmentStatus: 'FULL_TIME', firstName: 'Hi', lastName: 'R', email: 'hr@onboard.test' } });
  const s = await owner.user.create({ data: { tenantId: t.tenant.id, roles: ['AQUATIC_SUPERVISOR'], employmentStatus: 'FULL_TIME', firstName: 'Su', lastName: 'P', email: 'sup@onboard.test' } });
  hr = await signAccessToken({ sub: h.id, tid: t.tenant.id, roles: ['HR_ADMIN'] });
  sup = await signAccessToken({ sub: s.id, tid: t.tenant.id, roles: ['AQUATIC_SUPERVISOR'] });
  guard = await signAccessToken({ sub: guardId, tid: t.tenant.id, roles: ['STAFF'] });
});
afterAll(async () => {
  await appDb.$disconnect();
  await owner.$disconnect();
});

describe('onboarding', () => {
  it('starts every city with a Canadian catalogue split between HR, supervisors and the employee', async () => {
    const r = await call(hr).get('/api/onboarding/items');
    items = r.body.items;
    expect(items.map((i) => i.key)).toEqual(expect.arrayContaining(['crc', 'vsc', 'child_protection', 'high_five', 'whmis', 'harassment_policy', 'orientation']));
    expect(new Set(items.map((i) => i.owner))).toEqual(new Set(['HR', 'SUPERVISOR', 'EMPLOYEE']));
    expect(r.body.minorsSet).toEqual(['vsc', 'child_protection', 'high_five']);
    expect((await call(guard).get('/api/onboarding/items')).status).toBe(403);
  });

  it('a supervisor switches on the minors set for a position, and the person cannot be scheduled until it is done', async () => {
    const ids = ['crc', 'vsc', 'child_protection', 'high_five'].map(key);
    const on = await call(sup).put(`/api/onboarding/positions/${t.position.id}`, { itemIds: ids, required: true });
    expect(on.status).toBe(200);
    // Both lifeguards in this position are now blocked until HR records the checks.
    expect(on.body.affected).toBe(2);
    const { offer } = await seedOpenOffer(t, 6);
    const blocked = await call(guard).post(`/api/offers/${offer.id}/claim`, {});
    expect(blocked.status).toBe(422);
    const codes = blocked.body.details.blocks.map((b: { code: string; message: string }) => b.message);
    expect(codes).toEqual(expect.arrayContaining(['Onboarding not done: Criminal record check.', 'Onboarding not done: Vulnerable sector check.', 'Onboarding not done: Child protection training.']));
  });

  it('HR records checks (never the result); supervisors cannot complete HR items but do their own', async () => {
    const u = `/api/onboarding/people/${guardId}/items`;
    expect((await call(sup).post(`${u}/${key('crc')}`, { action: 'complete', completedOn: today })).status).toBe(403);
    expect((await call(sup).post(`${u}/${key('orientation')}`, { action: 'complete', completedOn: today })).status).toBe(200);
    for (const k of ['crc', 'vsc', 'child_protection']) expect((await call(hr).post(`${u}/${key(k)}`, { action: 'complete', completedOn: today, note: 'Seen; meets the position standard' })).status).toBe(200);
    const list = (await call(hr).get(`/api/onboarding/people/${guardId}`)).body.items;
    const crc = list.find((i: { key: string }) => i.key === 'crc');
    expect(crc.state).toBe('DONE');
    expect(crc.expiresOn.slice(0, 4)).toBe(String(Number(today.slice(0, 4)) + 3));
  });

  it('once the blocking items are done, the shift can be claimed', async () => {
    const { offer } = await seedOpenOffer(t, 7);
    const r = await call(guard).post(`/api/offers/${offer.id}/claim`, {});
    expect(r.body.outcome).toBe('ASSIGNED');
  });

  it('only HR waives, with a reason', async () => {
    const u = `/api/onboarding/people/${guardId}/items/${key('high_five')}`;
    expect((await call(sup).post(u, { action: 'waive', completedOn: today, reason: 'Equivalent training' })).status).toBe(403);
    expect((await call(hr).post(u, { action: 'waive', completedOn: today })).status).toBe(400);
    expect((await call(hr).post(u, { action: 'waive', completedOn: today, reason: 'Holds an equivalent provincial certificate' })).status).toBe(200);
  });

  it('employees acknowledge policies themselves but cannot complete anything else', async () => {
    const mine = (await call(guard).get('/api/me/onboarding')).body;
    const policy = mine.find((i: { key: string }) => i.key === 'harassment_policy');
    expect(policy.policyText).toMatch(/harassment/);
    expect((await call(guard).post(`/api/me/onboarding/${policy.id}/acknowledge`, { typedName: 'Guard0 onboard' })).status).toBe(200);
    expect((await call(guard).post(`/api/me/onboarding/${key('whmis')}/acknowledge`, { typedName: 'Guard0 onboard' })).status).toBe(403);
    const after = (await call(guard).get('/api/me/onboarding')).body.find((i: { key: string }) => i.key === 'harassment_policy');
    expect(after.state).toBe('DONE');
  });

  it('lists people with outstanding items and reminds once before a check expires', async () => {
    const people = (await call(hr).get('/api/onboarding/people')).body;
    const g = people.find((p: { id: string }) => p.id === guardId);
    expect(g.blocked).toBe(false);
    expect(g.hr.done).toBeGreaterThan(0);
    await owner.onboardingRecord.updateMany({ where: { userId: guardId, itemId: key('crc') }, data: { expiresOn: new Date(Date.now() + 10 * 86_400_000) } });
    const run = () => withTenant(t.tenant.id, (tx) => onboardingReminders(tx), { prisma: appDb });
    expect(await run()).toBe(1);
    expect(await run()).toBe(0);
    expect(await owner.notification.count({ where: { userId: guardId, type: 'onboarding_expiring' } })).toBe(1);
  });
});
