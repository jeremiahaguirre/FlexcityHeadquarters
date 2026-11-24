/**
 * Organization-wide settings and data are only for people whose access isn't limited to a
 * department (SEC-07, SEC-13, SEC-15, SEC-25, SEC-26, SEC-29, SEC-63, SEC-64): a department-limited
 * holder of the same permission is refused, and a whole-organization holder still gets through.
 */
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { type AddressInfo, connect } from 'node:net';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { signAccessToken } from '../../src/auth/tokens.js';
import { forgetCustomPermissions } from '../../src/services/people/customRoles.js';
import { app as appDb, owner, seedTenant } from './fixtures.js';

const server = createApp();
const SUB = 'wholeorg';
let t: Awaited<ReturnType<typeof seedTenant>>;
const ids = { hr: '', parks: '', sup: '', head: '', worker: '', guard: '' };
const tok = { hr: '', parks: '', sup: '', head: '' };
const dept = { aquatics: '', parks: '' };
const pos = { guard: '', parks: '' };
const now = () => Math.floor(Date.now() / 1000);
const call = (token: string) => ({
  get: (p: string) => request(server).get(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }),
  post: (p: string, b: object = {}) => request(server).post(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }).send(b),
  put: (p: string, b: object = {}) => request(server).put(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }).send(b),
  patch: (p: string, b: object = {}) => request(server).patch(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }).send(b),
  delete: (p: string) => request(server).delete(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }),
});
type Role = 'HR_ADMIN' | 'AQUATIC_SUPERVISOR' | 'HEAD_LIFEGUARD' | 'STAFF' | 'EMPLOYEE';
const mk = async (roles: Role[], name: string, position?: string) => {
  const u = await owner.user.create({ data: { tenantId: t.tenant.id, roles, employmentStatus: 'FULL_TIME', firstName: name, lastName: 'X', email: `${name}@${SUB}.test` } });
  if (position) await owner.userPosition.create({ data: { tenantId: t.tenant.id, userId: u.id, positionId: position } });
  return u.id;
};

beforeAll(async () => {
  t = await seedTenant(SUB, 0);
  await owner.tenant.update({ where: { id: t.tenant.id }, data: { features: { registration: true, payroll: true, shiftBidding: true } } }).catch(() => undefined);
  pos.guard = (await owner.position.create({ data: { tenantId: t.tenant.id, name: 'Pool Lifeguard' } })).id;
  pos.parks = (await owner.position.create({ data: { tenantId: t.tenant.id, name: 'Parks Worker' } })).id;
  ids.hr = await mk(['HR_ADMIN'], 'hr');
  ids.sup = await mk(['AQUATIC_SUPERVISOR'], 'sup');
  ids.head = await mk(['HEAD_LIFEGUARD', 'STAFF'], 'head', pos.guard);
  ids.guard = await mk(['STAFF'], 'guard', pos.guard);
  ids.worker = await mk(['EMPLOYEE'], 'worker', pos.parks);
  tok.hr = await signAccessToken({ sub: ids.hr, tid: t.tenant.id, roles: ['HR_ADMIN'], aat: now(), mfa: true });
  const a = await call(tok.hr).post('/api/departments', { name: 'Aquatics', aquatic: true, positionIds: [pos.guard], managerIds: [ids.sup, ids.head] });
  const p = await call(tok.hr).post('/api/departments', { name: 'Parks', positionIds: [pos.parks] });
  dept.aquatics = a.body.id;
  dept.parks = p.body.id;
  // "Parks admin": organization settings, benefits, policies and care, limited to Parks.
  const role = await call(tok.hr).post('/api/roles', { name: 'Parks admin', permissions: ['users.read', 'tenant.configure', 'benefits.manage', 'policies.manage', 'care.manage'], scopeDepartmentIds: [dept.parks] });
  expect(role.status).toBe(201);
  ids.parks = await mk(['EMPLOYEE'], 'parksadmin', pos.parks);
  await owner.userCustomRole.create({ data: { tenantId: t.tenant.id, userId: ids.parks, customRoleId: role.body.id } });
  forgetCustomPermissions(t.tenant.id);
  tok.parks = await signAccessToken({ sub: ids.parks, tid: t.tenant.id, roles: ['EMPLOYEE'], aat: now(), mfa: true });
  tok.sup = await signAccessToken({ sub: ids.sup, tid: t.tenant.id, roles: ['AQUATIC_SUPERVISOR'], aat: now(), mfa: true });
  tok.head = await signAccessToken({ sub: ids.head, tid: t.tenant.id, roles: ['HEAD_LIFEGUARD', 'STAFF'], aat: now(), mfa: true });
});
afterAll(async () => {
  await appDb.$disconnect();
  await owner.$disconnect();
});

