import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { signAccessToken } from '../../src/auth/tokens.js';
import { app as appDb, owner, seedTenant } from './fixtures.js';

const server = createApp();
const SUB = 'lambda';
let t: Awaited<ReturnType<typeof seedTenant>>;
let sup: string;
let staff: string;
// 1x1 transparent PNG
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const call = (token: string) => ({
  get: (p: string) => request(server).get(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }),
  post: (p: string, b: object = {}) => request(server).post(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }).send(b),
});

beforeAll(async () => {
  t = await seedTenant(SUB, 1);
  const s = await owner.user.create({ data: { tenantId: t.tenant.id, roles: ['AQUATIC_SUPERVISOR'], employmentStatus: 'FULL_TIME', firstName: 'S', lastName: 'L', email: 'sup@lambda.test' } });
  sup = await signAccessToken({ sub: s.id, tid: t.tenant.id, roles: ['AQUATIC_SUPERVISOR'] });
  staff = await signAccessToken({ sub: t.users[0]!.id, tid: t.tenant.id, roles: ['STAFF'] });
});
afterAll(async () => {
  await appDb.$disconnect();
  await owner.$disconnect();
});

describe('disciplinary records', () => {
  it('a supervisor writes a record; the staff member is notified and signs it once', async () => {
    const id = t.users[0]!.id;
    const r = await call(sup).post(`/api/users/${id}/discipline`, { summary: 'Left the guard chair without a relief guard in place.', stewardPresent: true });
    expect(r.status).toBe(201);
    expect(await owner.notification.count({ where: { userId: id, type: 'discipline_issued' } })).toBe(1);

    const mine = await call(staff).get('/api/me/discipline');
    expect(mine.body[0]).toMatchObject({ acknowledgedAt: null, stewardPresent: true });

    expect((await call(staff).post(`/api/me/discipline/${r.body.id}/acknowledge`, { signature: 'data:image/png;base64,AAAA' })).status).toBe(400);
    expect((await call(staff).post(`/api/me/discipline/${r.body.id}/acknowledge`, { signature: PNG })).status).toBe(200);
    expect((await call(staff).post(`/api/me/discipline/${r.body.id}/acknowledge`, { signature: PNG })).status).toBe(409);
    const stored = await owner.disciplinaryRecord.findUniqueOrThrow({ where: { id: r.body.id } });
    expect(stored.acknowledgementSignature?.subarray(1, 4).toString()).toBe('PNG');
  });

  it('keeps records away from staff and logs who viewed them', async () => {
    expect((await call(staff).get(`/api/users/${t.users[0]!.id}/discipline`)).status).toBe(403);
    expect((await call(sup).get(`/api/users/${t.users[0]!.id}/discipline`)).body).toHaveLength(1);
    expect(await owner.auditLog.count({ where: { action: 'discipline.view', entityId: t.users[0]!.id } })).toBe(1);
  });
});
