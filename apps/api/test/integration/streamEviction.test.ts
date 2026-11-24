/** Past PER_USER live streams for one person, the oldest is closed with an `evicted` event (SEC-70, review of #67). */
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { signAccessToken } from '../../src/auth/tokens.js';
import { PER_USER } from '../../src/lib/streamSlots.js';
import { app as appDb, owner, seedTenant } from './fixtures.js';

let t: Awaited<ReturnType<typeof seedTenant>>;
let token: string;

beforeAll(async () => {
  t = await seedTenant('evicted', 1);
  token = await signAccessToken({ sub: t.users[0]!.id, tid: t.tenant.id, roles: ['STAFF'] });
});
afterAll(async () => {
  await appDb.$disconnect();
  await owner.$disconnect();
});

describe('live stream limit per person', () => {
  it('the oldest stream is told it was evicted before it ends, so its tab waits instead of reconnecting at once', async () => {
    const server = createApp().listen(0);
    const ctl = new AbortController();
    try {
      const { port } = server.address() as AddressInfo;
      const open = async () => {
        const res = await fetch(`http://127.0.0.1:${port}/api/notifications/stream`, { headers: { authorization: `Bearer ${token}`, 'x-tenant-subdomain': 'evicted' }, signal: ctl.signal });
        expect(res.status).toBe(200);
        return res.body!.getReader();
      };
      const dec = new TextDecoder();
      /** Everything the stream sends until it ends. */
      const readAll = async (r: ReadableStreamDefaultReader<Uint8Array>) => {
        let text = '';
        for (;;) {
          const { value, done } = await r.read();
          if (done) return text;
          text += dec.decode(value, { stream: true });
        }
      };
      const oldest = await open();
      const rest = [];
      for (let i = 0; i < PER_USER - 1; i++) rest.push(await open());
      const ended = readAll(oldest);
      rest.push(await open()); // one past the limit
      const text = await ended;
      expect(text).toContain('event: ready');
      expect(text).toMatch(/event: evicted\ndata: \{\}\n\n$/);
    } finally {
      ctl.abort();
      server.close();
    }
  });
});
