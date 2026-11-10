/**
 * Regression tests for the security review: each attack it described, tried and refused.
 */
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { hashPassword, signAccessToken } from '../../src/auth/tokens.js';
import { forgetCustomPermissions } from '../../src/services/people/customRoles.js';
import { app as appDb, owner, seedTenant } from './fixtures.js';

process.env.LOCAL_KEK_BASE64 ||= randomBytes(32).toString('base64');

const server = createApp();
const SUB = 'hardcity';
let t: Awaited<ReturnType<typeof seedTenant>>;
const ids = { hr: '', assistant: '', sup: '', sup2: '' };
const tok = { hr: '', assistant: '', sup: '', sup2: '', staff: '' };
const now = () => Math.floor(Date.now() / 1000);
const call = (token: string) => ({
  get: (p: string) => request(server).get(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }),
  post: (p: string, b: object = {}) => request(server).post(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }).send(b),
  put: (p: string, b: object = {}) => request(server).put(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }).send(b),
  patch: (p: string, b: object = {}) => request(server).patch(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }).send(b),
});

beforeAll(async () => {
  t = await seedTenant(SUB, 2);
  const mk = async (roles: Array<'HR_ADMIN' | 'AQUATIC_SUPERVISOR' | 'STAFF'>, name: string) =>
    (await owner.user.create({ data: { tenantId: t.tenant.id, roles, employmentStatus: 'FULL_TIME', firstName: name, lastName: 'X', email: `${name}@${SUB}.test`, passwordHash: await hashPassword('a good password 1') } })).id;
  ids.hr = await mk(['HR_ADMIN'], 'hr');
  ids.assistant = await mk(['STAFF'], 'assistant');
  ids.sup = await mk(['AQUATIC_SUPERVISOR'], 'sup');
  ids.sup2 = await mk(['AQUATIC_SUPERVISOR'], 'sup2');
  // An "HR assistant" custom role: can edit staff, nothing HR-wide.
  const role = await owner.customRole.create({ data: { tenantId: t.tenant.id, name: 'HR assistant', permissions: ['users.read', 'users.write'] } });
  await owner.userCustomRole.create({ data: { tenantId: t.tenant.id, userId: ids.assistant, customRoleId: role.id } });
  forgetCustomPermissions(t.tenant.id);
  tok.hr = await signAccessToken({ sub: ids.hr, tid: t.tenant.id, roles: ['HR_ADMIN'], aat: now(), mfa: true });
  tok.assistant = await signAccessToken({ sub: ids.assistant, tid: t.tenant.id, roles: ['STAFF'], aat: now(), mfa: true });
  tok.sup = await signAccessToken({ sub: ids.sup, tid: t.tenant.id, roles: ['AQUATIC_SUPERVISOR'], aat: now(), mfa: true });
  tok.sup2 = await signAccessToken({ sub: ids.sup2, tid: t.tenant.id, roles: ['AQUATIC_SUPERVISOR'], aat: now(), mfa: true });
  tok.staff = await signAccessToken({ sub: t.users[0]!.id, tid: t.tenant.id, roles: ['STAFF'], aat: now() });
});
afterAll(async () => {
  await appDb.$disconnect();
  await owner.$disconnect();
});

