import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// A key pair for these tests only.
process.env.VAPID_PUBLIC_KEY = 'BB-0ItfoI9mjTOzZl7pubSkT6T7GEo5yuL6q6VoFbnzS72htmN3qpUK9lqE9Av4d__-4Dn5cY0NkZFBzdgycdHY';
process.env.VAPID_PRIVATE_KEY = '-mDBL3w-m4zwmJSW6O1hpEgwAJBxxO7F98ocPKC9edI';

const sent = vi.hoisted(() => ({ calls: [] as Array<{ endpoint: string; payload: Record<string, unknown> }>, fail: new Map<string, number>() }));
vi.mock('web-push', () => ({
  default: {
    setVapidDetails: () => undefined,
    sendNotification: async (sub: { endpoint: string }, body: string) => {
      const status = sent.fail.get(sub.endpoint);
      if (status) throw Object.assign(new Error('push failed'), { statusCode: status });
      sent.calls.push({ endpoint: sub.endpoint, payload: JSON.parse(body) });
      return { statusCode: 201 };
    },
  },
}));

const { createApp } = await import('../../src/app.js');
const { signAccessToken } = await import('../../src/auth/tokens.js');
const { withTenant } = await import('../../src/lib/db.js');
const { deliverPush } = await import('../../src/services/notifications/push.js');
const { loneWorkChecks } = await import('../../src/services/safety/loneWork.js');
const { app: appDb, owner, seedTenant } = await import('./fixtures.js');

const server = createApp();
const SUB = 'pushcity';
let t: Awaited<ReturnType<typeof seedTenant>>;
const id = { a: '', b: '', sup: '' };
const tok = { a: '', b: '', sup: '' };
const as = (token: string) => ({
  get: (p: string) => request(server).get(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }),
  post: (p: string, b: object = {}) => request(server).post(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }).send(b),
  put: (p: string, b: object = {}) => request(server).put(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }).send(b),
  del: (p: string, b: object = {}) => request(server).delete(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }).send(b),
});
const keys = { p256dh: 'B' + 'A'.repeat(86), auth: 'c2VjcmV0LWF1dGgtMTIz' };
const FCM = 'https://fcm.googleapis.com/fcm/send/device-one';
const APPLE = 'https://web.push.apple.com/QGx1Y2t5';
const run = () => withTenant(t.tenant.id, (tx) => deliverPush(tx));

beforeAll(async () => {
  t = await seedTenant(SUB, 0);
  const now = Math.floor(Date.now() / 1000);
  const mk = (roles: ('EMPLOYEE' | 'AQUATIC_SUPERVISOR')[], email: string, locale = 'en-CA') =>
    owner.user.create({ data: { tenantId: t.tenant.id, roles, employmentStatus: 'FULL_TIME', firstName: email, lastName: 'X', email: `${email}@${SUB}.test`, locale } });
  id.a = (await mk(['EMPLOYEE'], 'ana', 'fr-CA')).id;
  id.b = (await mk(['EMPLOYEE'], 'ben')).id;
  id.sup = (await mk(['AQUATIC_SUPERVISOR'], 'sup')).id;
  tok.a = await signAccessToken({ sub: id.a, tid: t.tenant.id, roles: ['EMPLOYEE'], aat: now });
  tok.b = await signAccessToken({ sub: id.b, tid: t.tenant.id, roles: ['EMPLOYEE'], aat: now });
  tok.sup = await signAccessToken({ sub: id.sup, tid: t.tenant.id, roles: ['AQUATIC_SUPERVISOR'], aat: now });
});
beforeEach(() => {
  sent.calls.length = 0;
  sent.fail.clear();
});
afterAll(async () => {
  await appDb.$disconnect();
  await owner.$disconnect();
});

