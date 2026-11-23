import { randomBytes } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { signAccessToken } from '../../src/auth/tokens.js';
import { closeUnionHub } from '../../src/routes/union.js';
import { forgetFeatures } from '../../src/services/platform/features.js';
import { createUnionApp } from '../../src/unionApp.js';
import { app as appDb, owner, seedTenant } from './fixtures.js';

process.env.LOCAL_KEK_BASE64 ||= randomBytes(32).toString('base64');
// Always the test database's union role (a local .env may point elsewhere).
process.env.UNION_DATABASE_URL = process.env.APP_DATABASE_URL!.replace('flexcity_app', 'flexcity_union');
const server = createApp();
const SUB = 'xi';
let t: Awaited<ReturnType<typeof seedTenant>>;
let other: Awaited<ReturnType<typeof seedTenant>>;
let localId: string;
let steward: string;
let member: string;
let hr: string;
const call = (token: string, sub = SUB) => ({
  get: (p: string) => request(server).get(p).set('x-tenant-subdomain', sub).auth(token, { type: 'bearer' }),
  post: (p: string, b: object) => request(server).post(p).set('x-tenant-subdomain', sub).auth(token, { type: 'bearer' }).send(b),
});

beforeAll(async () => {
  t = await seedTenant(SUB, 2);
  await owner.tenant.update({ where: { id: t.tenant.id }, data: { features: { union: true } } });
  other = await seedTenant('omicron', 1);
  await owner.tenant.update({ where: { id: other.tenant.id }, data: { features: { union: true } } });
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  localId = (await db.query("INSERT INTO union_hub.local (tenant_id, name, kek_id) VALUES ($1, 'CUPE Local 338', 'local:cupe338') RETURNING id", [t.tenant.id])).rows[0].id;
  await db.query('INSERT INTO union_hub.member_access (local_id, user_id, is_steward) VALUES ($1, $2, true)', [localId, t.users[0]!.id]);
  await db.end();
  const h = await owner.user.create({ data: { tenantId: t.tenant.id, roles: ['HR_ADMIN'], employmentStatus: 'FULL_TIME', firstName: 'H', lastName: 'R', email: 'hr@xi.test' } });
  steward = await signAccessToken({ sub: t.users[0]!.id, tid: t.tenant.id, roles: ['STAFF', 'UNION_STEWARD'] });
  member = await signAccessToken({ sub: t.users[1]!.id, tid: t.tenant.id, roles: ['STAFF'] });
  hr = await signAccessToken({ sub: h.id, tid: t.tenant.id, roles: ['HR_ADMIN'] });
});
afterAll(async () => {
  await closeUnionHub();
  await appDb.$disconnect();
  await owner.$disconnect();
});

describe('union hub', () => {
  let threadId: string;

  it('a steward sees their local, starts a thread and adds a member', async () => {
    expect((await call(steward).get('/api/union/locals')).body).toEqual([{ id: localId, name: 'CUPE Local 338', isSteward: true }]);
    const th = await call(steward).post(`/api/union/locals/${localId}/threads`, { title: 'Summer schedule concerns', body: 'Post concerns about split shifts here.' });
    expect(th.status).toBe(201);
    threadId = th.body.id;
    expect((await call(member).get(`/api/union/locals/${localId}/threads`)).status).toBe(403);
    expect((await call(steward).post(`/api/union/locals/${localId}/members`, { userId: t.users[1]!.id })).status).toBe(204);
  });

  it('members read and reply; messages are stored encrypted', async () => {
    expect((await call(member).post(`/api/union/locals/${localId}/threads/${threadId}/messages`, { body: 'Agreed, the 6–10 / 4–8 split is hard.' })).status).toBe(201);
    const thread = await call(member).get(`/api/union/locals/${localId}/threads/${threadId}`);
    expect(thread.body.map((m: { body: string }) => m.body)).toEqual(['Post concerns about split shifts here.', 'Agreed, the 6–10 / 4–8 split is hard.']);
    expect(thread.body.map((m: { authorName: string }) => m.authorName)).toEqual(['Guard0 xi', 'Guard1 xi']);
    const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();
    const raw = await db.query('SELECT ciphertext FROM union_hub.message');
    await db.end();
    expect(raw.rows.some((r) => Buffer.from(r.ciphertext).toString('utf8').includes('split'))).toBe(false);
  });

  it('employer roles without membership are refused, and other organizations never see the local', async () => {
    expect((await call(hr).get(`/api/union/locals/${localId}/threads`)).status).toBe(403);
    expect((await call(hr).get('/api/union/locals')).body).toEqual([]);
    const outsider = await signAccessToken({ sub: other.users[0]!.id, tid: other.tenant.id, roles: ['STAFF'] });
    expect((await call(outsider, 'omicron').get(`/api/union/locals/${localId}/threads`)).status).toBe(403);
  });

  it('only stewards add members, and only from their own organization', async () => {
    expect((await call(member).post(`/api/union/locals/${localId}/members`, { userId: t.users[1]!.id })).status).toBe(403);
    expect((await call(steward).post(`/api/union/locals/${localId}/members`, { userId: other.users[0]!.id })).status).toBe(403);
  });

  it('gives stewards, and only stewards, their organization’s staff to pick from', async () => {
    const dir = await call(steward).get(`/api/union/locals/${localId}/directory`);
    expect(dir.body.find((p: { id: string }) => p.id === t.users[1]!.id)).toMatchObject({ member: true, isSteward: false });
    expect(dir.body.some((p: { id: string }) => p.id === other.users[0]!.id)).toBe(false);
    expect((await call(member).get(`/api/union/locals/${localId}/directory`)).status).toBe(403);
  });

  it('shows the seniority roster to members', async () => {
    await owner.user.update({ where: { id: t.users[1]!.id }, data: { unionMember: true, seniorityDate: new Date('2019-05-01') } });
    const r = await call(member).get(`/api/union/locals/${localId}/seniority`);
    expect(r.body.map((x: { first_name: string }) => x.first_name)).toEqual(['Guard1']);
  });
});

