import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { resetLimits } from '../../src/auth/rateLimit.js';
import { hashPassword, signAccessToken } from '../../src/auth/tokens.js';
import { app as appDb, owner, seedOpenOffer, seedTenant } from './fixtures.js';

const server = createApp();
const SUB = 'iota';
let t: Awaited<ReturnType<typeof seedTenant>>;
let hr: string;
let sup: string;
let supId: string;

const call = (token?: string) => {
  const w = (r: request.Test) => (token ? r.auth(token, { type: 'bearer' }) : r).set('x-tenant-subdomain', SUB);
  return {
    get: (p: string) => w(request(server).get(p)),
    post: (p: string, b: object = {}) => w(request(server).post(p)).send(b),
    patch: (p: string, b: object) => w(request(server).patch(p)).send(b),
  };
};
const tokenFrom = (url: string) => new URL(url).searchParams.get('token')!;

beforeAll(async () => {
  resetLimits();
  t = await seedTenant(SUB, 1);
  const h = await owner.user.create({ data: { tenantId: t.tenant.id, roles: ['HR_ADMIN'], employmentStatus: 'FULL_TIME', firstName: 'Harper', lastName: 'Reid', email: 'hr@iota.test' } });
  const s = await owner.user.create({ data: { tenantId: t.tenant.id, roles: ['AQUATIC_SUPERVISOR'], employmentStatus: 'FULL_TIME', firstName: 'Sam', lastName: 'Sup', email: 'sup@iota.test' } });
  supId = s.id;
  hr = await signAccessToken({ sub: h.id, tid: t.tenant.id, roles: ['HR_ADMIN'] });
  sup = await signAccessToken({ sub: s.id, tid: t.tenant.id, roles: ['AQUATIC_SUPERVISOR'] });
});
afterAll(async () => {
  await appDb.$disconnect();
  await owner.$disconnect();
});

describe('invitations and passwords', () => {
  it('HR creates a staff member and an invitation email is queued', async () => {
    const r = await call(hr).post('/api/users', {
      firstName: 'Nia', lastName: 'Okoro', email: 'Nia@iota.test', roles: ['STAFF'], employmentStatus: 'PART_TIME', locale: 'fr-CA', positionIds: [t.position.id],
    });
    expect(r.status).toBe(201);
    expect(r.body.invited).toBe(true);
    const mail = await owner.emailOutbox.findFirstOrThrow({ where: { toEmail: 'nia@iota.test', template: 'invite' } });
    expect(mail.locale).toBe('fr-CA');
    expect((mail.params as { url: string }).url).toMatch(/^http:\/\/iota\.localhost:3000\/reset\?token=/);
  });

  it('refuses a duplicate email', async () => {
    const r = await call(hr).post('/api/users', { firstName: 'X', lastName: 'Y', email: 'nia@iota.test', roles: ['STAFF'], employmentStatus: 'CASUAL' });
    expect(r.status).toBe(409);
  });

  it('the invitation link sets a password once, then sign-in works', async () => {
    const mail = await owner.emailOutbox.findFirstOrThrow({ where: { toEmail: 'nia@iota.test', template: 'invite' } });
    const token = tokenFrom((mail.params as { url: string }).url);
    const weak = await call().post('/api/auth/reset', { token, password: 'short' });
    expect(weak.status).toBe(400);
    const ok = await call().post('/api/auth/reset', { token, password: 'pool-deck-2026' });
    expect(ok.status).toBe(200);
    const again = await call().post('/api/auth/reset', { token, password: 'pool-deck-2027' });
    expect(again.body.code).toBe('LINK_EXPIRED');
    const login = await call().post('/api/auth/login', { email: 'nia@iota.test', password: 'pool-deck-2026' });
    expect(login.status).toBe(200);
  });

  it('locks the account after five wrong passwords, and a reset unlocks it', async () => {
    for (let i = 0; i < 5; i++) expect((await call().post('/api/auth/login', { email: 'nia@iota.test', password: 'wrong-wrong-1' })).status).toBe(401);
    const locked = await call().post('/api/auth/login', { email: 'nia@iota.test', password: 'pool-deck-2026' });
    expect(locked.status).toBe(423);

    expect((await call().post('/api/auth/forgot', { email: 'nia@iota.test' })).status).toBe(202);
    expect((await call().post('/api/auth/forgot', { email: 'nobody@iota.test' })).status).toBe(202);
    expect(await owner.emailOutbox.count({ where: { toEmail: 'nobody@iota.test' } })).toBe(0);
    const reset = await owner.emailOutbox.findFirstOrThrow({ where: { toEmail: 'nia@iota.test', template: 'password_reset' } });
    await call().post('/api/auth/reset', { token: tokenFrom((reset.params as { url: string }).url), password: 'new-pass-2026' });
    expect((await call().post('/api/auth/login', { email: 'nia@iota.test', password: 'new-pass-2026' })).status).toBe(200);
  });

  it('changes a password only with the current one', async () => {
    await owner.user.update({ where: { id: supId }, data: { passwordHash: await hashPassword('old-pass-123') } });
    expect((await call(sup).post('/api/me/password', { currentPassword: 'nope', newPassword: 'new-pass-456' })).status).toBe(400);
    expect((await call(sup).post('/api/me/password', { currentPassword: 'old-pass-123', newPassword: 'new-pass-456' })).status).toBe(200);
  });

  it('returns my profile with permissions', async () => {
    const me = await call(sup).get('/api/me');
    expect(me.body.permissions).toContain('shiftboard.approve');
    expect(me.body.permissions).not.toContain('users.write');
  });

});