describe('push subscriptions', () => {
  it('hands out the public key', async () => {
    expect((await as(tok.a).get('/api/push/key')).body.publicKey).toBe(process.env.VAPID_PUBLIC_KEY);
  });

  it('accepts only browser push services, so the server can’t be pointed at any URL', async () => {
    for (const endpoint of ['https://evil.example/collect', 'http://fcm.googleapis.com/x', 'https://fcm.googleapis.com:8443/x', 'https://169.254.169.254/latest', 'https://fcm.googleapis.com.evil.example/x']) {
      expect((await as(tok.a).post('/api/me/push', { endpoint, keys })).status, endpoint).toBe(400);
    }
    expect((await as(tok.a).post('/api/me/push', { endpoint: FCM, keys, device: 'Android · Chrome' })).status).toBe(201);
    expect((await as(tok.a).post('/api/me/push', { endpoint: APPLE, keys, device: 'iPhone · Safari' })).status).toBe(201);
    expect((await as(tok.a).get('/api/me/push')).body.map((d: { device: string }) => d.device).sort()).toEqual(['Android · Chrome', 'iPhone · Safari']);
  });

  it('a shared device follows whoever signed in last', async () => {
    expect((await as(tok.b).post('/api/me/push', { endpoint: FCM, keys })).status).toBe(201);
    expect((await as(tok.a).get('/api/me/push')).body).toHaveLength(1);
    expect((await as(tok.b).get('/api/me/push')).body).toHaveLength(1);
    // Ben can't remove Ana's device.
    expect((await as(tok.b).del('/api/me/push', { endpoint: APPLE })).body.removed).toBe(0);
    expect((await as(tok.b).del('/api/me/push', { endpoint: FCM })).body.removed).toBe(1);
  });
});

describe('delivery', () => {
  it('sends each new notification once, in the person’s language, with nothing sensitive on the lock screen', async () => {
    await owner.notification.createMany({
      data: [
        { tenantId: t.tenant.id, userId: id.a, type: 'shift_assigned', link: '/schedule', params: {} },
        { tenantId: t.tenant.id, userId: id.a, type: 'discipline_issued', link: '/profile', params: { reason: 'Late three times' } },
      ],
    });
    expect(await run()).toBe(2);
    const bodies = sent.calls.map((c) => c.payload);
    expect(bodies[0]).toMatchObject({ title: 'Nouveau quart', link: '/schedule' });
    expect(bodies[1]).toMatchObject({ title: 'FlexcityHeadquarters', body: 'Vous avez un nouveau message.' });
    expect(JSON.stringify(bodies)).not.toContain('Late three times');
    expect(await run()).toBe(0);
  });

  it('skips stale notifications and people who no longer work here', async () => {
    await owner.notification.create({ data: { tenantId: t.tenant.id, userId: id.a, type: 'shift_changed', params: {}, createdAt: new Date(Date.now() - 60 * 60_000) } });
    expect(await run()).toBe(0);
    await owner.user.update({ where: { id: id.a }, data: { status: 'INACTIVE' } });
    await owner.notification.create({ data: { tenantId: t.tenant.id, userId: id.a, type: 'shift_changed', params: {} } });
    expect(await run()).toBe(0);
    await owner.user.update({ where: { id: id.a }, data: { status: 'ACTIVE' } });
    expect(await owner.notification.count({ where: { userId: id.a, pushedAt: null } })).toBe(0);
  });

  it('forgets a device the push service says is gone', async () => {
    sent.fail.set(APPLE, 410);
    await owner.notification.create({ data: { tenantId: t.tenant.id, userId: id.a, type: 'shift_changed', params: {} } });
    expect(await run()).toBe(0);
    expect(await owner.pushSubscription.count({ where: { userId: id.a } })).toBe(0);
  });
});