const refused = (r: request.Response, what: string) => expect([403], `${what} → ${r.status} ${r.body.code}`).toContain(r.status);

describe('a department-limited "Organization settings" holder', () => {
  it('can’t download or even see the organization’s data export (SEC-07/13)', async () => {
    refused(await call(tok.parks).get('/api/data-export'), 'summary');
    refused(await call(tok.parks).get('/api/data-export/download'), 'download');
  });

  it('can’t change organization-wide settings (SEC-25)', async () => {
    refused(await call(tok.parks).get('/api/settings'), 'GET settings');
    refused(await call(tok.parks).put('/api/settings/mfa', { roles: [], codes: true }), 'MFA roles');
    refused(await call(tok.parks).put('/api/settings/retention', {}), 'retention');
    refused(await call(tok.parks).put('/api/schedule/work-rules', {}), 'work rules');
    refused(await call(tok.parks).put('/api/benchmarks/opt-in', { on: true }), 'benchmarks');
    refused(await call(tok.parks).post('/api/support-access', { hours: 1, level: 'FULL' }), 'FH support grant');
    refused(await call(tok.parks).get('/api/integrations/keys'), 'integrations');
    refused(await call(tok.parks).put('/api/sso', { protocol: 'OIDC', enabled: false, enforced: false, idpMfa: false }), 'SSO');
  });

  it('can’t make themselves manager of every department or move positions (SEC-15)', async () => {
    refused(await call(tok.parks).put(`/api/departments/${dept.aquatics}`, { name: 'Aquatics', aquatic: true, positionIds: [pos.guard], managerIds: [ids.parks] }), 'update');
    refused(await call(tok.parks).post('/api/departments', { name: 'Everything', positionIds: [pos.guard, pos.parks] }), 'create');
    refused(await call(tok.parks).delete(`/api/departments/${dept.aquatics}`), 'delete');
    const d = await owner.departmentManager.findMany({ where: { departmentId: dept.aquatics } });
    expect(d.map((x) => x.userId)).not.toContain(ids.parks);
  });

  it('can’t read every enrolment or change benefit plans (SEC-26)', async () => {
    refused(await call(tok.parks).get('/api/benefits'), 'list');
    refused(await call(tok.parks).post('/api/benefits/plans', { name: 'Free money', kind: 'OTHER' }), 'plan');
  });

  it('can’t publish organization-wide policies or read everyone’s signing status (SEC-64)', async () => {
    refused(await call(tok.parks).post('/api/policies', { title: 'Everyone signs this', body: 'Text that every department must sign.', positionIds: [] }), 'publish');
    refused(await call(tok.parks).get('/api/policies'), 'list');
  });
});

describe('the built-in aquatic supervisor, limited to Aquatics', () => {
  it('can’t replace the organization-wide care text (SEC-63)', async () => {
    refused(await call(tok.sup).put('/api/care/settings', { eap: 'Call this other number.' }), 'care');
    expect((await call(tok.sup).get('/api/care/settings')).status).toBe(200);
  });
});

