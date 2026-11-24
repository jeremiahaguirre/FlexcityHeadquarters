import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { resetLimits } from '../../src/auth/rateLimit.js';
import { hashPassword, signAccessToken } from '../../src/auth/tokens.js';
import { app as appDb, owner, seedOpenOffer, seedTenant } from './fixtures.js';
import { forgetFeatures } from '../../src/services/platform/features.js';

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
    put: (p: string, b: object) => w(request(server).put(p)).send(b),
    delete: (p: string) => w(request(server).delete(p)),
  };
};
const tokenFrom = (url: string) => new URL(url).searchParams.get('token')!;

beforeAll(async () => {
  resetLimits();
  t = await seedTenant(SUB, 1);
  const h = await owner.user.create({ data: { tenantId: t.tenant.id, roles: ['HR_ADMIN'], employmentStatus: 'FULL_TIME', firstName: 'Harper', lastName: 'Reid', email: 'hr@iota.test' } });
  const s = await owner.user.create({ data: { tenantId: t.tenant.id, roles: ['AQUATIC_SUPERVISOR'], employmentStatus: 'FULL_TIME', firstName: 'Sam', lastName: 'Sup', email: 'sup@iota.test' } });
  supId = s.id;
  // Signed in just now, as sensitive HR actions require.
  hr = await signAccessToken({ sub: h.id, tid: t.tenant.id, roles: ['HR_ADMIN'], aat: Math.floor(Date.now() / 1000) });
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
    // Locked out from this network: the same answer as a wrong password (nothing tells an attacker).
    // A network lock sends no email (only a whole-account lock does: auth/bruteForce.ts).
    const locked = await call().post('/api/auth/login', { email: 'nia@iota.test', password: 'pool-deck-2026' });
    expect(locked.status).toBe(401);
    expect(locked.body.code).toBe('INVALID_CREDENTIALS');
    expect(await owner.auditLog.count({ where: { action: 'auth.network_locked', entityId: (await owner.user.findFirstOrThrow({ where: { email: 'nia@iota.test' } })).id } })).toBe(1);

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
    expect((await call(sup).post('/api/me/password', { currentPassword: 'old-pass-123', newPassword: 'old-pass-123' })).body.code).toBe('PASSWORD_REUSED');
    expect((await call(sup).post('/api/me/password', { currentPassword: 'old-pass-123', newPassword: 'new-pass-456' })).status).toBe(200);
    // The change ends earlier access tokens (SEC-31); the app gets a new one by refreshing, as here.
    expect((await call(sup).get('/api/me')).body.code).toBe('SESSION_ENDED');
    sup = await signAccessToken({ sub: supId, tid: t.tenant.id, roles: ['AQUATIC_SUPERVISOR'] });
  });

  it('returns my profile with permissions', async () => {
    const me = await call(sup).get('/api/me');
    expect(me.body.permissions).toContain('shiftboard.approve');
    expect(me.body.permissions).not.toContain('users.write');
  });

  it('opens the Union Hub to union members only while the organization has it on', async () => {
    const id = t.users[0]!.id;
    const token = await signAccessToken({ sub: id, tid: t.tenant.id, roles: ['STAFF'] });
    const perms = async () => (await call(token).get('/api/me')).body.permissions as string[];
    await owner.tenant.update({ where: { id: t.tenant.id }, data: { features: { union: true } } });
    forgetFeatures();
    await owner.user.update({ where: { id }, data: { unionMember: false } });
    expect(await perms()).not.toContain('union.hub');
    await owner.user.update({ where: { id }, data: { unionMember: true } });
    expect(await perms()).toContain('union.hub');
    await owner.tenant.update({ where: { id: t.tenant.id }, data: { features: { union: false } } });
    forgetFeatures();
    expect(await perms()).not.toContain('union.hub');
  });

});

