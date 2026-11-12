import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { hashPassword, signAccessToken } from '../../src/auth/tokens.js';
import { withTenant } from '../../src/lib/db.js';
import { maintenanceNotices } from '../../src/services/platform/maintenance.js';
import { app as appDb, owner, seedTenant } from './fixtures.js';

const server = createApp();
const sfx = randomBytes(3).toString('hex');
let cookie: string;
let a: Awaited<ReturnType<typeof seedTenant>>;
let b: Awaited<ReturnType<typeof seedTenant>>;
const hr: Record<string, string> = {};
const H = 3_600_000;
const dev = {
  get: (p: string) => request(server).get(`/api/platform${p}`).set('x-fh-platform', '1').set('Cookie', cookie),
  post: (p: string, body: object = {}) => request(server).post(`/api/platform${p}`).set('x-fh-platform', '1').set('Cookie', cookie).send(body),
  put: (p: string, body: object) => request(server).put(`/api/platform${p}`).set('x-fh-platform', '1').set('Cookie', cookie).send(body),
};
const staff = async (t: typeof a) => {
  const token = await signAccessToken({ sub: t.users[0]!.id, tid: t.tenant.id, roles: ['STAFF'] });
  return (p: string) => request(server).get(p).set('x-tenant-subdomain', t.tenant.subdomain).auth(token, { type: 'bearer' });
};
const window = (startH: number, endH: number, over: object = {}) => ({ startsAt: new Date(Date.now() + startH * H).toISOString(), endsAt: new Date(Date.now() + endH * H).toISOString(), messageEn: 'The app may be slow for a few minutes.', messageFr: 'L’application pourrait être lente quelques minutes.', ...over });

beforeAll(async () => {
  a = await seedTenant(`mwa${sfx}`, 1);
  b = await seedTenant(`mwb${sfx}`, 1);
  for (const t of [a, b]) hr[t.tenant.id] = (await owner.user.create({ data: { tenantId: t.tenant.id, roles: ['HR_ADMIN'], employmentStatus: 'FULL_TIME', firstName: 'Hana', lastName: 'HR', email: `hr@${t.tenant.subdomain}.test`, dateOfBirth: new Date('1985-01-01') } })).id;
  const email = `mw-${sfx}@flexcity.dev`;
  await owner.platformAdmin.create({ data: { email, name: 'Dev', passwordHash: await hashPassword('correct horse battery') } });
  const r = await request(server).post('/api/platform/auth/login').set('x-fh-platform', '1').send({ email, password: 'correct horse battery' });
  cookie = String(r.headers['set-cookie']).split(';')[0]!;
});
afterAll(async () => {
  await appDb.$disconnect();
  await owner.$disconnect();
});