describe('a head lifeguard limited to Aquatics (SEC-29)', () => {
  it('changes only their own sets, and reads only their own class lists', async () => {
    const c = await call(tok.sup).post('/api/campaigns', { name: 'Fall lessons', kind: 'LESSONS', startsOn: '2026-09-01', endsOn: '2026-12-01' });
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    const set = (positionId: string) => ({ facilityId: t.facility.id, positionId, daysOfWeek: [1], startMinute: 600, endMinute: 630, startsOn: '2026-09-07', endsOn: '2026-11-30', priceCents: 5000 });
    const parksSet = await call(tok.sup).post(`/api/campaigns/${c.body.id}/sets`, set(pos.parks));
    expect(parksSet.status).toBe(201);
    refused(await call(tok.head).post('/api/campaigns', { name: 'Mine', kind: 'LESSONS', startsOn: '2026-09-01', endsOn: '2026-12-01' }), 'campaign create');
    refused(await call(tok.head).patch(`/api/campaigns/${c.body.id}`, { name: 'Renamed' }), 'campaign rename');
    refused(await call(tok.head).post(`/api/campaigns/${c.body.id}/close`), 'campaign close');
    refused(await call(tok.head).patch(`/api/campaigns/${c.body.id}/sets/${parksSet.body.id}`, { priceCents: 0 }), 'other set price');
    expect((await call(tok.head).get(`/api/registrations?setId=${parksSet.body.id}`)).status).toBe(404);
    // Member services (the aquatic supervisor) set it up; their own position's set is fine for the head lifeguard.
    const own = await call(tok.head).post(`/api/campaigns/${c.body.id}/sets`, set(pos.guard));
    expect(own.status).toBe(201);
    expect((await call(tok.head).patch(`/api/campaigns/${c.body.id}/sets/${own.body.id}`, { priceCents: 4500 })).status).toBe(200);
    expect((await call(tok.head).get(`/api/registrations?setId=${own.body.id}`)).status).toBe(200);
  });
});

describe('HR, for the whole organization', () => {
  it('still reaches all of it', async () => {
    expect((await call(tok.hr).get('/api/settings')).status).toBe(200);
    expect((await call(tok.hr).get('/api/data-export')).status).toBe(200);
    expect((await call(tok.hr).get('/api/benefits')).status).toBe(200);
    expect((await call(tok.hr).get('/api/policies')).status).toBe(200);
    expect((await call(tok.hr).put('/api/care/settings', { eap: 'EAP: 1-800-000-0000' })).status).toBe(200);
    expect((await call(tok.hr).put(`/api/departments/${dept.parks}`, { name: 'Parks', positionIds: [pos.parks], managerIds: [] })).status).toBe(200);
  });

  it('as the only HR administrator, enrols themselves at the plan’s rates only, audited (SEC-26)', async () => {
    const plan = await call(tok.hr).post('/api/benefits/plans', { name: 'Dental', kind: 'DENTAL', employeeAmount: 10 });
    expect(plan.status).toBe(201);
    const override = await call(tok.hr).post('/api/benefits/enrollments', { planId: plan.body.id, userId: ids.hr, startsOn: '2026-01-01', employeeAmount: 0 });
    expect([override.status, override.body.code]).toEqual([403, 'SELF_BENEFITS']);
    const self = await call(tok.hr).post('/api/benefits/enrollments', { planId: plan.body.id, userId: ids.hr, startsOn: '2026-01-01' });
    expect(self.status).toBe(201);
    expect(await owner.auditLog.count({ where: { tenantId: t.tenant.id, action: 'benefits.self_change', actorId: ids.hr } })).toBe(1);
    expect((await call(tok.hr).post('/api/benefits/enrollments', { planId: plan.body.id, userId: ids.worker, startsOn: '2026-01-01' })).status).toBe(201);
    // A department-limited benefits holder can't enrol or end anyone.
    const worker = (await owner.benefitEnrollment.findFirstOrThrow({ where: { userId: ids.worker } })).id;
    refused(await call(tok.parks).post('/api/benefits/enrollments', { planId: plan.body.id, userId: ids.worker, startsOn: '2026-02-01' }), 'enrol');
    refused(await call(tok.parks).post(`/api/benefits/enrollments/${worker}/end`, { endsOn: '2026-06-30' }), 'end');
    // Once there's another HR administrator, they do it: ending your own is refused.
    const second = await mk(['HR_ADMIN'], 'hrbenefits');
    const mine = (await owner.benefitEnrollment.findFirstOrThrow({ where: { userId: ids.hr } })).id;
    const end = await call(tok.hr).post(`/api/benefits/enrollments/${mine}/end`, { endsOn: '2026-06-30' });
    expect([end.status, end.body.code]).toEqual([403, 'SELF_BENEFITS']);
    const tok2 = await signAccessToken({ sub: second, tid: t.tenant.id, roles: ['HR_ADMIN'], aat: now(), mfa: true });
    expect((await call(tok2).post(`/api/benefits/enrollments/${mine}/end`, { endsOn: '2026-06-30' })).status).toBe(200);
    await owner.user.update({ where: { id: second }, data: { status: 'INACTIVE' } });
  });

  it('downloads the data export only with a second factor, and the other HR administrators are told (SEC-07)', async () => {
    const other = await mk(['HR_ADMIN'], 'hr2');
    const noMfa = await signAccessToken({ sub: ids.hr, tid: t.tenant.id, roles: ['HR_ADMIN'], aat: now() });
    // The city doesn't require MFA for HR here, so this session has no second factor.
    await owner.tenant.update({ where: { id: t.tenant.id }, data: { mfaRoles: [] } });
    const r = await call(noMfa).get('/api/data-export/download');
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('PASSKEY_REQUIRED');
    const ok = await call(tok.hr).get('/api/data-export/download').buffer(true).parse((res, cb) => { res.on('data', () => undefined); res.on('end', () => cb(null, null)); });
    expect(ok.status).toBe(200);
    const mail = await owner.emailOutbox.findMany({ where: { tenantId: t.tenant.id, template: 'data_exported' } });
    expect(mail.map((m) => m.toEmail)).toEqual([`hr2@${SUB}.test`]);
    expect(other).toBeTruthy();
  });
});