describe('correcting a record', () => {
  it('the audit keeps the old value of each field changed: seniority hours, names, phone', async () => {
    await owner.user.update({ where: { id: supId }, data: { seniorityHours: '1500.00', phone: '250-555-0100' } });
    expect((await call(hr).patch(`/api/users/${supId}`, { seniorityHours: '0', firstName: 'Samira', phone: '250-555-0199' })).status).toBe(200);
    const row = await owner.auditLog.findFirstOrThrow({ where: { tenantId: t.tenant.id, action: 'user.update', entityId: supId }, orderBy: { at: 'desc' } });
    expect(row.before).toMatchObject({ seniorityHours: '1500', firstName: 'Sam', phone: '250-555-0100' });
    expect(row.after).toMatchObject({ seniorityHours: '0', firstName: 'Samira', phone: '250-555-0199' });
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

    const queue = await call(sup).get('/api/certifications/unverified');
    expect(queue.body.map((c: { id: string }) => c.id)).toContain(added.body.id);
    expect((await call(leeToken).post(`/api/user-certifications/${added.body.id}/verify`)).status).toBe(403);
    const v = await call(sup).post(`/api/user-certifications/${added.body.id}/verify`);
    expect(v.body.verified).toBe(true);
    const claimed = await call(leeToken).post(`/api/offers/${offer.id}/claim`, {});
    expect(claimed.body.outcome).toBe('ASSIGNED');
  });

  it('everyone who can verify the person is told, not only aquatic supervisors, and the notice opens Certifications', async () => {
    const guard = await owner.user.create({ data: { tenantId: t.tenant.id, roles: ['STAFF'], employmentStatus: 'CASUAL', firstName: 'Ola', lastName: 'Notice', email: 'ola@iota.test' } });
    const tok = await signAccessToken({ sub: guard.id, tid: t.tenant.id, roles: ['STAFF'] });
    const added = await call(tok).post('/api/me/certifications', { certificationId: t.nls.id, issueDate: '2026-02-01', expiryDate: null });
    expect(added.status).toBe(201);
    const notices = await owner.notification.findMany({ where: { type: 'cert_to_verify', params: { path: ['userCertificationId'], equals: added.body.id } } });
    const hrUser = await owner.user.findFirstOrThrow({ where: { email: 'hr@iota.test' } });
    expect(notices.map((n) => n.userId).sort()).toEqual([hrUser.id, supId].sort());
    expect(new Set(notices.map((n) => n.link))).toEqual(new Set(['/manage/certifications']));
  });

  it('staff correct or remove a certificate of their own until it is verified', async () => {
    const guard = await owner.user.create({ data: { tenantId: t.tenant.id, roles: ['STAFF'], employmentStatus: 'CASUAL', firstName: 'Pat', lastName: 'Typo', email: 'pat@iota.test' } });
    const tok = await signAccessToken({ sub: guard.id, tid: t.tenant.id, roles: ['STAFF'] });
    const other = await signAccessToken({ sub: t.users[0]!.id, tid: t.tenant.id, roles: ['STAFF'] });
    const added = await call(tok).post('/api/me/certifications', { certificationId: t.nls.id, issueDate: '2026-02-01', expiryDate: '2026-02-02' });
    // Someone else's entry: not theirs to change.
    expect((await call(other).patch(`/api/me/certifications/${added.body.id}`, { certificationId: t.nls.id, issueDate: '2026-02-01', expiryDate: '2028-02-01' })).status).toBe(404);
    const fixed = await call(tok).patch(`/api/me/certifications/${added.body.id}`, { certificationId: t.nls.id, issueDate: '2026-02-01', expiryDate: '2028-02-01' });
    expect(fixed.status).toBe(200);
    expect(fixed.body.expiryDate).toBe('2028-02-01');

    const gone = await call(tok).delete(`/api/me/certifications/${added.body.id}`);
    expect(gone.status).toBe(200);
    expect(await owner.userCertification.count({ where: { id: added.body.id } })).toBe(0);
    // The supervisors' "to verify" notice goes with it.
    expect(await owner.notification.count({ where: { type: 'cert_to_verify', params: { path: ['userCertificationId'], equals: added.body.id } } })).toBe(0);
    expect(await owner.auditLog.count({ where: { action: 'cert.remove', entityId: added.body.id } })).toBe(1);

    // Once verified, it is the supervisor's record.
    const again = await call(tok).post('/api/me/certifications', { certificationId: t.nls.id, issueDate: '2026-02-01', expiryDate: null });
    await call(sup).post(`/api/user-certifications/${again.body.id}/verify`);
    const locked = await call(tok).delete(`/api/me/certifications/${again.body.id}`);
    expect(locked.status).toBe(409);
    expect(locked.body.code).toBe('CERT_VERIFIED');
  });

  it('a verifier turns down a wrong entry with a reason, and the employee is told why', async () => {
    const guard = await owner.user.create({ data: { tenantId: t.tenant.id, roles: ['STAFF'], employmentStatus: 'CASUAL', firstName: 'Rae', lastName: 'Wrong', email: 'rae@iota.test' } });
    const tok = await signAccessToken({ sub: guard.id, tid: t.tenant.id, roles: ['STAFF'] });
    const added = await call(tok).post('/api/me/certifications', { certificationId: t.nls.id, issueDate: '2026-02-01', expiryDate: null });
    expect((await call(tok).post(`/api/user-certifications/${added.body.id}/reject`, { reason: 'nope' })).status).toBe(403);
    expect((await call(sup).post(`/api/user-certifications/${added.body.id}/reject`, {})).status).toBe(400);
    const r = await call(sup).post(`/api/user-certifications/${added.body.id}/reject`, { reason: 'The card photo shows Standard First Aid, not NL.' });
    expect(r.status).toBe(200);
    expect(await owner.userCertification.count({ where: { id: added.body.id } })).toBe(0);
    const told = await owner.notification.findFirstOrThrow({ where: { userId: guard.id, type: 'cert_rejected' } });
    expect(told.params).toMatchObject({ name: t.nls.name, reason: 'The card photo shows Standard First Aid, not NL.' });
    expect(told.link).toBe('/profile');
    const log = await owner.auditLog.findFirstOrThrow({ where: { action: 'cert.reject', entityId: added.body.id } });
    expect(log.actorId).toBe(supId);
  });

  it('positions.manage holders keep the catalog: add, correct, and pick from the starter list', async () => {
    const staffTok = await signAccessToken({ sub: t.users[0]!.id, tid: t.tenant.id, roles: ['STAFF'] });
    const body = { name: 'Ice Plant Operatr', nameFr: null, issuingBody: 'Technical Safety BC', validityMonths: null };
    expect((await call(staffTok).post('/api/certifications', body)).status).toBe(403);
    const made = await call(hr).post('/api/certifications', body);
    expect(made.status).toBe(201);
    const dup = await call(hr).post('/api/certifications', { ...body, name: 'ice plant operatr' });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('CERT_EXISTS');

    expect((await call(staffTok).patch(`/api/certifications/${made.body.id}`, body)).status).toBe(403);
    const fixed = await call(sup).patch(`/api/certifications/${made.body.id}`, { ...body, name: 'Ice Plant Operator', nameFr: 'Opérateur d’usine à glace', validityMonths: 36 });
    expect(fixed.status).toBe(200);
    expect(fixed.body).toMatchObject({ name: 'Ice Plant Operator', nameFr: 'Opérateur d’usine à glace', validityMonths: 36 });
    expect(await owner.auditLog.count({ where: { entity: 'Certification', entityId: made.body.id } })).toBe(2);

    const starter = await call(hr).get('/api/certifications/starter');
    expect(starter.status).toBe(200);
    const keys = starter.body.map((c: { key: string }) => c.key);
    expect(keys).toEqual(expect.arrayContaining(['refrigeration-operator', 'water-treatment-1', 'wastewater-collection-4', 'licence-class-3', 'air-brake']));
    expect(starter.body.every((c: { name: string; nameFr: string; added: boolean }) => c.name && c.nameFr && c.added === false)).toBe(true);
    expect((await call(hr).post('/api/certifications/starter', { keys: ['nope'] })).status).toBe(400);
    const add = await call(hr).post('/api/certifications/starter', { keys: ['water-treatment-1', 'licence-class-3'] });
    expect(add.body.added).toBe(2);
    expect((await call(hr).post('/api/certifications/starter', { keys: ['water-treatment-1'] })).body.added).toBe(0);
    const after = await call(hr).get('/api/certifications/starter');
    expect(after.body.filter((c: { added: boolean }) => c.added).map((c: { key: string }) => c.key).sort()).toEqual(['licence-class-3', 'water-treatment-1']);
    const catalog = await call(staffTok).get('/api/certifications');
    expect(catalog.body.map((c: { name: string }) => c.name)).toEqual(expect.arrayContaining(['Water Treatment – Level I', 'Driver’s licence – Class 3', 'Ice Plant Operator']));
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
    // Seeded users never set a password, so they still show as invited.
    expect(detail.body.invited).toBe(true);
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

// Last: it puts the positions into departments, which changes who supervisors see.
describe('department-limited leads, the catalog and certificate checks', () => {
  let lead: string;
  let leadId: string;
  let waterPos: string;
  let aquaticsId: string;
  let waterId: string;
  beforeAll(async () => {
    const aq = await owner.department.create({ data: { tenantId: t.tenant.id, name: 'Aquatics', aquatic: true } });
    const wa = await owner.department.create({ data: { tenantId: t.tenant.id, name: 'Water Works' } });
    aquaticsId = aq.id;
    waterId = wa.id;
    await owner.position.update({ where: { id: t.position.id }, data: { departmentId: aq.id } });
    waterPos = (await owner.position.create({ data: { tenantId: t.tenant.id, name: 'Water Operator', departmentId: wa.id } })).id;
    const role = await owner.customRole.create({ data: { tenantId: t.tenant.id, name: 'Aquatics lead', permissions: ['positions.manage', 'certs.verify', 'users.read'], scopePositionIds: [t.position.id] } });
    const u = await owner.user.create({ data: { tenantId: t.tenant.id, roles: ['EMPLOYEE'], employmentStatus: 'FULL_TIME', firstName: 'Lou', lastName: 'Lead', email: 'lead@iota.test' } });
    await owner.userCustomRole.create({ data: { tenantId: t.tenant.id, userId: u.id, customRoleId: role.id } });
    leadId = u.id;
    lead = await signAccessToken({ sub: u.id, tid: t.tenant.id, roles: ['EMPLOYEE'] });
  });
  const posBody = (over: object = {}) => ({ name: 'Lifeguard', nameFr: null, minimumAge: null, requiredCertificationIds: [t.nls.id], ...over });

  it('changes only their own departments’ positions, and never moves one out of them', async () => {
    expect((await call(lead).put(`/api/positions/${waterPos}`, posBody({ name: 'Water Operator' }))).status).toBe(404);
    expect((await call(lead).put(`/api/positions/${t.position.id}`, posBody({ departmentId: waterId }))).status).toBe(403);
    expect((await call(lead).put(`/api/positions/${t.position.id}`, posBody({ departmentId: null }))).status).toBe(403);
    // Leaving the department out keeps it.
    expect((await call(lead).put(`/api/positions/${t.position.id}`, posBody({ minimumAge: 16 }))).status).toBe(200);
    expect(await owner.position.findUniqueOrThrow({ where: { id: t.position.id } })).toMatchObject({ departmentId: aquaticsId, minimumAge: 16 });
    expect((await call(lead).post('/api/positions', posBody({ name: 'Plant Helper', departmentId: waterId }))).status).toBe(403);
    expect((await call(lead).post('/api/positions', posBody({ name: 'No Department' }))).status).toBe(403);
    expect((await call(lead).post('/api/positions', posBody({ name: 'Pool Attendant', departmentId: aquaticsId }))).status).toBe(201);
    // HR (not limited) can do both.
    expect((await call(hr).put(`/api/positions/${waterPos}`, posBody({ name: 'Water Operator', departmentId: waterId }))).status).toBe(200);
  });

  it('can’t correct the organization-wide catalog; nobody can correct a shared reference row', async () => {
    const mine = await owner.certification.create({ data: { tenantId: t.tenant.id, name: 'Confined Space Entry iota', issuingBody: 'WorkSafeBC', validityMonths: null } });
    const body = { name: 'Confined Space Entry iota', nameFr: null, issuingBody: 'WorkSafeBC', validityMonths: 36 };
    const r = await call(lead).patch(`/api/certifications/${mine.id}`, body);
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('CERT_ORG_WIDE');
    const shared = await owner.certification.create({ data: { tenantId: null, name: 'Shared reference row iota', issuingBody: 'FH', validityMonths: null } });
    try {
      const s = await call(hr).patch(`/api/certifications/${shared.id}`, { ...body, name: 'Shared reference row iota' });
      expect(s.status).toBe(403);
      expect(s.body.code).toBe('CERT_SHARED');
    } finally {
      await owner.certification.delete({ where: { id: shared.id } });
    }
  });

  it('a verifier in another department isn’t told about, and can’t turn down, someone outside it; a verified entry can’t be turned down', async () => {
    const op = await owner.user.create({ data: { tenantId: t.tenant.id, roles: ['EMPLOYEE'], employmentStatus: 'FULL_TIME', firstName: 'Wes', lastName: 'Water', email: 'wes@iota.test' } });
    await owner.userPosition.create({ data: { tenantId: t.tenant.id, userId: op.id, positionId: waterPos } });
    const opTok = await signAccessToken({ sub: op.id, tid: t.tenant.id, roles: ['EMPLOYEE'] });
    const added = await call(opTok).post('/api/me/certifications', { certificationId: t.nls.id, issueDate: '2026-03-01', expiryDate: null });
    const told = (await owner.notification.findMany({ where: { type: 'cert_to_verify', params: { path: ['userCertificationId'], equals: added.body.id } } })).map((n) => n.userId);
    expect(told).not.toContain(leadId);
    expect(told).toContain((await owner.user.findFirstOrThrow({ where: { email: 'hr@iota.test' } })).id);
    expect((await call(lead).post(`/api/user-certifications/${added.body.id}/reject`, { reason: 'Not mine to check' })).status).toBe(403);

    await call(hr).post(`/api/user-certifications/${added.body.id}/verify`);
    const late = await call(hr).post(`/api/user-certifications/${added.body.id}/reject`, { reason: 'Too late' });
    expect(late.status).toBe(409);
    expect(late.body.code).toBe('CERT_VERIFIED');
  });

  it('a correction is audited, keeps the card photo link, and the French notice gets the French name', async () => {
    const guard = await owner.user.create({ data: { tenantId: t.tenant.id, roles: ['STAFF'], employmentStatus: 'CASUAL', firstName: 'Gil', lastName: 'Photo', email: 'gil@iota.test' } });
    const tok = await signAccessToken({ sub: guard.id, tid: t.tenant.id, roles: ['STAFF'] });
    const frCert = await owner.certification.create({ data: { tenantId: t.tenant.id, name: 'Bronze Cross iota', nameFr: 'Croix de bronze iota', issuingBody: 'Lifesaving Society', validityMonths: 24 } });
    const added = await call(tok).post('/api/me/certifications', { certificationId: frCert.id, issueDate: '2026-03-01', expiryDate: null, documentUrl: 'https://files.example/card.jpg' });
    const fixed = await call(tok).patch(`/api/me/certifications/${added.body.id}`, { certificationId: frCert.id, issueDate: '2026-03-02', expiryDate: null });
    expect(fixed.status).toBe(200);
    expect(fixed.body.documentUrl).toBe('https://files.example/card.jpg');
    const log = await owner.auditLog.findFirstOrThrow({ where: { action: 'cert.correct', entityId: added.body.id } });
    expect(log.before).toMatchObject({ issueDate: '2026-03-01' });
    expect(log.after).toMatchObject({ issueDate: '2026-03-02' });

    expect((await call(hr).post(`/api/user-certifications/${added.body.id}/reject`, { reason: 'Blurry photo' })).status).toBe(200);
    const n = await owner.notification.findFirstOrThrow({ where: { userId: guard.id, type: 'cert_rejected' } });
    expect(n.params).toMatchObject({ name: 'Bronze Cross iota', nameFr: 'Croix de bronze iota' });
  });

  it('a lead limited only to facilities can’t change positions or the catalog', async () => {
    const role = await owner.customRole.create({ data: { tenantId: t.tenant.id, name: 'Site lead', permissions: ['positions.manage', 'users.read'], scopeFacilityIds: [t.facility.id] } });
    const u = await owner.user.create({ data: { tenantId: t.tenant.id, roles: ['EMPLOYEE'], employmentStatus: 'FULL_TIME', firstName: 'Fay', lastName: 'Facility', email: 'fay@iota.test' } });
    await owner.userCustomRole.create({ data: { tenantId: t.tenant.id, userId: u.id, customRoleId: role.id } });
    const site = await signAccessToken({ sub: u.id, tid: t.tenant.id, roles: ['EMPLOYEE'] });
    expect((await call(site).put(`/api/positions/${waterPos}`, posBody({ name: 'Water Operator', departmentId: aquaticsId }))).status).toBe(403);
    expect((await call(site).post('/api/positions', posBody({ name: 'Anything', departmentId: aquaticsId }))).status).toBe(403);
    const cert = await owner.certification.create({ data: { tenantId: t.tenant.id, name: 'Site cert iota', issuingBody: 'X', validityMonths: null } });
    expect((await call(site).patch(`/api/certifications/${cert.id}`, { name: 'Site cert iota', nameFr: null, issuingBody: 'Another body', validityMonths: null })).body.code).toBe('CERT_ORG_WIDE');
    expect(await owner.position.findUniqueOrThrow({ where: { id: waterPos } })).toMatchObject({ departmentId: waterId });
  });

  it('verifying checks the entry is still what the verifier saw', async () => {
    const guard = await owner.user.create({ data: { tenantId: t.tenant.id, roles: ['STAFF'], employmentStatus: 'CASUAL', firstName: 'Vic', lastName: 'Swap', email: 'vic@iota.test' } });
    const tok = await signAccessToken({ sub: guard.id, tid: t.tenant.id, roles: ['STAFF'] });
    const other = await owner.certification.create({ data: { tenantId: t.tenant.id, name: 'Swim Instructor iota', issuingBody: 'Lifesaving Society', validityMonths: 24 } });
    const added = await call(tok).post('/api/me/certifications', { certificationId: other.id, issueDate: '2026-03-01', expiryDate: null });
    const shown = { certificationId: other.id, issueDate: '2026-03-01', expiryDate: null, documentUrl: null };
    // The employee swaps it for another certificate before the verifier clicks.
    await call(tok).patch(`/api/me/certifications/${added.body.id}`, { certificationId: t.nls.id, issueDate: '2026-02-01', expiryDate: null });
    const stale = await call(hr).post(`/api/user-certifications/${added.body.id}/verify`, shown);
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('CERT_CHANGED');
    expect((await owner.userCertification.findUniqueOrThrow({ where: { id: added.body.id } })).verifiedAt).toBeNull();
    const ok = await call(hr).post(`/api/user-certifications/${added.body.id}/verify`, { ...shown, certificationId: t.nls.id, issueDate: '2026-02-01' });
    expect(ok.status).toBe(200);
    expect((await call(hr).post(`/api/user-certifications/${added.body.id}/verify`, {})).body.code).toBe('CERT_VERIFIED');
  });
});
