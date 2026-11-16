/**
 * Organization-wide settings and data are only for people whose access isn't limited to a
 * department (SEC-07, SEC-13, SEC-15, SEC-25, SEC-26, SEC-29, SEC-63, SEC-64): a department-limited
 * holder of the same permission is refused, and a whole-organization holder still gets through.
 */
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
  await owner.tenant.update({ where: { id: t.tenant.id }, data: { features: { registration: true, payroll: true } } }).catch(() => undefined);
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

  it('can’t enrol themselves in benefits (SEC-26)', async () => {
    const plan = await call(tok.hr).post('/api/benefits/plans', { name: 'Dental', kind: 'DENTAL', employeeAmount: 10 });
    expect(plan.status).toBe(201);
    expect((await call(tok.hr).post('/api/benefits/enrollments', { planId: plan.body.id, userId: ids.hr, startsOn: '2026-01-01', employeeAmount: 0 })).status).toBe(403);
    expect((await call(tok.hr).post('/api/benefits/enrollments', { planId: plan.body.id, userId: ids.worker, startsOn: '2026-01-01' })).status).toBe(201);
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
