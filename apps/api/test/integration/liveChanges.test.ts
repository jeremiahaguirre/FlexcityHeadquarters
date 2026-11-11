import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { signAccessToken } from '../../src/auth/tokens.js';
import { CHANGE_CHANNEL, EVENTS_CHANNEL, announceChange } from '../../src/lib/changes.js';
import { withTenant } from '../../src/lib/db.js';
import { recordEvents } from '../../src/lib/events.js';
import { PgListener } from '../../src/lib/listen.js';
import { startLiveHub, stopLiveHub } from '../../src/services/notifications/liveHub.js';
import { clockIn } from '../../src/services/timeclock/punches.js';
import { app, owner, seedTenant } from './fixtures.js';

const URL = process.env.APP_DATABASE_URL!;
const l = new PgListener(URL, 'fh-test-live-changes');
let t: Awaited<ReturnType<typeof seedTenant>>;
let other: Awaited<ReturnType<typeof seedTenant>>;

/** Everything that arrives on a channel within `ms`. */
const collect = (channel: string, ms: number) =>
  new Promise<string[]>((resolve) => {
    const got: string[] = [];
    const off = l.on(channel, (p) => got.push(p));
    setTimeout(() => (off(), resolve(got)), ms);
  });

beforeAll(async () => {
  t = await seedTenant('livechg', 1);
  other = await seedTenant('livechg2', 1);
  for (const ch of [CHANGE_CHANNEL, EVENTS_CHANNEL]) l.on(ch, () => undefined);
  await l.start();
});
afterAll(async () => {
  await l.stop();
  await stopLiveHub();
  await app.$disconnect();
  await owner.$disconnect();
});

describe('changes are announced as they happen, not polled', () => {
  it('a change is announced when its transaction commits, and never when it rolls back', async () => {
    const got = collect(CHANGE_CHANNEL, 800);
    await withTenant(t.tenant.id, (tx) => announceChange(tx, t.tenant.id, 'lonework'));
    await withTenant(t.tenant.id, async (tx) => {
      await announceChange(tx, t.tenant.id, 'deck');
      throw new Error('rolled back');
    }).catch(() => undefined);
    expect((await got).map((p) => JSON.parse(p))).toEqual([{ tenantId: t.tenant.id, topic: 'lonework' }]);
  });

  it('recorded domain events wake the worker at commit (fh_events)', async () => {
    const got = collect(EVENTS_CHANNEL, 800);
    await withTenant(t.tenant.id, (tx) => recordEvents(tx, { type: 'shift.offer.denied', tenantId: t.tenant.id, offerId: randomUUID(), claimantId: t.users[0]!.id }));
    expect(await got).toContain(t.tenant.id);
  });

  it('a clock-in announces the deck topic (who is on duty changed)', async () => {
    const got = collect(CHANGE_CHANNEL, 800);
    await withTenant(t.tenant.id, (tx) => clockIn(tx, { tenantId: t.tenant.id, userId: t.users[0]!.id, facilityId: t.facility.id, positionId: t.position.id, location: null, ip: null }));
    expect((await got).map((p) => JSON.parse(p))).toContainEqual({ tenantId: t.tenant.id, topic: 'deck' });
  });

  it('a browser’s live stream carries its own organization’s changes only', async () => {
    await startLiveHub(URL);
    const server = createApp().listen(0);
    try {
      const port = (server.address() as AddressInfo).port;
      const token = await signAccessToken({ sub: t.users[0]!.id, tid: t.tenant.id, roles: ['STAFF'] });
      const ctl = new AbortController();
      const res = await fetch(`http://127.0.0.1:${port}/api/notifications/stream`, { headers: { authorization: `Bearer ${token}`, 'x-tenant-subdomain': 'livechg' }, signal: ctl.signal });
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
      // Another organization's change first, then ours: only ours may arrive.
      await withTenant(other.tenant.id, (tx) => announceChange(tx, other.tenant.id, 'lonework'));
      await withTenant(t.tenant.id, (tx) => announceChange(tx, t.tenant.id, 'deck'));
      await until(/event: change\ndata: \{"topic":"deck"\}/);
      expect(text).not.toContain('"topic":"lonework"');
      ctl.abort();
    } finally {
      server.close();
      await stopLiveHub();
    }
  });
});
