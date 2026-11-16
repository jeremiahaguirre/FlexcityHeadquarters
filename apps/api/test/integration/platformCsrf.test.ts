/**
 * The Dev console's session is a cookie (fh_platform), so every console request must prove it came
 * from the console's own page, not from another site riding on that cookie:
 * - the cookie is HTTP-only, SameSite=Strict and scoped to /api/platform;
 * - every request carries `x-fh-platform: 1`, which a cross-site form or link can't send, and a
 *   cross-origin script can't either without a CORS preflight this API never answers;
 * - a request a browser marks as cross-site or same-site but cross-origin (Sec-Fetch-Site) is refused;
 * - bodies are JSON only, so a form post isn't even parsed.
 */
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { hashPassword } from '../../src/auth/tokens.js';
import { owner } from './fixtures.js';

const server = createApp();
const email = `csrf-${Date.now()}@fh.test`;
let cookie = '';

beforeAll(async () => {
  await owner.platformAdmin.create({ data: { email, name: 'CSRF check', passwordHash: await hashPassword('right password!') } });
  const login = await request(server).post('/api/platform/auth/login').set('x-fh-platform', '1').set('Sec-Fetch-Site', 'same-origin').send({ email, password: 'right password!' });
  expect(login.status).toBe(200);
  cookie = String(login.headers['set-cookie']).split(';')[0]!;
});
afterAll(async () => {
  await owner.$disconnect();
});

describe('Dev console CSRF defence', () => {
  it('the session cookie is HTTP-only, SameSite=Strict and only sent to /api/platform', async () => {
    const login = await request(server).post('/api/platform/auth/login').set('x-fh-platform', '1').send({ email, password: 'right password!' });
    const set = String(login.headers['set-cookie']);
    expect(set).toMatch(/HttpOnly/i);
    expect(set).toMatch(/SameSite=Strict/i);
    expect(set).toMatch(/Path=\/api\/platform/i);
  });

  it('refuses a state-changing request without the console header, even with the cookie', async () => {
    const r = await request(server).post('/api/platform/auth/logout').set('Cookie', cookie).send({});
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('CSRF_REFUSED');
  });

  it('refuses a request the browser marks as coming from another site or origin', async () => {
    for (const site of ['cross-site', 'same-site']) {
      const r = await request(server).get('/api/platform/tenants').set('x-fh-platform', '1').set('Cookie', cookie).set('Sec-Fetch-Site', site);
      expect(r.status, site).toBe(403);
      expect(r.body.code, site).toBe('CSRF_REFUSED');
    }
    const post = await request(server).post('/api/platform/auth/logout').set('x-fh-platform', '1').set('Cookie', cookie).set('Sec-Fetch-Site', 'cross-site').send({});
    expect(post.status).toBe(403);
  });

  it('a form post (the only body a cross-site page can send without a preflight) is refused, never parsed', async () => {
    const r = await request(server).post('/api/platform/auth/login').type('form').send({ email, password: 'right password!' });
    expect(r.status).toBe(403);
    expect(r.headers['set-cookie']).toBeUndefined();
  });

  it('the console’s own requests still work: same-origin, or a client that sends no fetch metadata', async () => {
    expect((await request(server).get('/api/platform/tenants').set('x-fh-platform', '1').set('Cookie', cookie).set('Sec-Fetch-Site', 'same-origin')).status).toBe(200);
    expect((await request(server).get('/api/platform/tenants').set('x-fh-platform', '1').set('Cookie', cookie)).status).toBe(200);
  });

  it('answers no CORS preflight, so another origin’s script can’t add the header', async () => {
    const r = await request(server).options('/api/platform/tenants').set('Origin', 'https://evil.example').set('Access-Control-Request-Method', 'POST').set('Access-Control-Request-Headers', 'x-fh-platform');
    expect(r.headers['access-control-allow-origin']).toBeUndefined();
    expect(r.headers['access-control-allow-headers']).toBeUndefined();
  });
});
