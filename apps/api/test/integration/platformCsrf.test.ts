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

  it('the check runs before the body is parsed: malformed or oversized JSON from another site is refused, not read', async () => {
    const malformed = await request(server).post('/api/platform/auth/login').set('Sec-Fetch-Site', 'cross-site').set('Content-Type', 'application/json').send('{"email":');
    expect([malformed.status, malformed.body.code]).toEqual([403, 'CSRF_REFUSED']);
    const noHeader = await request(server).post('/api/platform/auth/login').set('Content-Type', 'application/json').send('{"email":');
    expect([noHeader.status, noHeader.body.code]).toEqual([403, 'CSRF_REFUSED']);
    const big = await request(server).post('/api/platform/tenants').set('Cookie', cookie).set('Content-Type', 'application/json').send(JSON.stringify({ pad: 'x'.repeat(3 * 1024 * 1024) }));
    expect([big.status, big.body.code]).toEqual([403, 'CSRF_REFUSED']);
    // With the header the same malformed body reaches the parser (400), so the order is what's tested.
    expect((await request(server).post('/api/platform/auth/login').set('x-fh-platform', '1').set('Content-Type', 'application/json').send('{"email":')).status).toBe(400);
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

  it('a browser signed in holds a readable CSRF token, and must echo it (double submit)', async () => {
    const login = await request(server).post('/api/platform/auth/login').set('x-fh-platform', '1').send({ email, password: 'right password!' });
    const all = login.headers['set-cookie'] as unknown as string[];
    const session = all.find((c) => c.startsWith('fh_platform='))!.split(';')[0]!;
    const csrfCookie = all.find((c) => c.startsWith('fh_csrf='))!;
    expect(csrfCookie).toMatch(/SameSite=Strict/i);
    expect(csrfCookie).not.toMatch(/HttpOnly/i);
    expect(csrfCookie).toMatch(/Path=\//i);
    const token = csrfCookie.split(';')[0]!.slice('fh_csrf='.length);
    const both = `${session}; fh_csrf=${token}`;
    // The cookies alone, or a wrong token, are refused; the right token is accepted.
    const none = await request(server).get('/api/platform/tenants').set('x-fh-platform', '1').set('Cookie', both);
    expect([none.status, none.body.code]).toEqual([403, 'CSRF_REFUSED']);
    expect((await request(server).get('/api/platform/tenants').set('x-fh-platform', '1').set('x-fh-csrf', 'guess').set('Cookie', both)).status).toBe(403);
    expect((await request(server).get('/api/platform/tenants').set('x-fh-platform', '1').set('x-fh-csrf', token).set('Cookie', both)).status).toBe(200);
    // Signing out clears both.
    const out = await request(server).post('/api/platform/auth/logout').set('x-fh-platform', '1').set('x-fh-csrf', token).set('Cookie', both).send({});
    expect(out.status).toBe(204);
    expect(String(out.headers['set-cookie'])).toMatch(/fh_csrf=;/);
  });

  it('answers no CORS preflight, so another origin’s script can’t add the header', async () => {
    const r = await request(server).options('/api/platform/tenants').set('Origin', 'https://evil.example').set('Access-Control-Request-Method', 'POST').set('Access-Control-Request-Headers', 'x-fh-platform');
    expect(r.headers['access-control-allow-origin']).toBeUndefined();
    expect(r.headers['access-control-allow-headers']).toBeUndefined();
  });
});