describe('no escalation through staff editing', () => {
  it('a custom-role editor can’t make themselves (or anyone) HR administrator', async () => {
    expect((await call(tok.assistant).patch(`/api/users/${ids.assistant}`, { roles: ['HR_ADMIN', 'STAFF'] })).status).toBe(403);
    expect((await call(tok.assistant).patch(`/api/users/${t.users[0]!.id}`, { roles: ['HR_ADMIN'] })).status).toBe(403);
    expect((await call(tok.assistant).post('/api/users', { firstName: 'Evil', lastName: 'Admin', email: 'evil@attacker.test', roles: ['HR_ADMIN'], employmentStatus: 'FULL_TIME' })).status).toBe(403);
    expect((await owner.user.findUniqueOrThrow({ where: { id: ids.assistant } })).roles).toEqual(['STAFF']);
  });

  it('changing someone’s sign-in email signs them out and tells the old address', async () => {
    const victim = t.users[1]!;
    await owner.refreshToken.create({ data: { tenantId: t.tenant.id, userId: victim.id, familyId: crypto.randomUUID(), tokenHash: `live-${victim.id}`, expiresAt: new Date(Date.now() + 86_400_000), authenticatedAt: new Date() } });
    expect((await call(tok.hr).patch(`/api/users/${victim.id}`, { email: 'new.address@city.test' })).status).toBe(200);
    expect(await owner.refreshToken.count({ where: { userId: victim.id, revokedAt: null } })).toBe(0);
    expect(await owner.emailOutbox.count({ where: { tenantId: t.tenant.id, toEmail: victim.email, template: 'email_changed' } })).toBe(1);
  });
});

describe('no padding your own time or approving your own claims', () => {
  it('a supervisor can’t edit their own punch; an edited approved punch needs approval again', async () => {
    const mine = await owner.timePunch.create({ data: { tenantId: t.tenant.id, userId: ids.sup, facilityId: t.facility.id, positionId: t.position.id, clockIn: new Date('2026-03-02T16:00:00Z'), clockOut: new Date('2026-03-03T00:00:00Z'), status: 'APPROVED' } });
    expect((await call(tok.sup).patch(`/api/punches/${mine.id}`, { clockOut: '2026-03-03T08:00:00Z', reason: 'forgot to clock out' })).status).toBe(403);
    const theirs = await owner.timePunch.create({ data: { tenantId: t.tenant.id, userId: t.users[0]!.id, facilityId: t.facility.id, positionId: t.position.id, clockIn: new Date('2026-03-02T16:00:00Z'), clockOut: new Date('2026-03-03T00:00:00Z'), status: 'APPROVED' } });
    expect((await call(tok.sup).patch(`/api/punches/${theirs.id}`, { clockOut: '2026-03-03T01:00:00Z', reason: 'stayed to close' })).status).toBe(200);
    expect((await owner.timePunch.findUniqueOrThrow({ where: { id: theirs.id } })).status).toBe('PENDING');
  });

  it('a supervisor can’t approve their own overtime claim', async () => {
    const shift = await owner.shift.create({ data: { tenantId: t.tenant.id, facilityId: t.facility.id, positionId: t.position.id, startsAt: new Date('2027-03-01T15:00:00Z'), endsAt: new Date('2027-03-01T23:00:00Z'), status: 'PUBLISHED' } });
    const offer = await owner.shiftOffer.create({ data: { tenantId: t.tenant.id, shiftId: shift.id, source: 'OPEN_SHIFT', status: 'PENDING_APPROVAL', claimedById: ids.sup, postedById: ids.sup2 } });
    expect((await call(tok.sup).post(`/api/offers/${offer.id}/decision`, { decision: 'APPROVE' })).status).toBe(403);
  });

  it('nobody excuses their own attendance events or sets their own leave', async () => {
    const e = await owner.reliabilityEvent.create({ data: { tenantId: t.tenant.id, userId: ids.sup, type: 'NO_SHOW', occurredAt: new Date('2026-03-01T15:00:00Z') } });
    expect((await call(tok.sup).post(`/api/reliability-events/${e.id}/excuse`, { reason: 'my own note' })).status).toBe(403);
    expect((await call(tok.hr).put(`/api/users/${ids.hr}/leave`, { year: 2026, type: 'VACATION', hours: 999 })).status).toBe(403);
  });
});

