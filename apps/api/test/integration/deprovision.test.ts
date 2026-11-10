import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { resetLimits } from '../../src/auth/rateLimit.js';
import { signAccessToken } from '../../src/auth/tokens.js';
import { app as appDb, owner, seedTenant } from './fixtures.js';

const server = createApp();
const SUB = 'deprov';
let t: Awaited<ReturnType<typeof seedTenant>>;

beforeAll(async () => {
  resetLimits();
  t = await seedTenant(SUB, 1);
});
afterAll(async () => {
  await appDb.$disconnect();
  await owner.$disconnect();
});

describe('de-provisioning', () => {
  it('a terminated person loses access at once, even with an unexpired token', async () => {
    const h = await owner.user.create({ data: { tenantId: t.tenant.id, roles: ['HR_ADMIN'], employmentStatus: 'FULL_TIME', firstName: 'H', lastName: 'D', email: 'hr@deprov.test' } });
    const hr = await signAccessToken({ sub: h.id, tid: t.tenant.id, roles: ['HR_ADMIN'], aat: Math.floor(Date.now() / 1000) });
    const guard = await signAccessToken({ sub: t.users[0]!.id, tid: t.tenant.id, roles: ['STAFF'] });
    const me = () => request(server).get('/api/me').auth(guard, { type: 'bearer' }).set('x-tenant-subdomain', SUB);
    expect((await me()).status).toBe(200);
    const r = await request(server).patch(`/api/users/${t.users[0]!.id}`).auth(hr, { type: 'bearer' }).set('x-tenant-subdomain', SUB).send({ status: 'TERMINATED' });
    expect(r.status).toBe(200);
    const after = await me();
    expect(after.status).toBe(401);
    expect(after.body.code).toBe('ACCOUNT_INACTIVE');
  });

  it('API responses carry security headers', async () => {
    const r = await request(server).get('/api/health');
    expect(r.headers['x-frame-options']).toBe('DENY');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['content-security-policy']).toMatch(/frame-ancestors 'none'/);
  });
});

describe('records for an access or freedom-of-information request', () => {
  it('HR exports everything held about a person, minus union and sealed narratives, and it is logged', async () => {
    const h = await owner.user.create({ data: { tenantId: t.tenant.id, roles: ['HR_ADMIN'], employmentStatus: 'FULL_TIME', firstName: 'R', lastName: 'X', email: 'hr2@deprov.test' } });
    const hr = await signAccessToken({ sub: h.id, tid: t.tenant.id, roles: ['HR_ADMIN'], aat: Math.floor(Date.now() / 1000) });
    const stale = await signAccessToken({ sub: h.id, tid: t.tenant.id, roles: ['HR_ADMIN'] });
    const path = `/api/users/${t.users[0]!.id}/records-export`;
    expect((await request(server).get(path).auth(stale, { type: 'bearer' }).set('x-tenant-subdomain', SUB)).body.code).toBe('STEP_UP_REQUIRED');
    const r = await request(server).get(path).auth(hr, { type: 'bearer' }).set('x-tenant-subdomain', SUB);
    expect(r.status).toBe(200);
    expect(r.headers['content-disposition']).toMatch(/attachment/);
    const body = JSON.parse(r.text);
    expect(body.person.email).toBe(`guard0@${SUB}.test`);
    expect(body.excluded.join(' ')).toMatch(/Union Hub/);
    expect(Object.keys(body)).toEqual(expect.arrayContaining(['shifts', 'punches', 'disciplineRecords', 'onboarding', 'workRestrictions', 'auditTrail']));
    expect(await owner.auditLog.count({ where: { action: 'privacy.records_export', entityId: t.users[0]!.id } })).toBe(1);

    // The same records as a printable PDF, in French too; also logged.
    for (const lang of ['en', 'fr']) {
      const pdf = await request(server).get(`${path}.pdf?lang=${lang}`).auth(hr, { type: 'bearer' }).set('x-tenant-subdomain', SUB).buffer(true).parse((res, cb) => {
        const parts: Buffer[] = [];
        res.on('data', (c: Buffer) => parts.push(c));
        res.on('end', () => cb(null, Buffer.concat(parts)));
      });
      expect(pdf.status).toBe(200);
      expect(pdf.headers['content-type']).toMatch(/application\/pdf/);
      expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
      expect((pdf.body as Buffer).length).toBeGreaterThan(3000);
    }
    expect(await owner.auditLog.count({ where: { action: 'privacy.records_export', entityId: t.users[0]!.id } })).toBe(3);
  });
});
