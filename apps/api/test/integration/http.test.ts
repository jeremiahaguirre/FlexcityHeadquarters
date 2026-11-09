import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { hashPassword } from '../../src/auth/tokens.js';
import { app as appDb, owner, seedOpenOffer, seedTenant } from './fixtures.js';

const server = createApp();
let t: Awaited<ReturnType<typeof seedTenant>>;
let other: Awaited<ReturnType<typeof seedTenant>>;

beforeAll(async () => {
  t = await seedTenant('delta', 1);
  other = await seedTenant('epsilon', 1);
  const hash = await hashPassword('correct horse battery staple');
  await owner.user.updateMany({ where: { id: { in: [t.users[0]!.id, other.users[0]!.id] } }, data: { passwordHash: hash } });
});
afterAll(async () => {
  await appDb.$disconnect();
  await owner.$disconnect();
});

const login = (sub: string, email: string, password = 'correct horse battery staple') =>
  request(server).post('/api/auth/login').set('x-tenant-subdomain', sub).send({ email, password });

describe('HTTP API', () => {
  it('serves public branding by subdomain without leaking private fields', async () => {
    const r = await request(server).get('/api/public/tenant').set('x-tenant-subdomain', 'delta');
    expect(r.status).toBe(200);
    expect(Object.keys(r.body).sort()).toEqual(['defaultLocale', 'id', 'logoUrl', 'name', 'themeColors']);
  });

  it('rejects bad credentials with a generic message', async () => {
    const r = await login('delta', 'guard0@delta.test', 'wrong');
    expect(r.status).toBe(401);
    expect(r.body.code).toBe('INVALID_CREDENTIALS');
  });

  it('logs in, sets an HTTP-only refresh cookie, and claims a shift', async () => {
    const r = await login('delta', 'guard0@delta.test');
    expect(r.status).toBe(200);
    expect(r.headers['set-cookie']?.[0]).toMatch(/HttpOnly/);

    const { offer } = await seedOpenOffer(t, 4);
    const board = await request(server).get('/api/shiftboard/offers').set('x-tenant-subdomain', 'delta').auth(r.body.accessToken, { type: 'bearer' });
    expect(board.body.map((o: { id: string }) => o.id)).toContain(offer.id);

    const c = await request(server).post(`/api/offers/${offer.id}/claim`).set('x-tenant-subdomain', 'delta').auth(r.body.accessToken, { type: 'bearer' }).send({});
    expect(c.status).toBe(200);
    expect(c.body.outcome).toBe('ASSIGNED');
  });

  it('rotates refresh tokens and revokes the family on reuse', async () => {
    const r = await login('delta', 'guard0@delta.test');
    const cookie = r.headers['set-cookie']![0]!.split(';')[0]!;
    const first = await request(server).post('/api/auth/refresh').set('x-tenant-subdomain', 'delta').set('Cookie', cookie);
    expect(first.status).toBe(200);
    const replay = await request(server).post('/api/auth/refresh').set('x-tenant-subdomain', 'delta').set('Cookie', cookie);
    expect(replay.status).toBe(401);
    const newCookie = first.headers['set-cookie']![0]!.split(';')[0]!;
    const afterTheft = await request(server).post('/api/auth/refresh').set('x-tenant-subdomain', 'delta').set('Cookie', newCookie);
    expect(afterTheft.status).toBe(401);
  });

  it('refuses a token from another organization', async () => {
    const r = await login('epsilon', 'guard0@epsilon.test');
    const x = await request(server).get('/api/shiftboard/offers').set('x-tenant-subdomain', 'delta').auth(r.body.accessToken, { type: 'bearer' });
    expect(x.status).toBe(403);
  });

  it('enforces permissions (staff cannot export payroll)', async () => {
    const r = await login('delta', 'guard0@delta.test');
    const x = await request(server).get('/api/payroll/export?periodStart=2026-07-05&weeks=2').set('x-tenant-subdomain', 'delta').auth(r.body.accessToken, { type: 'bearer' });
    expect(x.status).toBe(403);
  });
});