describe('single sign-on settings need a fresh, two-factor sign-in', () => {
  it('a password-only or old session can’t point sign-in at another identity provider', async () => {
    const noPasskey = await signAccessToken({ sub: ids.hr, tid: t.tenant.id, roles: ['HR_ADMIN'], aat: now() });
    const stale = await signAccessToken({ sub: ids.hr, tid: t.tenant.id, roles: ['HR_ADMIN'], aat: now() - 3 * 3600, mfa: true });
    const evil = { protocol: 'OIDC', enabled: true, enforced: false, idpMfa: true, oidcIssuer: 'https://evil.example', oidcClientId: 'x' };
    expect((await call(noPasskey).put('/api/sso', evil)).body.code).toMatch(/PASSKEY_REQUIRED|MFA_REQUIRED/);
    expect((await call(stale).put('/api/sso', evil)).body.code).toBe('STEP_UP_REQUIRED');
  });

  it('servers on FH’s own network are refused as an identity provider', async () => {
    const internal = { protocol: 'OIDC', enabled: false, enforced: false, idpMfa: false, oidcIssuer: 'https://169.254.169.254/latest', oidcClientId: 'x' };
    expect((await call(tok.hr).put('/api/sso', internal)).body.code).toBe('HOST_NOT_PUBLIC');
  });
});

describe('payroll follows department scope', () => {
  it('nobody verifies their own bank account', async () => {
    const acct = await owner.bankAccount.create({
      data: { tenantId: t.tenant.id, userId: ids.hr, holderName: 'H X', institution: '001', transit: '12345', last4: '6789', accountCiphertext: Buffer.from('x'), accountIv: Buffer.from('x'), accountAuthTag: Buffer.from('x'), accountWrappedKey: Buffer.from('x'), accountKekId: 'k', status: 'PENDING', enteredById: ids.sup, consentText: 'test', consentAt: new Date() },
    });
    expect((await call(tok.hr).post(`/api/bank-accounts/${acct.id}/verify`, { approve: true })).status).toBe(403);
  });
});

describe('FH support visits never open individual records', () => {
  it('a full visit is refused documents, incident narratives, SINs, payroll details and the granter’s own pages', async () => {
    const admin = await owner.platformAdmin.create({ data: { email: `fh-${randomBytes(3).toString('hex')}@fh.test`, name: 'FH Support', passwordHash: 'x' } });
    const grant = await owner.supportGrant.create({ data: { tenantId: t.tenant.id, grantedById: ids.hr, level: 'FULL', expiresAt: new Date(Date.now() + 3_600_000) } });
    const session = await owner.supportSession.create({ data: { tenantId: t.tenant.id, grantId: grant.id, adminId: admin.id, codeHash: randomBytes(16).toString('hex'), codeExpiresAt: new Date(Date.now() + 60_000), usedAt: new Date(), endsAt: new Date(Date.now() + 1_800_000) } });
    const visit = await signAccessToken({ sub: ids.hr, tid: t.tenant.id, roles: ['HR_ADMIN'], mfa: true, sup: session.id });
    for (const path of [`/api/users/${t.users[0]!.id}/documents`, `/api/users/${t.users[0]!.id}/sin`, '/api/payroll/people', '/api/payroll/t4.xml?year=2026', '/api/me/pay-statements', '/api/households', '/api/data-export']) {
      const r = await call(visit).get(path);
      expect([403], `${path} → ${r.status} ${r.body.code}`).toContain(r.status);
    }
    expect((await call(visit).get('/api/settings')).status).toBe(200);
  });
});

describe('the Dev console can’t take over a city', () => {
  it('can’t add HR administrators once the city has one, widen roles past their defaults, or drop HR’s second factor', async () => {
    const email = `dev-${randomBytes(3).toString('hex')}@flexcity.dev`;
    await owner.platformAdmin.create({ data: { email, name: 'Dev', passwordHash: await hashPassword('right password!') } });
    const login = await request(server).post('/api/platform/auth/login').set('x-fh-platform', '1').send({ email, password: 'right password!' });
    const cookie = String(login.headers['set-cookie']).split(';')[0]!;
    const dev = (m: 'post' | 'put', p: string, b: object) => request(server)[m](`/api/platform${p}`).set('x-fh-platform', '1').set('Cookie', cookie).send(b);
    const csv = 'first_name,last_name,email,roles,employment_status\nMallory,Evil,mallory@attacker.test,hr_admin,FULL_TIME\n';
    expect((await dev('post', `/tenants/${t.tenant.id}/import`, { csv, sendInvites: true })).status).toBe(403);
    expect(await owner.user.count({ where: { email: 'mallory@attacker.test' } })).toBe(0);
    expect((await dev('put', `/tenants/${t.tenant.id}/access/permission`, { role: 'HEAD_LIFEGUARD', permission: 'documents.manage', on: true })).status).toBe(403);
    expect((await dev('put', `/tenants/${t.tenant.id}/access/mfa`, { role: 'HR_ADMIN', required: false })).status).toBe(403);
  });
});