describe('certifications', () => {
  it('a self-entered certification does not count until a supervisor verifies it', async () => {
    const guard = await owner.user.create({
      data: { tenantId: t.tenant.id, roles: ['STAFF'], employmentStatus: 'CASUAL', firstName: 'Lee', lastName: 'New', email: 'lee@iota.test', dateOfBirth: new Date('2002-01-01') },
    });
    await owner.userPosition.create({ data: { tenantId: t.tenant.id, userId: guard.id, positionId: t.position.id } });
    const leeToken = await signAccessToken({ sub: guard.id, tid: t.tenant.id, roles: ['STAFF'] });
    const added = await call(leeToken).post('/api/me/certifications', { certificationId: t.nls.id, issueDate: '2026-01-10', expiryDate: '2028-01-10' });
    expect(added.body.verified).toBe(false);

    const { offer } = await seedOpenOffer(t, 8);
    const blocked = await call(leeToken).post(`/api/offers/${offer.id}/claim`, {});
    expect(blocked.status).toBe(422);
    expect(blocked.body.details.blocks.map((b: { code: string }) => b.code)).toContain('MISSING_CERTIFICATION');

    expect((await call(leeToken).post(`/api/user-certifications/${added.body.id}/verify`)).status).toBe(403);
    const v = await call(sup).post(`/api/user-certifications/${added.body.id}/verify`);
    expect(v.body.verified).toBe(true);
    const claimed = await call(leeToken).post(`/api/offers/${offer.id}/claim`, {});
    expect(claimed.body.outcome).toBe('ASSIGNED');
  });

  it('lists certifications expiring soon', async () => {
    await owner.userCertification.updateMany({ where: { userId: t.users[0]!.id }, data: { expiryDate: new Date(Date.now() + 10 * 86_400_000) } });
    const r = await call(sup).get('/api/certifications/expiring?days=30');
    expect(r.body.map((c: { user: { name: string } }) => c.user.name)).toContain('Guard0 iota');
  });
});

describe('staff admin', () => {
  it('starts a new pay rate and closes the previous one the day before', async () => {
    const id = t.users[0]!.id;
    await call(hr).post(`/api/users/${id}/pay-rates`, { positionId: t.position.id, hourlyRate: '21.50', effectiveFrom: '2026-01-01' });
    await call(hr).post(`/api/users/${id}/pay-rates`, { positionId: t.position.id, hourlyRate: '22.75', effectiveFrom: '2026-07-01' });
    const detail = await call(hr).get(`/api/users/${id}`);
    expect(detail.body.payRates.map((r: { hourlyRate: string; effectiveTo: string | null }) => [r.hourlyRate, r.effectiveTo])).toEqual([
      ['22.75', null],
      ['21.5', '2026-06-30'],
    ]);
  });

  it('hides pay rates from supervisors and keeps staff out', async () => {
    const r = await call(sup).get(`/api/users/${t.users[0]!.id}`);
    expect(r.body.payRates).toBeUndefined();
    const staff = await signAccessToken({ sub: t.users[0]!.id, tid: t.tenant.id, roles: ['STAFF'] });
    expect((await call(staff).get('/api/users')).status).toBe(403);
  });

  it('supervisors set scheduling settings but cannot change roles', async () => {
    const id = t.users[0]!.id;
    expect((await call(sup).patch(`/api/users/${id}/scheduling`, { shadowTier: 'A_SQUAD', weeklyMaxHours: '24' })).status).toBe(200);
    expect((await call(sup).patch(`/api/users/${id}`, { roles: ['HR_ADMIN'] })).status).toBe(403);
  });
});
