/**
 * A person's sign-in email and status are their account (SEC-01, SEC-05, SEC-12, SEC-17): whoever
 * controls the email gets the invitation and reset links and the emailed sign-in codes.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { hashPassword, signAccessToken } from '../../src/auth/tokens.js';
import { forgetCustomPermissions } from '../../src/services/people/customRoles.js';
import { app as appDb, owner, seedTenant } from './fixtures.js';

process.env.LOCAL_KEK_BASE64 ||= randomBytes(32).toString('base64');
const server = createApp();
const SUB = 'takeover';
let t: Awaited<ReturnType<typeof seedTenant>>;
const ids = { hr: '', admin2: '', assistant: '', steward: '', worker: '', fresh: '' };
const tok = { hr: '', assistant: '' };
const now = () => Math.floor(Date.now() / 1000);
const call = (token: string) => ({
  post: (p: string, b: object = {}) => request(server).post(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }).send(b),
  patch: (p: string, b: object = {}) => request(server).patch(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }).send(b),
});
const anon = { post: (p: string, b: object) => request(server).post(p).set('x-tenant-subdomain', SUB).send(b) };

beforeAll(async () => {
  t = await seedTenant(SUB, 0);
  const pw = await hashPassword('a good password 1');
  const mk = async (roles: Array<'HR_ADMIN' | 'STAFF' | 'EMPLOYEE' | 'UNION_STEWARD'>, name: string, password: string | null = pw) =>
    (await owner.user.create({ data: { tenantId: t.tenant.id, roles, employmentStatus: 'FULL_TIME', firstName: name, lastName: 'X', email: `${name}@${SUB}.test`, passwordHash: password } })).id;
  ids.hr = await mk(['HR_ADMIN'], 'hr');
  ids.admin2 = await mk(['HR_ADMIN'], 'admin2');
  ids.assistant = await mk(['STAFF'], 'assistant');
  ids.steward = await mk(['EMPLOYEE', 'UNION_STEWARD'], 'steward');
  ids.worker = await mk(['EMPLOYEE'], 'worker');
  ids.fresh = await mk(['EMPLOYEE'], 'fresh', null);
  // The "HR assistant" from the hardening review: edits staff, nothing HR-wide.
  const role = await owner.customRole.create({ data: { tenantId: t.tenant.id, name: 'HR assistant', permissions: ['users.read', 'users.write'] } });
  await owner.userCustomRole.create({ data: { tenantId: t.tenant.id, userId: ids.assistant, customRoleId: role.id } });
  forgetCustomPermissions(t.tenant.id);
  tok.hr = await signAccessToken({ sub: ids.hr, tid: t.tenant.id, roles: ['HR_ADMIN'], aat: now(), mfa: true });
  tok.assistant = await signAccessToken({ sub: ids.assistant, tid: t.tenant.id, roles: ['STAFF'], aat: now(), mfa: true });
});
afterAll(async () => {
  await appDb.$disconnect();
  await owner.$disconnect();
});

describe('who may change a sign-in email or status (SEC-01/05/12)', () => {
  it('a non-HR editor can’t redirect an HR administrator’s or a steward’s sign-in, or end their account', async () => {
    for (const target of [ids.admin2, ids.steward]) {
      const r = await call(tok.assistant).patch(`/api/users/${target}`, { email: 'mallory@attacker.test' });
      expect([r.status, r.body.code], target).toEqual([403, 'ACCOUNT_PROTECTED']);
      expect((await call(tok.assistant).patch(`/api/users/${target}`, { status: 'TERMINATED' })).status).toBe(403);
      expect((await call(tok.assistant).post(`/api/users/${target}/offboarding`, { lastDay: '2026-12-31', reason: 'RESIGNATION' })).status).toBe(403);
    }
    const after = await owner.user.findMany({ where: { id: { in: [ids.admin2, ids.steward] } } });
    expect(after.map((u) => [u.email, u.pendingEmail, u.status])).toEqual(expect.arrayContaining([[`admin2@${SUB}.test`, null, 'ACTIVE'], [`steward@${SUB}.test`, null, 'ACTIVE']]));
    expect(await owner.emailOutbox.count({ where: { tenantId: t.tenant.id, toEmail: 'mallory@attacker.test' } })).toBe(0);
  });

  it('the same editor may still change an everyday employee (pending their confirmation)', async () => {
    const r = await call(tok.assistant).patch(`/api/users/${ids.worker}`, { email: 'worker.new@city.test' });
    expect([r.status, r.body.emailPending]).toEqual([200, true]);
  });
});

describe('a new sign-in email waits for the new address to confirm it (SEC-01)', () => {
  it('nothing changes until the link is used; then sessions end and the old address is told', async () => {
    const victim = await owner.user.create({ data: { tenantId: t.tenant.id, roles: ['EMPLOYEE'], employmentStatus: 'FULL_TIME', firstName: 'Vic', lastName: 'X', email: `vic@${SUB}.test`, passwordHash: await hashPassword('a good password 1') } });
    await owner.refreshToken.create({ data: { tenantId: t.tenant.id, userId: victim.id, familyId: randomUUID(), tokenHash: `live-${victim.id}`, expiresAt: new Date(Date.now() + 86_400_000), authenticatedAt: new Date() } });
    const r = await call(tok.hr).patch(`/api/users/${victim.id}`, { email: 'vic.new@city.test' });
    expect([r.status, r.body.emailPending]).toEqual([200, true]);
    const pending = await owner.user.findUniqueOrThrow({ where: { id: victim.id } });
    expect([pending.email, pending.pendingEmail]).toEqual([`vic@${SUB}.test`, 'vic.new@city.test']);
    // Still signed in, and a reset link still goes to the old address.
    expect(await owner.refreshToken.count({ where: { userId: victim.id, revokedAt: null } })).toBe(1);
    expect(await owner.emailOutbox.count({ where: { toEmail: `vic@${SUB}.test`, template: 'email_change_requested' } })).toBe(1);
    const mail = await owner.emailOutbox.findFirstOrThrow({ where: { toEmail: 'vic.new@city.test', template: 'email_change_confirm' } });
    const token = new URL(String((mail.params as { url: string }).url)).searchParams.get('token')!;
    expect((await anon.post('/api/auth/email-change/confirm', { token: 'x'.repeat(40) })).status).toBe(400);
    expect((await anon.post('/api/auth/email-change/confirm', { token })).status).toBe(200);
    const done = await owner.user.findUniqueOrThrow({ where: { id: victim.id } });
    expect([done.email, done.pendingEmail]).toEqual(['vic.new@city.test', null]);
    expect(await owner.refreshToken.count({ where: { userId: victim.id, revokedAt: null } })).toBe(0);
    expect(await owner.emailOutbox.count({ where: { toEmail: `vic@${SUB}.test`, template: 'email_changed' } })).toBe(1);
    const again = await anon.post('/api/auth/email-change/confirm', { token });
    expect([again.status, again.body.code]).toEqual([400, 'LINK_EXPIRED']);
  });

  it('an account that never signed in (a fresh invitation) changes at once', async () => {
    const r = await call(tok.hr).patch(`/api/users/${ids.fresh}`, { email: 'fresh.fixed@city.test' });
    expect([r.status, r.body.emailPending]).toEqual([200, false]);
    expect((await owner.user.findUniqueOrThrow({ where: { id: ids.fresh } })).email).toBe('fresh.fixed@city.test');
  });
});

describe('invitations are for accounts that were never set up (SEC-01)', () => {
  it('re-inviting someone who already has a password is refused; a fresh account is invited', async () => {
    const r = await call(tok.hr).post(`/api/users/${ids.worker}/invite`);
    expect([r.status, r.body.code]).toEqual([409, 'ALREADY_SET_UP']);
    expect((await call(tok.hr).post(`/api/users/${ids.fresh}/invite`)).status).toBe(202);
  });
});

describe('an integration key can’t redirect an administrator’s sign-in (SEC-17)', () => {
  it('PATCH /api/v1/people/:id with a new email is refused for an HR administrator, allowed for an employee', async () => {
    const k = await call(tok.hr).post('/api/integrations/api-keys', { name: 'HRIS', scopes: ['people:read', 'people:write'] });
    expect(k.status, JSON.stringify(k.body)).toBe(201);
    const patch = async (id: string, email: string) => {
      const g = await request(server).get(`/api/v1/people/${id}`).auth(k.body.key, { type: 'bearer' });
      return request(server).patch(`/api/v1/people/${id}`).auth(k.body.key, { type: 'bearer' }).set('If-Match', String(g.headers.etag)).set('Idempotency-Key', randomUUID()).send({ email });
    };
    const r = await patch(ids.admin2, 'mallory@attacker.test');
    expect([r.status, r.body.code]).toEqual([403, 'KEY_CANNOT_CHANGE_EMAIL']);
    expect((await owner.user.findUniqueOrThrow({ where: { id: ids.admin2 } })).pendingEmail).toBeNull();
    const ok = await patch(ids.fresh, 'fresh.api@city.test');
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  });
});
