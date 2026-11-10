import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { signAccessToken } from '../../src/auth/tokens.js';
import { app as appDb, owner, seedTenant } from './fixtures.js';

const server = createApp();
const SUB = 'policies';
let t: Awaited<ReturnType<typeof seedTenant>>;
const tok: Record<string, string> = {};
const id: Record<string, string> = {};
const as = (who: string) => ({
  get: (p: string) => request(server).get(p).set('x-tenant-subdomain', SUB).auth(tok[who]!, { type: 'bearer' }),
  post: (p: string, b: object = {}) => request(server).post(p).set('x-tenant-subdomain', SUB).auth(tok[who]!, { type: 'bearer' }).send(b),
});
const BODY = 'Everyone on deck wears the rescue tube while guarding. Rotate every 30 minutes. Report every incident before the end of shift.';

beforeAll(async () => {
  t = await seedTenant(SUB, 1);
  const now = Math.floor(Date.now() / 1000);
  id.guard = t.users[0]!.id;
  tok.guard = await signAccessToken({ sub: id.guard, tid: t.tenant.id, roles: ['STAFF'], aat: now });
  const mk = async (name: string, roles: ('EMPLOYEE' | 'HR_ADMIN')[]) => {
    const u = await owner.user.create({ data: { tenantId: t.tenant.id, roles, employmentStatus: 'FULL_TIME', firstName: name, lastName: 'X', email: `${name}@${SUB}.test` } });
    id[name] = u.id;
    tok[name] = await signAccessToken({ sub: u.id, tid: t.tenant.id, roles, aat: now });
  };
  await mk('works', ['EMPLOYEE']);
  await mk('hr', ['HR_ADMIN']);
});
afterAll(async () => {
  await appDb.$disconnect();
  await owner.$disconnect();
});

describe('read-and-sign policies', () => {
  let policyId = '';
  it('HR publishes to a position; only those people are asked to sign', async () => {
    expect((await as('guard').post('/api/policies', { title: 'Deck safety plan', body: BODY })).status).toBe(403);
    const r = await as('hr').post('/api/policies', { title: 'Deck safety plan', body: BODY, positionIds: [t.position.id], dueDays: 14 });
    expect(r.status).toBe(201);
    policyId = r.body.id;
    expect(await owner.notification.count({ where: { type: 'policy_to_sign', userId: id.guard } })).toBe(1);
    expect((await as('works').get('/api/me/policies')).body.toSign).toEqual([]);
    const mine = (await as('guard').get('/api/me/policies')).body;
    expect(mine.toSign).toEqual([expect.objectContaining({ id: policyId, title: 'Deck safety plan', version: 1 })]);
  });

  it('signing records the name and a fingerprint of the exact text, once', async () => {
    expect((await as('guard').post(`/api/me/policies/${policyId}/sign`, { signedName: 'Guard Zero' })).status).toBe(201);
    expect((await as('guard').post(`/api/me/policies/${policyId}/sign`, { signedName: 'Guard Zero' })).body.code).toBe('ALREADY_SIGNED');
    const ack = await owner.policyAck.findFirstOrThrow({ where: { policyId } });
    const p = await owner.policy.findUniqueOrThrow({ where: { id: policyId } });
    expect(ack.textSha256).toBe(p.textSha256);
    const status = (await as('hr').get(`/api/policies/${policyId}/status`)).body;
    expect(status.signed.map((s: { userId: string }) => s.userId)).toEqual([id.guard]);
    expect(status.waiting).toEqual([]);
    expect((await as('hr').get('/api/policies')).body[0]).toMatchObject({ signed: 1, of: 1 });
  });

  it('a revision is a new version everyone signs again; the old one retires', async () => {
    const r = await as('hr').post(`/api/policies/${policyId}/revise`, { title: 'Deck safety plan', body: `${BODY} Check the AED every morning.`, positionIds: [] });
    expect(r.body.version).toBe(2);
    expect((await owner.policy.findUniqueOrThrow({ where: { id: policyId } })).retiredAt).not.toBeNull();
    expect((await as('guard').get('/api/me/policies')).body.toSign.map((p: { id: string }) => p.id)).toEqual([r.body.id]);
    expect((await as('works').get('/api/me/policies')).body.toSign).toHaveLength(1);
    expect((await as('guard').post(`/api/me/policies/${policyId}/sign`, { signedName: 'x y' })).status).toBe(404);
  });
});