describe('urgent pushes', () => {
  const SUP_DEVICE = 'https://fcm.googleapis.com/fcm/send/supervisor';
  it('two deliveries at once (the API and the worker) push each notification once', async () => {
    expect((await as(tok.sup).post('/api/me/push', { endpoint: SUP_DEVICE, keys })).status).toBe(201);
    await owner.notification.createMany({ data: Array.from({ length: 5 }, () => ({ tenantId: t.tenant.id, userId: id.sup, type: 'shift_available', params: {} })) });
    const [a, b] = await Promise.all([run(), withTenant(t.tenant.id, (tx) => deliverPush(tx), { prisma: appDb })]);
    expect(a + b).toBe(5);
    expect(sent.calls.filter((c) => c.endpoint === SUP_DEVICE)).toHaveLength(5);
  });

  it('a call for help is pushed straight after the commit, not at the next minute, safety first', async () => {
    const { enableInlineUrgent } = await import('../../src/services/notifications/urgent.js');
    const { notify } = await import('../../src/services/notifications/notifier.js');
    const stop = enableInlineUrgent({});
    try {
      await withTenant(t.tenant.id, (tx) =>
        notify(tx, t.tenant.id, [
          { userId: id.sup, type: 'shift_available', params: { n: 1 } },
          { userId: id.sup, type: 'lonework_help', params: { name: 'Ben', location: 'Reservoir' } },
        ]),
      );
      const started = Date.now();
      while (sent.calls.length < 2 && Date.now() - started < 2_000) await new Promise((r) => setTimeout(r, 20));
      expect(sent.calls.map((c) => c.payload.tag)).toEqual(['lonework_help', 'shift_available']);
      expect(sent.calls[0]!.payload).toMatchObject({ urgent: true, title: 'URGENT: help requested' });
    } finally {
      await stop();
    }
  });
});

describe('working alone: location and reminders', () => {
  it('location updates only while sharing is on, at most every 30 seconds; turning it off removes it', async () => {
    const s = await as(tok.b).post('/api/me/lone-work', { location: 'Reservoir 2', intervalMinutes: 30 });
    expect(s.body.shareLocation).toBe(false);
    expect((await as(tok.b).post('/api/me/lone-work/location', { latitude: 49.88, longitude: -119.49 })).body.code).toBe('LOCATION_OFF');
    expect((await as(tok.b).put('/api/me/lone-work/share-location', { on: true })).body.shareLocation).toBe(true);
    expect((await as(tok.b).post('/api/me/lone-work/location', { latitude: 49.88, longitude: -119.49 })).body.kept).toBe(true);
    expect((await as(tok.b).post('/api/me/lone-work/location', { latitude: 49.89, longitude: -119.5 })).body.kept).toBe(false);
    const board = (await as(tok.sup).get('/api/lone-work')).body[0];
    expect(board).toMatchObject({ latitude: 49.88, longitude: -119.49, shareLocation: true });
    expect(board.locationAt).toBeTruthy();
    const off = await as(tok.b).put('/api/me/lone-work/share-location', { on: false });
    expect(off.body).toMatchObject({ shareLocation: false, latitude: null, longitude: null, locationAt: null });
    expect(await owner.auditLog.count({ where: { tenantId: t.tenant.id, action: { in: ['lonework.location_on', 'lonework.location_off'] } } })).toBe(2);
  });

  it('reminds the worker 5 minutes before a check-in is due, once per interval', async () => {
    await owner.loneWorkSession.updateMany({ where: { userId: id.b, status: 'ACTIVE' }, data: { nextDueAt: new Date(Date.now() + 4 * 60_000) } });
    const count = () => owner.notification.count({ where: { userId: id.b, type: 'lonework_due_soon' } });
    await withTenant(t.tenant.id, (tx) => loneWorkChecks(tx));
    await withTenant(t.tenant.id, (tx) => loneWorkChecks(tx));
    expect(await count()).toBe(1);
    // A check-in starts a new interval: the next one gets its own reminder.
    await as(tok.b).post('/api/me/lone-work/check-in');
    await owner.loneWorkSession.updateMany({ where: { userId: id.b, status: 'ACTIVE' }, data: { nextDueAt: new Date(Date.now() + 2 * 60_000) } });
    await withTenant(t.tenant.id, (tx) => loneWorkChecks(tx));
    expect(await count()).toBe(2);
    await as(tok.b).post('/api/me/lone-work/end');
  });
});