describe('need to know', () => {
  it('a supervisor never sees medical notes, even in a city with no departments', async () => {
    const pdf = `data:application/pdf;base64,${Buffer.from('%PDF-1.4\n%%EOF\n').toString('base64')}`;
    const up = await call(tok.hr).post(`/api/users/${t.users[0]!.id}/documents`, { kind: 'MEDICAL_NOTE', title: 'Doctor’s note', fileName: 'note.pdf', data: pdf });
    expect(up.status).toBe(201);
    const seen = await call(tok.sup).get(`/api/users/${t.users[0]!.id}/documents`);
    expect(JSON.stringify(seen.body)).not.toContain('Doctor’s note');
    expect((await call(tok.sup).get(`/api/documents/${up.body.id}/file`)).status).toBe(404);
  });

  it('a role limited to one facility reaches only the people who work there', async () => {
    const arena = await owner.facility.create({ data: { tenantId: t.tenant.id, name: 'Arena', province: 'BC', timezone: 'America/Vancouver', latitude: 49.9, longitude: -119.4 } });
    const role = await owner.customRole.create({ data: { tenantId: t.tenant.id, name: 'Arena lead', permissions: ['users.read', 'timeoff.approve'], scopeFacilityIds: [arena.id] } });
    const lead = await owner.user.create({ data: { tenantId: t.tenant.id, roles: ['STAFF'], employmentStatus: 'FULL_TIME', firstName: 'Arena', lastName: 'Lead', email: `arena@${SUB}.test` } });
    await owner.userCustomRole.create({ data: { tenantId: t.tenant.id, userId: lead.id, customRoleId: role.id } });
    forgetCustomPermissions(t.tenant.id);
    // Guard1 works at the arena; Guard0 never has.
    await owner.shift.create({ data: { tenantId: t.tenant.id, facilityId: arena.id, positionId: t.position.id, userId: t.users[1]!.id, startsAt: new Date('2027-02-01T15:00:00Z'), endsAt: new Date('2027-02-01T23:00:00Z'), status: 'PUBLISHED' } });
    const token = await signAccessToken({ sub: lead.id, tid: t.tenant.id, roles: ['STAFF'], aat: now() });
    expect((await call(token).get(`/api/users/${t.users[1]!.id}`)).status).toBe(200);
    expect([403, 404]).toContain((await call(token).get(`/api/users/${t.users[0]!.id}`)).status);
  });

  it('clocking in keeps whether you were on site, never where you were or your IP', async () => {
    const r = await call(tok.staff).post('/api/timeclock/in', { facilityId: t.facility.id, positionId: t.position.id, location: { lat: 49.8801, lon: -119.4436, accuracyM: 10 } });
    expect(r.status).toBe(201);
    const p = await owner.timePunch.findUniqueOrThrow({ where: { id: r.body.id } });
    expect([p.latitude, p.longitude, p.ipAddress]).toEqual([null, null, null]);
    expect(p.locationStatus).toBeTruthy();
  });

  it('families inactive past the retention period lose their personal details; payments stay', async () => {
    const { withTenant } = await import('../../src/lib/db.js');
    const { applyRetention } = await import('../../src/services/privacy/retention.js');
    const old = new Date(Date.now() - 4 * 365 * 86_400_000);
    const hh = await owner.household.create({ data: { tenantId: t.tenant.id, name: 'Nguyen family', address: '1 Lake Rd', emergencyPhone: '250-555-0101', createdAt: old } });
    await owner.member.create({ data: { tenantId: t.tenant.id, householdId: hh.id, role: 'CHILD', firstName: 'Mai', lastName: 'Nguyen', dateOfBirth: new Date('2018-04-01'), safetyNote: 'Asthma: inhaler in bag', createdAt: old } });
    await withTenant(t.tenant.id, (tx) => applyRetention(tx));
    const after = await owner.household.findUniqueOrThrow({ where: { id: hh.id }, include: { members: true } });
    expect(after).toMatchObject({ name: 'Former family', address: null, emergencyPhone: null });
    expect(after.members[0]).toMatchObject({ firstName: 'Former', dateOfBirth: null, safetyNote: null });
  });
});