describe('Union Hub as its own service', () => {
  // The main API, listening, in separate mode: the hub checks every sign-in there (lib/unionAccess.ts).
  let api: Server;
  let apiUrl = '';
  const checks: string[] = [];
  let unionServer: ReturnType<typeof createUnionApp>;
  const viaService = (token: string) => request(unionServer).get(`/api/union/locals/${localId}/threads`).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' });

  beforeAll(async () => {
    const main = createApp();
    const counted = express();
    counted.use((req, _res, next) => {
      if (req.header('x-fh-union-check')) checks.push(`${req.method} ${req.originalUrl}`);
      next();
    });
    counted.use(main);
    api = counted.listen(0);
    apiUrl = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
    unionServer = createUnionApp({ apiUrl });
    process.env.UNION_HUB_MODE = 'separate';
  });
  afterAll(() => {
    delete process.env.UNION_HUB_MODE;
    api.close();
  });

  it('answers the hub with the same sign-in, checked by the main API, and nothing else', async () => {
    checks.length = 0;
    const r = await viaService(steward);
    expect(r.status).toBe(200);
    expect(r.body.length).toBeGreaterThan(0);
    // The API was asked, with the request's own method and path (review of #75).
    expect(checks).toEqual([`GET /api/union/locals/${localId}/threads`]);
    expect((await request(unionServer).get('/api/union/locals').set('x-tenant-subdomain', SUB).auth(steward, { type: 'bearer' })).body[0]).toMatchObject({ id: localId, isSteward: true });
    // Membership still decides, here too.
    expect((await viaService(hr)).status).toBe(403);
    const anon = await request(unionServer).get(`/api/union/locals/${localId}/threads`).set('x-tenant-subdomain', SUB);
    expect(anon.status).toBe(401);
    expect(anon.body.code).toBe('UNAUTHENTICATED');
    // Not a second door into the main API.
    expect((await request(unionServer).get('/api/me').set('x-tenant-subdomain', SUB).auth(steward, { type: 'bearer' })).status).toBe(404);
    expect((await request(unionServer).get('/healthz')).body).toMatchObject({ service: 'union-hub' });
  });

  it('the main API’s checks apply: a deactivated person, another organization’s token, the feature off', async () => {
    const gone = await owner.user.create({ data: { tenantId: t.tenant.id, roles: ['STAFF'], employmentStatus: 'FULL_TIME', status: 'TERMINATED', firstName: 'Gone', lastName: 'Away', email: `gone-${randomBytes(3).toString('hex')}@xi.test` } });
    const goneToken = await signAccessToken({ sub: gone.id, tid: t.tenant.id, roles: ['STAFF'] });
    const r = await viaService(goneToken);
    expect(r.status).toBe(401);
    expect(r.body.code).toBe('ACCOUNT_INACTIVE');
    // A token from another organization, on this organization's host.
    const elsewhere = await signAccessToken({ sub: other.users[0]!.id, tid: other.tenant.id, roles: ['STAFF'] });
    expect((await viaService(elsewhere)).status).toBe(403);
    // The union feature switched off for the organization.
    await owner.tenant.update({ where: { id: other.tenant.id }, data: { features: { union: false } } });
    await forgetFeatures(other.tenant.id);
    try {
      const off = await request(unionServer).get('/api/union/locals').set('x-tenant-subdomain', 'omicron').auth(elsewhere, { type: 'bearer' });
      expect(off.status).toBe(404);
      expect(off.body.code).toBe('FEATURE_OFF');
    } finally {
      await owner.tenant.update({ where: { id: other.tenant.id }, data: { features: { union: true } } });
      await forgetFeatures(other.tenant.id);
    }
  });

  it('without the main API the hub refuses, rather than deciding on its own', async () => {
    const down = createUnionApp({ apiUrl: 'http://127.0.0.1:9', timeoutMs: 1000 });
    const r = await request(down).get(`/api/union/locals/${localId}/threads`).set('x-tenant-subdomain', SUB).auth(steward, { type: 'bearer' });
    expect(r.status).toBe(503);
    expect(r.body.code).toBe('BUSY');
  });

  it('the main API stops answering for the hub once it runs separately, except the hub’s check', async () => {
    const r = await call(steward).get('/api/union/locals');
    expect(r.status).toBe(404);
    expect(r.body.code).toBe('UNION_ELSEWHERE');
    // The check answers who and which organization, nothing more.
    const c = await call(steward).get('/api/union/locals').set('x-fh-union-check', '1');
    expect(c.status).toBe(200);
    expect(Object.keys(c.body).sort()).toEqual(['authenticatedAt', 'mfa', 'permissions', 'roles', 'tenantId', 'userId']);
    expect(c.body).toMatchObject({ userId: t.users[0]!.id, tenantId: t.tenant.id });
    delete process.env.UNION_HUB_MODE;
    try {
      expect((await call(steward).get('/api/union/locals')).status).toBe(200);
    } finally {
      process.env.UNION_HUB_MODE = 'separate';
    }
  });
});