describe('maintenance notices', () => {
  it('scheduled for one organization: its HR admins are told at once (in-app and email), a day before again, once each', async () => {
    const r = await dev.post('/maintenance', window(48, 49, { tenantIds: [a.tenant.id] }));
    expect(r.status).toBe(201);
    expect(r.body.status).toBe('upcoming');
    const id = r.body.id as string;
    const count = (type: string, t = a) => owner.notification.count({ where: { userId: hr[t.tenant.id]!, type, params: { path: ['windowId'], equals: id } } });
    expect(await count('maintenance_scheduled')).toBe(1);
    expect(await owner.emailOutbox.count({ where: { tenantId: a.tenant.id, template: 'maintenance_scheduled' } })).toBe(1);
    expect(await count('maintenance_scheduled', b)).toBe(0);
    const n = await owner.notification.findFirstOrThrow({ where: { userId: hr[a.tenant.id]!, type: 'maintenance_scheduled' } });
    expect(String((n.params as { whenFr: string }).whenFr)).toMatch(/2026|2027/);
    // Two days out: no banner yet.
    expect((await (await staff(a))('/api/maintenance')).body.banners).toEqual([]);
    expect((await (await staff(a))('/api/maintenance')).body.upcoming.map((w: { id: string }) => w.id)).toContain(id);

    // A day before: the reminder, once, and the heads-up banner.
    await owner.maintenanceWindow.update({ where: { id }, data: { startsAt: new Date(Date.now() + 20 * H), endsAt: new Date(Date.now() + 21 * H) } });
    await maintenanceNotices(appDb);
    await maintenanceNotices(appDb);
    expect(await count('maintenance_soon')).toBe(1);
    expect(await count('maintenance_scheduled')).toBe(1);
    const banner = (await (await staff(a))('/api/maintenance')).body.banners;
    expect(banner).toMatchObject([{ id, status: 'upcoming', message: { fr: 'L’application pourrait être lente quelques minutes.' } }]);
    expect((await (await staff(b))('/api/maintenance')).body.banners).toEqual([]);
    // The sign-in page sees it too, without a session.
    expect((await request(server).get('/api/public/maintenance').set('x-tenant-subdomain', a.tenant.subdomain)).body.banners[0].id).toBe(id);
    expect((await request(server).get('/api/public/maintenance').set('x-tenant-subdomain', b.tenant.subdomain)).body.banners).toEqual([]);

    // During the window; then cancelled, gone.
    await owner.maintenanceWindow.update({ where: { id }, data: { startsAt: new Date(Date.now() - H), endsAt: new Date(Date.now() + H) } });
    expect((await (await staff(a))('/api/maintenance')).body.banners[0].status).toBe('active');
    expect((await dev.post(`/maintenance/${id}/cancel`)).body.status).toBe('cancelled');
    expect((await (await staff(a))('/api/maintenance')).body.banners).toEqual([]);
    expect(await owner.platformAudit.count({ where: { action: { in: ['maintenance.schedule', 'maintenance.cancel'] }, detail: { path: ['id'], equals: id } } })).toBe(2);
  });

  it('scheduled less than a day ahead: the reminder is the only notice; for all organizations', async () => {
    const r = await dev.post('/maintenance', window(2, 3));
    const id = r.body.id as string;
    for (const t of [a, b]) {
      expect(await owner.notification.count({ where: { userId: hr[t.tenant.id]!, type: 'maintenance_soon', params: { path: ['windowId'], equals: id } } })).toBe(1);
      expect(await owner.notification.count({ where: { userId: hr[t.tenant.id]!, type: 'maintenance_scheduled', params: { path: ['windowId'], equals: id } } })).toBe(0);
    }
    await dev.post(`/maintenance/${id}/cancel`);
  });

  it('checks: end after start, at most 72 hours, not in the past; organizations only read windows for them; the app can’t write them', async () => {
    expect((await dev.post('/maintenance', window(5, 4))).status).toBe(400);
    expect((await dev.post('/maintenance', window(5, 80))).status).toBe(400);
    expect((await dev.post('/maintenance', window(-5, -4))).status).toBe(409);
    const w = await owner.maintenanceWindow.create({ data: { ...window(1, 2), tenantIds: [b.tenant.id], ringIds: [], createdById: hr[a.tenant.id]! } });
    expect(await withTenant(a.tenant.id, (tx) => tx.maintenanceWindow.count({ where: { id: w.id } }), { prisma: appDb })).toBe(0);
    await expect(withTenant(a.tenant.id, (tx) => tx.maintenanceWindow.create({ data: { ...window(1, 2), tenantIds: [], ringIds: [], createdById: hr[a.tenant.id]! } }), { prisma: appDb })).rejects.toThrow();
    await owner.maintenanceWindow.update({ where: { id: w.id }, data: { cancelledAt: new Date() } });
  });

  it('moving a window tells HR admins again', async () => {
    const r = await dev.post('/maintenance', window(50, 51, { tenantIds: [a.tenant.id] }));
    const moved = await dev.put(`/maintenance/${r.body.id}`, window(60, 61, { tenantIds: [a.tenant.id] }));
    expect(moved.status).toBe(200);
    expect(moved.body.id).not.toBe(r.body.id);
    expect(await owner.notification.count({ where: { userId: hr[a.tenant.id]!, type: 'maintenance_scheduled', params: { path: ['windowId'], equals: moved.body.id } } })).toBe(1);
    expect((await owner.maintenanceWindow.findUniqueOrThrow({ where: { id: r.body.id } })).cancelledAt).not.toBeNull();
    await dev.post(`/maintenance/${moved.body.id}/cancel`);
  });
});