describe('the published schedule, for staff', () => {
  it('shows a staff member only their own department’s shifts', async () => {
    const aquatics = await owner.department.create({ data: { tenantId: t.tenant.id, name: 'Aquatics' } });
    const parks = await owner.department.create({ data: { tenantId: t.tenant.id, name: 'Parks' } });
    await owner.position.update({ where: { id: t.position.id }, data: { departmentId: aquatics.id } });
    const instructor = await owner.position.create({ data: { tenantId: t.tenant.id, name: 'Instructor', departmentId: aquatics.id } });
    const mower = await owner.position.create({ data: { tenantId: t.tenant.id, name: 'Mower operator', departmentId: parks.id } });
    const mk = (positionId: string, day: string) => owner.shift.create({ data: { tenantId: t.tenant.id, facilityId: t.facility.id, positionId, startsAt: new Date(`${day}T15:00:00Z`), endsAt: new Date(`${day}T23:00:00Z`), status: 'PUBLISHED' } });
    const sameDept = await mk(instructor.id, '2027-04-05');
    const otherDept = await mk(mower.id, '2027-04-06');
    // Guard0 holds the lifeguard position (Aquatics).
    const r = await call(tok.staff).get('/api/shifts?from=2027-04-01T00:00:00Z&to=2027-04-10T00:00:00Z');
    expect(r.status).toBe(200);
    const ids = r.body.map((s: { id: string }) => s.id);
    expect(ids).toContain(sameDept.id);
    expect(ids).not.toContain(otherDept.id);
  });
});

describe('access control basics', () => {
  it('staff can’t see colleagues’ pay, banking, tax profiles or payroll files', async () => {
    for (const path of ['/api/payroll/people', `/api/users/${t.users[1]!.id}/bank-accounts`, '/api/payroll/runs', '/api/payroll/t4?year=2026', '/api/payroll/remittance?month=2026-03', '/api/payroll/export?periodStart=2026-03-02&weeks=2']) {
      const r = await call(tok.staff).get(path);
      expect([403, 404], `${path} → ${r.status}`).toContain(r.status);
    }
  });

  it('refuses common passwords', async () => {
    const r = await request(server).post('/api/auth/reset').set('x-tenant-subdomain', SUB).send({ token: 'x'.repeat(30), password: 'Password2026!' });
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body)).toMatch(/too common/);
  });

  it('HR can require a second factor for everyone; HR itself can’t be dropped', async () => {
    const r = await call(tok.hr).put('/api/settings/mfa', { roles: ['STAFF', 'EMPLOYEE'] });
    expect(r.status).toBe(200);
    expect(r.body.roles).toEqual(expect.arrayContaining(['HR_ADMIN', 'STAFF', 'EMPLOYEE']));
    // A staff session without a passkey is now asked for one.
    expect((await call(tok.staff).get('/api/me/shifts?from=2026-01-01&to=2026-01-08')).body.code).toBe('MFA_REQUIRED');
    await call(tok.hr).put('/api/settings/mfa', { roles: [] });
  });
});
