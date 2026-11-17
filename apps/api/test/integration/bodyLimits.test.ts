/** Large request bodies are read only after authentication (SECURITY-AUDIT SEC-47). */
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { hashPassword, signAccessToken } from '../../src/auth/tokens.js';
import { owner, seedTenant } from './fixtures.js';

const server = createApp();
const SUB = 'bodylimits';
let t: Awaited<ReturnType<typeof seedTenant>>;
let token = '';

// Not JSON: if the server parses it, it answers 400; if it refuses before reading, 401 or 413.
const junk = (bytes: number) => `{"x":"${'a'.repeat(bytes)}`;

beforeAll(async () => {
  t = await seedTenant(SUB, 1);
  token = await signAccessToken({ sub: t.users[0]!.id, tid: t.tenant.id, roles: ['STAFF'], aat: Math.floor(Date.now() / 1000) });
});

afterAll(async () => {
  await owner.$disconnect();
});

describe('large bodies before authentication', () => {
  it('an anonymous upload is refused before its megabytes are parsed', async () => {
    const r = await request(server).post('/api/me/documents').set('x-tenant-subdomain', SUB).set('content-type', 'application/json').send(junk(1_000_000));
    expect(r.status).toBe(401);
    expect(r.body.code).toBe('UNAUTHENTICATED');
  });

  it('a forged or expired token is refused the same way', async () => {
    const r = await request(server).post(`/api/messages/conversations/${t.tenant.id}/messages`).set('x-tenant-subdomain', SUB).set('authorization', 'Bearer not.a.token').set('content-type', 'application/json').send(junk(500_000));
    expect(r.status).toBe(401);
  });

  it('a signed-in person still gets the large limit', async () => {
    const r = await request(server).post('/api/me/documents').set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }).set('content-type', 'application/json').send(junk(1_000_000));
    // Read and parsed (then refused as malformed JSON), not cut off at 100 kB.
    expect(r.status).toBe(400);
  });

  it('the Dev console reads more than 100 kB only with its session cookie', async () => {
    const anon = await request(server).post('/api/platform/auth/login').set('x-fh-platform', '1').set('content-type', 'application/json').send(junk(200_000));
    expect(anon.status).toBe(413);
    const noHeader = await request(server).post('/api/platform/auth/login').set('content-type', 'application/json').send(junk(200_000));
    expect(noHeader.status).toBe(413);
    // A small request without the header is still refused by the header check.
    const small = await request(server).post('/api/platform/auth/login').set('content-type', 'application/json').send({ email: 'x@example.ca', password: 'x' });
    expect(small.status).toBe(403);
  });

  it('a made-up console cookie gets the 100 kB limit; only a live session gets more (review of #67)', async () => {
    const forged = (path: string, bytes: number) => request(server).post(path).set('x-fh-platform', '1').set('Cookie', 'fh_platform=forged').set('content-type', 'application/json').send(junk(bytes));
    expect((await forged('/api/platform/auth/login', 200_000)).status).toBe(413);
    expect((await forged('/api/platform/trust/evidence', 1_500_000)).status).toBe(413);
    // A signed-in console session: 1.5 MB is read and parsed (then refused as malformed JSON).
    const email = `dev-bodylimits@flexcity.dev`;
    await owner.platformAdmin.create({ data: { email, name: 'Body Limits', passwordHash: await hashPassword('correct horse battery') } });
    const login = await request(server).post('/api/platform/auth/login').set('x-fh-platform', '1').send({ email, password: 'correct horse battery' });
    expect(login.status).toBe(200);
    const cookie = String(login.headers['set-cookie']).split(';')[0]!;
    const live = await request(server).post('/api/platform/tenants').set('x-fh-platform', '1').set('Cookie', cookie).set('content-type', 'application/json').send(junk(1_500_000));
    expect(live.status).toBe(400);
    // Signed out: the same cookie is back to 100 kB.
    await request(server).post('/api/platform/auth/logout').set('x-fh-platform', '1').set('Cookie', cookie).send({});
    const after = await request(server).post('/api/platform/tenants').set('x-fh-platform', '1').set('Cookie', cookie).set('content-type', 'application/json').send(junk(200_000));
    expect(after.status).toBe(413);
  });
});