describe('more organization-wide settings a department-limited role can’t change (review of #50)', () => {
  it('refuses each one to a role holding every capability but limited to Parks, and lets HR through', async () => {
    const catalog = (await call(tok.hr).get('/api/roles')).body.catalog as Record<string, string[]>;
    const role = await call(tok.hr).post('/api/roles', { name: 'Parks everything', permissions: Object.values(catalog).flat(), scopeDepartmentIds: [dept.parks] });
    expect(role.status).toBe(201);
    const who = await mk(['EMPLOYEE'], 'parkseverything', pos.parks);
    await owner.userCustomRole.create({ data: { tenantId: t.tenant.id, userId: who, customRoleId: role.body.id } });
    forgetCustomPermissions(t.tenant.id);
    const limited = await signAccessToken({ sub: who, tid: t.tenant.id, roles: ['EMPLOYEE'], aat: now(), mfa: true });
    const before = await owner.tenant.findUniqueOrThrow({ where: { id: t.tenant.id }, select: { overtimePolicy: true, winterSettings: true, signupSettings: true, features: true } });
    const winter = { season: { start: '11-01', end: '04-15' }, callOuts: { responseMinutes: 30, minRestHours: 8 }, patrols: { graceMinutes: 60 }, callOutsOn: true, patrolsOn: true };
    const writes: Array<[string, () => Promise<request.Response>]> = [
      ['winter settings', () => call(limited).put('/api/winter/settings', winter)],
      ['overtime policy', () => call(limited).put('/api/overtime/policy', { countRefusals: true, clause: 'Article 99', periodStartMonth: 4 })],
      ['sign-up settings', () => call(limited).put('/api/signup/settings', { enabled: true, terms: 'x', payment: 'y' })],
      ['new position', () => call(limited).post('/api/positions', { name: 'Shadow position', requiredCertificationIds: [], departmentId: dept.aquatics })],
      ['scheduling assistant (organization)', () => call(limited).put('/api/schedule/fill/settings', { departmentId: null, planAheadWeeks: 4 })],
      ['shift templates', () => call(limited).put('/api/schedule/templates/settings', { autoCreate: true })],
      ['bidding defaults', () => call(limited).put('/api/bids/settings', { seniorityBasis: 'HOURS' })],
      ['messaging settings', () => call(limited).put('/api/messages-admin/settings', { staffDirect: true, minorDirect: true, pushPreview: true, shiftArchiveHours: 48 })],
      ['survey settings', () => call(limited).put('/api/surveys-admin/settings', { minGroup: 5, managersCreate: true })],
      ['sign-in rules', () => call(limited).put('/api/settings/mfa', { roles: [], codes: true })],
      ['remove SSO', () => call(limited).delete('/api/sso')],
      ['billing', () => call(limited).get('/api/billing')],
      ['cancel the bank debit agreement', () => call(limited).post('/api/billing/pad/cancel', { reason: 'test' })],
      ['onboarding item for everyone', () => call(limited).post('/api/onboarding/items', { name: 'Sign this', owner: 'HR', kind: 'ACKNOWLEDGEMENT', allStaff: true, blocksScheduling: true })],
      ['another department’s onboarding checklist', () => call(limited).put(`/api/onboarding/positions/${pos.guard}`, { itemIds: [] })],
    ];
    for (const [what, send] of writes) refused(await send(), what);
    // Another department's position reads as not found to a department-limited lead (staff.ts).
    const move = await call(limited).put(`/api/positions/${pos.guard}`, { name: 'Pool Lifeguard', requiredCertificationIds: [], departmentId: dept.parks });
    expect([403, 404], `move a position → ${move.status}`).toContain(move.status);
    const after = await owner.tenant.findUniqueOrThrow({ where: { id: t.tenant.id }, select: { overtimePolicy: true, winterSettings: true, signupSettings: true, features: true } });
    expect(after).toEqual(before);
    expect(await owner.position.count({ where: { tenantId: t.tenant.id, name: 'Shadow position' } })).toBe(0);
    // HR, for the whole organization, may.
    expect((await call(tok.hr).put('/api/overtime/policy', { countRefusals: false, clause: null, periodStartMonth: 1 })).status).toBe(200);
  });

  it('an absolute-form request line gets the same answer', async () => {
    const listening = createServer(server).listen(0);
    await once(listening, 'listening');
    const port = (listening.address() as AddressInfo).port;
    try {
      for (const scheme of ['http', 'HTTP']) {
        const status = await new Promise<number>((resolve, reject) => {
          const s = connect(port, '127.0.0.1');
          let out = '';
          s.on('data', (c) => (out += c.toString('latin1')));
          s.on('end', () => resolve(Number(/^HTTP\/1\.1 (\d{3})/.exec(out)?.[1] ?? 0)));
          s.on('error', reject);
          s.write(`GET ${scheme}://${SUB}.example.test/api/settings HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nX-Tenant-Subdomain: ${SUB}\r\nAuthorization: Bearer ${tok.parks}\r\nConnection: close\r\n\r\n`);
        });
        expect([400, 403], scheme).toContain(status);
      }
    } finally {
      listening.close();
    }
  });

  it('an API key keeps writing only while its maker holds that access for the whole organization', async () => {
    const maker = await mk(['HR_ADMIN'], 'keymaker');
    const makerTok = await signAccessToken({ sub: maker, tid: t.tenant.id, roles: ['HR_ADMIN'], aat: now(), mfa: true });
    const k = await call(makerTok).post('/api/integrations/api-keys', { name: 'Departments sync', scopes: ['departments:write'] });
    expect(k.status, JSON.stringify(k.body)).toBe(201);
    const post = (name: string) => request(server).post('/api/v1/departments').auth(k.body.key, { type: 'bearer' }).set('Idempotency-Key', randomUUID()).send({ name });
    expect((await post('Synced one')).status).toBe(201);
    // The maker is no longer HR: organization settings only through a role limited to Parks.
    const role = await call(tok.hr).post('/api/roles', { name: 'Parks settings', permissions: ['users.read', 'tenant.configure'], scopeDepartmentIds: [dept.parks] });
    await owner.user.update({ where: { id: maker }, data: { roles: ['EMPLOYEE'] } });
    await owner.userCustomRole.create({ data: { tenantId: t.tenant.id, userId: maker, customRoleId: role.body.id } });
    forgetCustomPermissions(t.tenant.id);
    const r = await post('Synced two');
    expect([r.status, r.body.code]).toEqual([403, 'KEY_OWNER_LIMITED']);
  });
});

