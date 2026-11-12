import request from 'supertest';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { config } from '../../src/config.js';
import { app as appDb, owner } from './fixtures.js';

const server = createApp();
afterEach(() => {
  config().MIN_WEB_VERSION = undefined;
});
afterAll(async () => {
  await appDb.$disconnect();
  await owner.$disconnect();
});

describe('app version', () => {
  it('every answer names the build, and /api/version says which web builds are served', async () => {
    const r = await request(server).get('/api/version');
    expect(r.status).toBe(200);
    expect(r.headers['x-fh-version']).toBe(r.body.version);
    expect(r.body.minWebVersion).toBeNull();
    expect((await request(server).get('/healthz')).headers['x-fh-version']).toBeTruthy();
  });

  it('a web build older than MIN_WEB_VERSION gets 426 CLIENT_OUTDATED before any work is done', async () => {
    config().MIN_WEB_VERSION = '202611121530';
    const old = await request(server).post('/api/auth/login').set('x-tenant-subdomain', 'nowhere').set('X-FH-Client', 'web/202611010000.old').send({ email: 'a@b.ca', password: 'x' });
    expect(old.status).toBe(426);
    expect(old.body.code).toBe('CLIENT_OUTDATED');
    expect(old.body.minWebVersion).toBe('202611121530');
    // The version check and error reports stay open to it.
    expect((await request(server).get('/api/version').set('X-FH-Client', 'web/202611010000.old')).status).toBe(200);
    // New builds, dev builds and clients without the header go through.
    for (const h of ['web/202611121530.new', 'web/dev', null]) {
      const req = request(server).post('/api/auth/login').set('x-tenant-subdomain', 'nowhere');
      const r = await (h ? req.set('X-FH-Client', h) : req).send({ email: 'a@b.ca', password: 'x' });
      expect(r.status).not.toBe(426);
    }
    // The Dev console is a web build too.
    expect((await request(server).get('/api/platform/me').set('x-fh-platform', '1').set('X-FH-Client', 'web/202611010000.old')).status).toBe(426);
  });
});
