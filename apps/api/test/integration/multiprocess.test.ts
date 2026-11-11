/**
 * Several API processes, simulated in one: each PgListener is its own Postgres connection, as each
 * process's would be, and nothing passes between them except through Postgres.
 */
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { signAccessToken } from '../../src/auth/tokens.js';
import { attachCacheBus } from '../../src/lib/cacheBus.js';
import { withTenant } from '../../src/lib/db.js';
import { PgListener } from '../../src/lib/listen.js';
import { startLiveHub, stopLiveHub } from '../../src/services/notifications/liveHub.js';
import { NOTIFY_CHANNEL, notify } from '../../src/services/notifications/notifier.js';
import { forgetFeatures, tenantFeatures } from '../../src/services/platform/features.js';
import { app, owner, seedTenant } from './fixtures.js';

const URL = process.env.APP_DATABASE_URL!;
let t: Awaited<ReturnType<typeof seedTenant>>;
const a = new PgListener(URL, 'fh-test-listen-a');
const b = new PgListener(URL, 'fh-test-listen-b');

const next = (l: PgListener, channel: string, ms = 3000) =>
  new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => (off(), reject(new Error(`nothing on ${channel}`))), ms);
    const off = l.on(channel, (p) => (clearTimeout(timer), off(), resolve(p)));
  });

beforeAll(async () => {
  t = await seedTenant('multiproc', 1);
  // Subscribed before starting, as server.ts does.
  for (const l of [a, b]) for (const ch of [NOTIFY_CHANNEL, 'fh_cache']) l.on(ch, () => undefined);
  await Promise.all([a.start(), b.start()]);
});
afterAll(async () => {
  await Promise.all([a.stop(), b.stop()]);
  await stopLiveHub();
  await app.$disconnect();
  await owner.$disconnect();
});

const notifyOne = (type: string) => withTenant(t.tenant.id, (tx) => notify(tx, t.tenant.id, [{ userId: t.users[0]!.id, type }]), { prisma: app });

describe('live notifications across processes', () => {
  it('a notification written by one process reaches the listeners of every process, ids only, on commit', async () => {
    const [pa, pb] = [next(a, NOTIFY_CHANNEL), next(b, NOTIFY_CHANNEL)];
    await notifyOne('announcement');
    const [ma, mb] = (await Promise.all([pa, pb])).map((p) => JSON.parse(p));
    expect(ma).toEqual(mb);
    expect(Object.keys(ma).sort()).toEqual(['id', 'tenantId', 'userId']);
    expect(ma.tenantId).toBe(t.tenant.id);
    expect(await owner.notification.findUnique({ where: { id: ma.id } })).not.toBeNull();
  });

  it('nothing is announced for a transaction that rolls back', async () => {
    const p = next(a, NOTIFY_CHANNEL, 700);
    await expect(
      withTenant(
        t.tenant.id,
        async (tx) => {
          await notify(tx, t.tenant.id, [{ userId: t.users[0]!.id, type: 'announcement' }]);
          throw new Error('rolled back');
        },
        { prisma: app },
      ),
    ).rejects.toThrow('rolled back');
    await expect(p).rejects.toThrow('nothing on');
  });

  it('a listener whose connection drops reconnects, says so, and hears later notifications', async () => {
    const reconnected = new Promise<void>((resolve) => {
      const off = b.onReconnect(() => (off(), resolve()));
    });
    await owner.$queryRaw`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = 'fh-test-listen-b'`;
    await expect.poll(() => b.connected, { timeout: 3000 }).toBe(false);
    await reconnected;
    expect(b.connected).toBe(true);
    const p = next(b, NOTIFY_CHANNEL);
    await notifyOne('announcement');
    expect(JSON.parse(await p).tenantId).toBe(t.tenant.id);
  });

  it('a browser’s live stream on one process gets a notification written by another', async () => {
    await startLiveHub(URL);
    const server = createApp().listen(0);
    try {
      const port = (server.address() as AddressInfo).port;
      const token = await signAccessToken({ sub: t.users[0]!.id, tid: t.tenant.id, roles: ['STAFF'] });
      const ctl = new AbortController();
      const res = await fetch(`http://127.0.0.1:${port}/api/notifications/stream`, { headers: { authorization: `Bearer ${token}`, 'x-tenant-subdomain': 'multiproc' }, signal: ctl.signal });
      expect(res.status).toBe(200);
      const reader = res.body!.getReader();
      const dec = new TextDecoder();
      let text = '';
      const until = async (re: RegExp) => {
        while (!re.test(text)) {
          const { value, done } = await reader.read();
          if (done) throw new Error('stream ended');
          text += dec.decode(value);
        }
      };
      await until(/event: ready/);
      // Written through a different connection pool (the "other process"); only Postgres connects them.
      await notifyOne('announcement');
      const { id } = await owner.notification.findFirstOrThrow({ where: { userId: t.users[0]!.id }, orderBy: { createdAt: 'desc' } });
      await until(new RegExp(`event: notification\\ndata: \\{"id":"${id}"\\}`));
      ctl.abort();
    } finally {
      server.close();
      await stopLiveHub();
    }
  });
});

describe('cache invalidation across processes', () => {
  it('a feature switched off in another process takes effect here at once, not after the cache expires', async () => {
    const off = attachCacheBus(a);
    try {
      expect((await tenantFeatures(t.tenant.id)).shiftBoard).toBe(true);
      // Another process changes the switch and announces it in its transaction.
      await owner.tenant.update({ where: { id: t.tenant.id }, data: { features: { shiftBoard: false } } });
      expect((await tenantFeatures(t.tenant.id)).shiftBoard).toBe(true); // stale: cached here
      await withTenant(t.tenant.id, (tx) => tx.$executeRaw`SELECT pg_notify('fh_cache', ${JSON.stringify({ cache: 'features', tenantId: t.tenant.id })})`, { prisma: app });
      await expect.poll(async () => (await tenantFeatures(t.tenant.id)).shiftBoard, { timeout: 3000 }).toBe(false);
      // And this process's own forgets go out on the channel, from inside the transaction, on commit.
      const heard = next(b, 'fh_cache');
      await withTenant(t.tenant.id, (tx) => forgetFeatures(t.tenant.id, tx), { prisma: app });
      expect(JSON.parse(await heard)).toEqual({ cache: 'features', tenantId: t.tenant.id });
    } finally {
      off();
      await owner.tenant.update({ where: { id: t.tenant.id }, data: { features: {} } });
      await forgetFeatures(t.tenant.id);
    }
  });
});
