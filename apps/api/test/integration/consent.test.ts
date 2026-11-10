import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { resetLimits } from '../../src/auth/rateLimit.js';
import { hashPassword, signAccessToken } from '../../src/auth/tokens.js';
import { CONSENT_VERSION } from '../../src/services/privacy/consent.js';
import { app as appDb, owner, seedTenant } from './fixtures.js';

const server = createApp();
const SUB = 'consentcity';
let t: Awaited<ReturnType<typeof seedTenant>>;
let tok = '';
const as = (token: string) => ({
  get: (p: string) => request(server).get(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }),
  post: (p: string, b: object = {}) => request(server).post(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }).send(b),
});
// A tiny real PNG (1x1), padded past the minimum size with a text chunk.
const png = (() => {
  const head = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489', 'hex');
  const pad = Buffer.alloc(200, 0x20);
  const tail = Buffer.from('0000000d4944415478da63f8ffff3f0005fe02fea7d5a2a40000000049454e44ae426082', 'hex');
  return `data:image/png;base64,${Buffer.concat([head, tail, pad]).toString('base64')}`;
})();
const body = (over: object = {}) => ({ version: CONSENT_VERSION, locale: 'en-CA', name: 'Guard Zero', signature: png, choices: { notifications: 'granted', location: 'denied' }, ...over });

beforeAll(async () => {
  process.env.CONSENT_ENFORCEMENT = 'on';
  t = await seedTenant(SUB, 1);
  tok = await signAccessToken({ sub: t.users[0]!.id, tid: t.tenant.id, roles: ['EMPLOYEE'], aat: Math.floor(Date.now() / 1000) });
});
afterAll(async () => {
  process.env.CONSENT_ENFORCEMENT = 'off';
  await owner.$disconnect();
  await appDb.$disconnect();
});

describe('first-sign-in consent agreement', () => {
  it('is required until signed, then stored with fingerprints and the device', async () => {
    expect((await as(tok).get('/api/me')).body.consentRequired).toBe(true);
    // The server holds everything else back until it's signed.
    const held = await as(tok).get('/api/notifications');
    expect(held.status).toBe(428);
    expect(held.body.code).toBe('CONSENT_REQUIRED');
    expect((await as(tok).get('/api/push/key')).status).toBe(200);
    const c = await as(tok).get('/api/me/consent?lang=fr-CA');
    expect(c.body).toMatchObject({ required: true, version: CONSENT_VERSION, locale: 'fr-CA' });
    expect(c.body.agreement.sections.length).toBeGreaterThan(3);

    expect((await as(tok).post('/api/me/consent', body({ version: '2001-01-01' }))).status).toBe(409);
    expect((await as(tok).post('/api/me/consent', body({ signature: 'data:image/png;base64,AAAA' }))).status).toBe(400);
    const r = await as(tok).post('/api/me/consent', body()).set('user-agent', 'TestPhone/1.0');
    expect(r.status).toBe(201);
    expect(r.body.textSha256).toMatch(/^[0-9a-f]{64}$/);
    const saved = await owner.consentRecord.findFirstOrThrow({ where: { userId: t.users[0]!.id } });
    expect(saved).toMatchObject({ version: CONSENT_VERSION, signedName: 'Guard Zero', userAgent: 'TestPhone/1.0', choices: { notifications: 'granted', location: 'denied' } });
    expect((await as(tok).get('/api/me')).body.consentRequired).toBe(false);
    expect((await as(tok).get('/api/notifications')).status).toBe(200);
  });

  it('cannot be altered by the application', async () => {
    const rec = await owner.consentRecord.findFirstOrThrow({ where: { userId: t.users[0]!.id } });
    await expect(
      appDb.$transaction(async (tx) => {
        await tx.$executeRaw`select set_config('app.tenant_id', ${t.tenant.id}, true)`;
        await tx.$executeRaw`update "ConsentRecord" set "signedName" = 'Someone else' where id = ${rec.id}::uuid`;
      }),
    ).rejects.toThrow(/permission denied/);
  });

  it('is listed, exported and certified in the Dev console, with each access logged', async () => {
    const email = `consent-${randomBytes(3).toString('hex')}@flexcity.dev`;
    const admin = await owner.platformAdmin.create({ data: { email, name: 'C', passwordHash: await hashPassword('right password!') } });
    resetLimits();
    const login = await request(server).post('/api/platform/auth/login').set('x-fh-platform', '1').send({ email, password: 'right password!' });
    const cookie = String(login.headers['set-cookie']).split(';')[0]!;
    const p = (path: string) => request(server).get(`/api/platform${path}`).set('x-fh-platform', '1').set('Cookie', cookie);
    const list = await p(`/tenants/${t.tenant.id}/consents`);
    expect(list.status).toBe(200);
    expect(list.body).toMatchObject({ currentVersion: CONSENT_VERSION, signedCurrent: 1 });
    expect(list.body.records[0]).toMatchObject({ person: `Guard0 ${SUB}`, signedName: 'Guard Zero' });
    const csv = await p(`/tenants/${t.tenant.id}/consents.csv`);
    expect(csv.text).toContain('Guard Zero');
    const pdf = await p(`/tenants/${t.tenant.id}/consents/${list.body.records[0].id}/certificate`).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    const logged = await owner.platformAudit.findMany({ where: { adminId: admin.id } });
    expect(logged.map((l) => l.action).sort()).toEqual(['consent.certificate', 'consent.export', 'consent.list']);
  });
});
