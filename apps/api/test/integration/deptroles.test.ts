import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { signAccessToken } from '../../src/auth/tokens.js';
import { app as appDb, owner, seedTenant } from './fixtures.js';

const server = createApp();
const SUB = 'depts';
let t: Awaited<ReturnType<typeof seedTenant>>;
let water: string; // position
let maint: string; // position
const ids = { hr: '', sup: '', w1: '', m1: '' };
const tok = { hr: '', sup: '' };
const call = (token: string) => ({
  get: (p: string) => request(server).get(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }),
  post: (p: string, b: object = {}) => request(server).post(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }).send(b),
  put: (p: string, b: object = {}) => request(server).put(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }).send(b),
});
const LEAD = ['schedule.read', 'shifts.self', 'users.read', 'schedule.write', 'timeoff.approve', 'timeclock.review', 'certs.verify', 'roles.manage'];

beforeAll(async () => {
  t = await seedTenant(SUB, 0);
  water = (await owner.position.create({ data: { tenantId: t.tenant.id, name: 'Water Operator' } })).id;
  maint = (await owner.position.create({ data: { tenantId: t.tenant.id, name: 'Maintenance Worker' } })).id;
  const mk = async (roles: ('HR_ADMIN' | 'EMPLOYEE')[], name: string, position?: string) => {
    const u = await owner.user.create({ data: { tenantId: t.tenant.id, roles, employmentStatus: 'FULL_TIME', firstName: name, lastName: 'X', email: `${name}@depts.test` } });
    if (position) await owner.userPosition.create({ data: { tenantId: t.tenant.id, userId: u.id, positionId: position } });
    return u.id;
  };
  ids.hr = await mk(['HR_ADMIN'], 'hr');
  ids.sup = await mk(['EMPLOYEE'], 'sup');
  ids.w1 = await mk(['EMPLOYEE'], 'wendy', water);
  ids.m1 = await mk(['EMPLOYEE'], 'manny', maint);
  tok.hr = await signAccessToken({ sub: ids.hr, tid: t.tenant.id, roles: ['HR_ADMIN'], aat: Math.floor(Date.now() / 1000) });
  tok.sup = await signAccessToken({ sub: ids.sup, tid: t.tenant.id, roles: ['EMPLOYEE'], aat: Math.floor(Date.now() / 1000) });
});
afterAll(async () => {
  await appDb.$disconnect();
  await owner.$disconnect();
});

