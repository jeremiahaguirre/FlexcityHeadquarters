import http from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { signAccessToken } from '../../src/auth/tokens.js';
import { app as appDb, owner, seedTenant } from './fixtures.js';

const server = createApp();
let t: Awaited<ReturnType<typeof seedTenant>>;
let token: string;

beforeAll(async () => {
  t = await seedTenant('zipped', 1);
  const u = t.users[0]!;
  token = await signAccessToken({ sub: u.id, tid: t.tenant.id, roles: ['STAFF'] });
  await owner.notification.createMany({ data: Array.from({ length: 40 }, (_, i) => ({ tenantId: t.tenant.id, userId: u.id, type: 'shift_available', params: { n: i, note: 'An open shift at the pool' }, link: '/board' })) });
});
afterAll(async () => {
  await appDb.$disconnect();
  await owner.$disconnect();
});

describe('response compression', () => {
  it('compresses large JSON answers when the browser accepts gzip', async () => {
    const r = await request(server).get('/api/notifications').set('x-tenant-subdomain', 'zipped').set('authorization', `Bearer ${token}`).set('accept-encoding', 'gzip');
    expect(r.status).toBe(200);
    expect(r.headers['content-encoding']).toBe('gzip');
    expect(r.headers['cache-control']).toContain('no-store');
  });

  it('leaves answers alone when the client asks for no compression', async () => {
    const r = await request(server).get('/api/notifications').set('x-tenant-subdomain', 'zipped').set('authorization', `Bearer ${token}`).set('accept-encoding', 'identity');
    expect(r.status).toBe(200);
    expect(r.headers['content-encoding']).toBeUndefined();
  });

  it('never compresses the live notification stream, so events arrive as they happen', async () => {
    const listening = server.listen(0);
    try {
      const { port } = listening.address() as AddressInfo;
      const first = await new Promise<{ encoding?: string; type?: string; chunk: string }>((resolve, reject) => {
        const req = http.get({ port, path: '/api/notifications/stream', headers: { 'x-tenant-subdomain': 'zipped', authorization: `Bearer ${token}`, 'accept-encoding': 'gzip, br' } }, (res) => {
          res.once('data', (c: Buffer) => {
            resolve({ encoding: res.headers['content-encoding'], type: res.headers['content-type'], chunk: c.toString('utf8') });
            req.destroy();
          });
        });
        req.on('error', reject);
      });
      expect(first.type).toContain('text/event-stream');
      expect(first.encoding).toBeUndefined();
      expect(first.chunk).toContain('event: ready');
    } finally {
      listening.close();
    }
  });
});
