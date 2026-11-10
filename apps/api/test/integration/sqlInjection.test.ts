/**
 * SQL injection: the classic payloads, thrown at the public and signed-in endpoints that take free
 * text, headers and path parameters. Each must be treated as plain data: a normal "not found" or
 * "invalid", never a server error, never more rows, and every table still there afterwards.
 */
import pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { resetLimits } from '../../src/auth/rateLimit.js';
import { signAccessToken } from '../../src/auth/tokens.js';
import { leastPrivilegeProblems, roleFacts } from '../../src/lib/dbRole.js';
import { app as appDb, owner, seedTenant } from './fixtures.js';

const server = createApp();
const SUB = 'sqlcity';
let t: Awaited<ReturnType<typeof seedTenant>>;
let hr = '';
const PAYLOADS = [
  "' OR '1'='1",
  "' OR 1=1 --",
  "admin'--",
  "'; DROP TABLE \"User\"; --",
  '" OR ""="',
  "1; SELECT pg_sleep(5)",
  "' UNION SELECT id, email, \"passwordHash\" FROM \"User\" --",
  "%' OR tenant_id IS NOT NULL --",
  '\\\'; DELETE FROM "Shift" WHERE \'a\'=\'a',
];

beforeAll(async () => {
  t = await seedTenant(SUB, 3);
  await owner.tenant.update({ where: { id: t.tenant.id }, data: { features: { programs: true } } });
  await seedTenant('sqlother', 2);
  const h = await owner.user.create({ data: { tenantId: t.tenant.id, roles: ['HR_ADMIN'], employmentStatus: 'FULL_TIME', firstName: 'H', lastName: 'R', email: `hr@${SUB}.test` } });
  hr = await signAccessToken({ sub: h.id, tid: t.tenant.id, roles: ['HR_ADMIN'], aat: Math.floor(Date.now() / 1000), mfa: true });
});
afterAll(async () => {
  await appDb.$disconnect();
  await owner.$disconnect();
});

describe('SQL injection payloads are only ever data', () => {
  it('sign-in with payloads as email and password: refused, never a server error', async () => {
    for (const p of PAYLOADS) {
      resetLimits();
      const r = await request(server).post('/api/auth/login').set('x-tenant-subdomain', SUB).send({ email: p, password: p });
      expect(r.status, p).toBeGreaterThanOrEqual(400);
      expect(r.status, p).toBeLessThan(500);
      expect(r.body.accessToken).toBeUndefined();
    }
  });

  it('the organization header and path parameters: not found, never another organization', async () => {
    for (const p of PAYLOADS) {
      const r = await request(server).get('/api/public/jobs').set('x-tenant-subdomain', p);
      expect(r.status, p).toBeGreaterThanOrEqual(400);
      expect(r.status, p).toBeLessThan(500);
      const j = await request(server).get(`/api/public/jobs/${encodeURIComponent(p)}`).set('x-tenant-subdomain', SUB);
      expect(j.status, p).toBeGreaterThanOrEqual(400);
      expect(j.status, p).toBeLessThan(500);
      const u = await request(server).get(`/api/users/${encodeURIComponent(p)}`).set('x-tenant-subdomain', SUB).auth(hr, { type: 'bearer' });
      expect(u.status, p).toBeGreaterThanOrEqual(400);
      expect(u.status, p).toBeLessThan(500);
    }
  });

  it('search boxes: payloads match nothing and never widen the results', async () => {
    const all = (await request(server).get('/api/users').set('x-tenant-subdomain', SUB).auth(hr, { type: 'bearer' })).body as Array<{ id: string }>;
    for (const p of PAYLOADS) {
      const r = await request(server).get(`/api/users?q=${encodeURIComponent(p)}`).set('x-tenant-subdomain', SUB).auth(hr, { type: 'bearer' });
      expect(r.status, p).toBeLessThan(500);
      if (r.status === 200) {
        expect(r.body.length, p).toBeLessThanOrEqual(all.length);
        expect((r.body as Array<{ email?: string }>).every((x) => !x.email?.endsWith('@sqlother.test')), p).toBe(true);
      }
    }
  });

  it('the website enquiry form stores payloads verbatim, as text', async () => {
    resetLimits();
    const name = "Robert'); DROP TABLE \"Lead\"; --";
    const r = await request(server).post('/api/marketing/leads').set('origin', 'http://localhost:3100').send({ kind: 'DEMO', name, email: 'bobby@tables.example', organization: "' OR 1=1 --", province: 'BC', facilities: 1, message: "1; SELECT pg_sleep(5) -- please call", locale: 'en-CA', marketingConsent: false });
    expect(r.status).toBe(201);
    const saved = await owner.lead.findFirstOrThrow({ where: { email: 'bobby@tables.example' } });
    expect(saved.name).toBe(name);
    expect(saved.organization).toBe("' OR 1=1 --");
  });

  it('every table is still there, with its rows', async () => {
    expect(await owner.user.count({ where: { tenantId: t.tenant.id } })).toBe(4);
    expect(await owner.lead.count()).toBeGreaterThan(0);
    expect(await owner.shift.count()).toBeGreaterThanOrEqual(0);
  });
});

describe('if a query were ever subverted, the database role limits the damage', () => {
  it('the app role is least-privilege: no superuser, no RLS bypass, no schema rights', async () => {
    expect(leastPrivilegeProblems(await roleFacts(process.env.APP_DATABASE_URL!))).toEqual([]);
    expect(leastPrivilegeProblems(await roleFacts(process.env.DATABASE_URL!)).length).toBeGreaterThan(0);
  });

  it('it can’t create or drop tables, make temporary tables, or run without a time limit', async () => {
    const c = new pg.Client({ connectionString: process.env.APP_DATABASE_URL });
    await c.connect();
    try {
      await expect(c.query('CREATE TABLE public.injected (x int)')).rejects.toThrow(/permission denied/);
      await expect(c.query('CREATE TEMP TABLE injected (x int)')).rejects.toThrow(/permission denied/);
      await expect(c.query('DROP TABLE "User"')).rejects.toThrow(/must be owner|permission denied/);
      await expect(c.query('DELETE FROM "User"')).rejects.toThrow(/permission denied/);
      expect((await c.query('SHOW statement_timeout')).rows[0].statement_timeout).toBe('2min');
      // Without a city chosen, row-level security shows nothing at all.
      expect((await c.query('SELECT count(*)::int AS n FROM "User"')).rows[0].n).toBe(0);
    } finally {
      await c.end();
    }
  });
});