describe('a city without departments: whole-organization access is per capability', () => {
  const NSUB = 'wholeorgnd';
  let n: Awaited<ReturnType<typeof seedTenant>>;
  const ncall = (token: string) => ({
    get: (p: string) => request(server).get(p).set('x-tenant-subdomain', NSUB).auth(token, { type: 'bearer' }),
    post: (p: string, b: object = {}) => request(server).post(p).set('x-tenant-subdomain', NSUB).auth(token, { type: 'bearer' }).send(b),
  });
  const person = async (roles: Role[], name: string) => (await owner.user.create({ data: { tenantId: n.tenant.id, roles, employmentStatus: 'FULL_TIME', firstName: name, lastName: 'N', email: `${name}@${NSUB}.test` } })).id;
  let poolAdmin = '';
  let unlimited = '';

  beforeAll(async () => {
    n = await seedTenant(NSUB, 0);
    await owner.tenant.update({ where: { id: n.tenant.id }, data: { features: { payroll: true } } }).catch(() => undefined);
    const hr = await person(['HR_ADMIN'], 'hr');
    const hrTok = await signAccessToken({ sub: hr, tid: n.tenant.id, roles: ['HR_ADMIN'], aat: now(), mfa: true });
    const pool = await ncall(hrTok).post('/api/roles', { name: 'Pool admin', permissions: ['tenant.configure', 'benefits.manage'], scopeFacilityIds: [n.facility.id] });
    const ann = await ncall(hrTok).post('/api/roles', { name: 'Announcer', permissions: ['announcements.post'] });
    expect([pool.status, ann.status]).toEqual([201, 201]);
    poolAdmin = pool.body.id;
    unlimited = ann.body.id;
  });

  const check = async (roles: Role[], extraRole: string | null, name: string) => {
    const id = await person(roles, name);
    await owner.userCustomRole.create({ data: { tenantId: n.tenant.id, userId: id, customRoleId: poolAdmin } });
    if (extraRole) await owner.userCustomRole.create({ data: { tenantId: n.tenant.id, userId: id, customRoleId: extraRole } });
    forgetCustomPermissions(n.tenant.id);
    const token = await signAccessToken({ sub: id, tid: n.tenant.id, roles, aat: now(), mfa: true });
    for (const p of ['/api/settings', '/api/benefits', '/api/data-export']) refused(await ncall(token).get(p), `${name} ${p}`);
  };

  it('a facility-limited admin role alone is refused', async () => check(['EMPLOYEE'], null, 'alone'));
  it('…and still refused with a built-in head lifeguard role on top', async () => check(['HEAD_LIFEGUARD', 'STAFF'], null, 'withhead'));
  it('…and still refused with an unlimited custom role on top', async () => check(['EMPLOYEE'], unlimited, 'withannouncer'));

  it('payroll, tax, accounting and training routes decide per capability too (review of cbd2034)', async () => {
    const hrTok = await signAccessToken({ sub: (await owner.user.findFirstOrThrow({ where: { tenantId: n.tenant.id, roles: { has: 'HR_ADMIN' } } })).id, tid: n.tenant.id, roles: ['HR_ADMIN'], aat: now(), mfa: true });
    const role = await ncall(hrTok).post('/api/roles', { name: 'Pool payroll', permissions: ['payroll.export', 'payroll.approve', 'accounting.manage', 'tenant.configure', 'training.manage'], scopeFacilityIds: [n.facility.id] });
    expect(role.status).toBe(201);
    const who = await person(['HEAD_LIFEGUARD', 'STAFF'], 'poolpayroll');
    await owner.userCustomRole.create({ data: { tenantId: n.tenant.id, userId: who, customRoleId: role.body.id } });
    forgetCustomPermissions(n.tenant.id);
    const token = await signAccessToken({ sub: who, tid: n.tenant.id, roles: ['HEAD_LIFEGUARD', 'STAFF'], aat: now(), mfa: true });
    const put = (p: string, b: object) => request(server).put(p).set('x-tenant-subdomain', NSUB).auth(token, { type: 'bearer' }).send(b);
    const before = await owner.tenant.findUniqueOrThrow({ where: { id: n.tenant.id }, select: { payrollSettings: true } });
    for (const p of ['/api/payroll/t4?year=2025', '/api/payroll/t4.xml?year=2025', '/api/payroll/remittance?month=2025-01', '/api/payroll/provider', '/api/payees']) refused(await ncall(token).get(p), p);
    refused(await put('/api/payroll/export-settings', { format: 'GENERIC_CSV' }), 'export settings');
    refused(await put('/api/accounting/accounts', { accounts: [] }), 'chart of accounts');
    refused(await ncall(token).post('/api/training/courses', { name: 'Course', validityMonths: 12 }), 'training course');
    expect((await owner.tenant.findUniqueOrThrow({ where: { id: n.tenant.id }, select: { payrollSettings: true } })).payrollSettings).toEqual(before.payrollSettings);
    // HR, for the whole organization, still reaches them.
    expect((await ncall(hrTok).get('/api/payees')).status).toBe(200);
  });

  it('positions are changed only with positions.manage for the whole organization, not from a facility-limited role (review of 67d40b7)', async () => {
    const hrTok = await signAccessToken({ sub: (await owner.user.findFirstOrThrow({ where: { tenantId: n.tenant.id, roles: { has: 'HR_ADMIN' } } })).id, tid: n.tenant.id, roles: ['HR_ADMIN'], aat: now(), mfa: true });
    const role = await ncall(hrTok).post('/api/roles', { name: 'Pool positions', permissions: ['positions.manage', 'users.read'], scopeFacilityIds: [n.facility.id] });
    expect(role.status).toBe(201);
    // A built-in head lifeguard (a lead, so no department limit is computed) with the facility-limited role.
    const who = await person(['HEAD_LIFEGUARD', 'STAFF'], 'poolpositions');
    await owner.userCustomRole.create({ data: { tenantId: n.tenant.id, userId: who, customRoleId: role.body.id } });
    forgetCustomPermissions(n.tenant.id);
    const token = await signAccessToken({ sub: who, tid: n.tenant.id, roles: ['HEAD_LIFEGUARD', 'STAFF'], aat: now(), mfa: true });
    const before = await owner.position.findUniqueOrThrow({ where: { id: n.position.id } });
    const create = await ncall(token).post('/api/positions', { name: 'Shadow position', requiredCertificationIds: [] });
    expect([create.status, create.body.code]).toEqual([403, 'WHOLE_ORGANIZATION_ONLY']);
    const edit = await request(server).put(`/api/positions/${n.position.id}`).set('x-tenant-subdomain', NSUB).auth(token, { type: 'bearer' }).send({ name: 'Renamed', requiredCertificationIds: [] });
    expect([edit.status, edit.body.code]).toEqual([403, 'WHOLE_ORGANIZATION_ONLY']);
    expect(await owner.position.findUniqueOrThrow({ where: { id: n.position.id } })).toEqual(before);
    expect(await owner.position.count({ where: { tenantId: n.tenant.id, name: 'Shadow position' } })).toBe(0);
    // HR, for the whole organization, still may.
    expect((await request(server).put(`/api/positions/${n.position.id}`).set('x-tenant-subdomain', NSUB).auth(hrTok, { type: 'bearer' }).send({ name: before.name, requiredCertificationIds: [] })).status).toBe(200);
  });

  it('an unlimited custom role with organization settings, not HR, sees the export but can’t download it (HR_ONLY)', async () => {
    const hrTok = await signAccessToken({ sub: (await owner.user.findFirstOrThrow({ where: { tenantId: n.tenant.id, roles: { has: 'HR_ADMIN' } } })).id, tid: n.tenant.id, roles: ['HR_ADMIN'], aat: now(), mfa: true });
    const role = await ncall(hrTok).post('/api/roles', { name: 'IT admin', permissions: ['tenant.configure'] });
    const itAdmin = await person(['EMPLOYEE'], 'itadmin');
    await owner.userCustomRole.create({ data: { tenantId: n.tenant.id, userId: itAdmin, customRoleId: role.body.id } });
    forgetCustomPermissions(n.tenant.id);
    const token = await signAccessToken({ sub: itAdmin, tid: n.tenant.id, roles: ['EMPLOYEE'], aat: now(), mfa: true });
    expect((await ncall(token).get('/api/data-export')).status).toBe(200);
    const r = await ncall(token).get('/api/data-export/download');
    expect([r.status, r.body.code]).toEqual([403, 'HR_ONLY']);
  });
});