describe('department supervisors and managers', () => {
  let supRole: string;

  it('HR makes a Water Works Supervisor limited to water works, and gives it to someone', async () => {
    const r = await call(tok.hr).post('/api/roles', { name: 'Water Works Supervisor', permissions: LEAD, scopePositionIds: [water] });
    expect(r.status).toBe(201);
    supRole = r.body.id;
    expect((await request(server).patch(`/api/users/${ids.sup}`).set('x-tenant-subdomain', SUB).auth(tok.hr, { type: 'bearer' }).send({ customRoleIds: [supRole] })).status).toBe(200);
    // Any kind of role: an aquatics coordinator with pool capabilities is fine too.
    expect((await call(tok.hr).post('/api/roles', { name: 'Aquatics Coordinator', permissions: ['ops.chemical.signoff', 'deck.rotate', 'schedule.write'] })).status).toBe(201);
  });

  it('the supervisor sees and manages only their crew', async () => {
    const people = (await call(tok.sup).get('/api/users')).body.map((u: { id: string }) => u.id);
    expect(people).toContain(ids.w1);
    expect(people).not.toContain(ids.m1);
    expect((await call(tok.sup).get(`/api/users/${ids.m1}`)).status).toBe(404);
    const start = new Date(Date.now() + 5 * 86_400_000);
    const shift = (positionId: string) => ({ facilityId: t.facility.id, positionId, startsAt: start.toISOString(), endsAt: new Date(start.getTime() + 8 * 3_600_000).toISOString() });
    expect((await call(tok.sup).post('/api/shifts', shift(maint))).status).toBe(403);
    expect((await call(tok.sup).post('/api/shifts', shift(water))).status).toBe(201);
  });

  it('time-off approvals show only their crew', async () => {
    for (const userId of [ids.w1, ids.m1]) {
      await owner.timeOffRequest.create({ data: { tenantId: t.tenant.id, userId, type: 'VACATION', startsAt: new Date(Date.now() + 9 * 86_400_000), endsAt: new Date(Date.now() + 10 * 86_400_000) } });
    }
    const list = (await call(tok.sup).get('/api/time-off')).body.map((r: { userId: string }) => r.userId);
    expect(list).toEqual([ids.w1]);
  });

  it('managers make roles for their crew, but never beyond their own capabilities or department', async () => {
    const lead = await call(tok.sup).post('/api/roles', { name: 'Water Lead', permissions: ['schedule.read', 'shifts.self', 'timeoff.approve'], scopePositionIds: [water] });
    expect(lead.status).toBe(201);
    expect((await call(tok.sup).post('/api/roles', { name: 'Maint Lead', permissions: ['timeoff.approve'], scopePositionIds: [maint] })).status).toBe(403);
    expect((await call(tok.sup).post('/api/roles', { name: 'Everywhere Lead', permissions: ['timeoff.approve'] })).status).toBe(403);
    expect((await call(tok.sup).post('/api/roles', { name: 'Payroll Lead', permissions: ['payroll.export'], scopePositionIds: [water] })).status).toBe(403);
    // They can give it to their crew, not to other departments.
    expect((await call(tok.sup).put(`/api/users/${ids.w1}/roles`, { customRoleIds: [lead.body.id] })).status).toBe(200);
    expect((await call(tok.sup).put(`/api/users/${ids.m1}/roles`, { customRoleIds: [lead.body.id] })).status).toBe(404);
    // …and can't change roles beyond theirs, like the supervisor role HR made.
    const roles = (await call(tok.sup).get('/api/roles')).body.roles;
    expect(roles.find((r: { name: string }) => r.name === 'Water Lead').canManage).toBe(true);
    expect(roles.find((r: { name: string }) => r.name === 'Aquatics Coordinator').canManage).toBe(false);
    expect((await call(tok.sup).put(`/api/roles/${supRole}`, { name: 'Water Works Supervisor', permissions: [...LEAD, 'payroll.export'], scopePositionIds: [water] })).status).toBe(403);
  });

  it('a department manager cannot open records or lists of people outside their department', async () => {
    const role = await call(tok.hr).post('/api/roles', {
      name: 'Water Works Manager',
      permissions: ['schedule.read', 'users.read', 'schedule.write', 'discipline.read', 'reliability.read', 'onboarding.lead', 'incidents.read', 'injury.manage', 'care.manage'],
      scopePositionIds: [water],
    });
    expect(role.status).toBe(201);
    const mgr = (await owner.user.create({ data: { tenantId: t.tenant.id, roles: ['EMPLOYEE'], employmentStatus: 'FULL_TIME', firstName: 'mona', lastName: 'X', email: 'mona@depts.test' } })).id;
    await owner.userCustomRole.create({ data: { tenantId: t.tenant.id, userId: mgr, customRoleId: role.body.id } });
    const m = await signAccessToken({ sub: mgr, tid: t.tenant.id, roles: ['EMPLOYEE'], aat: Math.floor(Date.now() / 1000) });
    for (const path of ['discipline', 'reliability', 'case-file', 'records-export']) {
      const out = await call(m).get(`/api/users/${ids.m1}/${path}`);
      expect(out.status, path).toBe(404);
      expect((await call(m).get(`/api/users/${ids.w1}/${path}`)).body.message ?? '', path).not.toMatch(/Person not found/);
    }
    expect((await call(m).get(`/api/onboarding/people/${ids.m1}`)).status).toBe(404);
    const review = await call(m).get('/api/people/review');
    if (review.status === 200) expect(review.body.map((r: { id: string }) => r.id)).toEqual([ids.w1]);
    const onboarding = await call(m).get('/api/onboarding/people');
    if (onboarding.status === 200) expect(JSON.stringify(onboarding.body)).not.toContain(ids.m1);
    // An incident reported by someone in another department stays out of their list.
    await owner.incidentReport.create({ data: { tenantId: t.tenant.id, facilityId: t.facility.id, reportedById: ids.m1, occurredAt: new Date(), category: 'FIRST_AID', ciphertext: Buffer.from('x'), iv: Buffer.from('x'), authTag: Buffer.from('x'), wrappedDataKey: Buffer.from('x'), kekId: 'test' } });
    const inc = await call(m).get(`/api/incidents?from=${new Date(Date.now() - 86_400_000).toISOString()}&to=${new Date(Date.now() + 86_400_000).toISOString()}`);
    if (inc.status === 200) expect(inc.body).toEqual([]);
    expect((await call(tok.hr).get(`/api/incidents?from=${new Date(Date.now() - 86_400_000).toISOString()}&to=${new Date(Date.now() + 86_400_000).toISOString()}`)).body).toHaveLength(1);
  });
});
