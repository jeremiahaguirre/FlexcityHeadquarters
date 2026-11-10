import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { signAccessToken } from '../../src/auth/tokens.js';
import { app as appDb, owner, seedTenant } from './fixtures.js';

const server = createApp();
const SUB = 'hrcity';
let t: Awaited<ReturnType<typeof seedTenant>>;
const ids = { hr: '', sup: '', other: '' };
const tok = { hr: '', sup: '', emp: '', emp2: '', other: '' };
const call = (token: string) => ({
  get: (p: string) => request(server).get(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }),
  post: (p: string, b: object = {}) => request(server).post(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }).send(b),
  put: (p: string, b: object = {}) => request(server).put(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }).send(b),
  patch: (p: string, b: object = {}) => request(server).patch(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }).send(b),
});

beforeAll(async () => {
  t = await seedTenant(SUB, 2);
  const now = Math.floor(Date.now() / 1000);
  const mk = async (roles: Array<'HR_ADMIN' | 'AQUATIC_SUPERVISOR' | 'STAFF' | 'EMPLOYEE'>, name: string) => (await owner.user.create({ data: { tenantId: t.tenant.id, roles, employmentStatus: 'FULL_TIME', firstName: name, lastName: 'X', email: `${name}@${SUB}.test` } })).id;
  ids.hr = await mk(['HR_ADMIN'], 'hr');
  ids.sup = await mk(['AQUATIC_SUPERVISOR'], 'sup');
  ids.other = await mk(['EMPLOYEE'], 'roads');
  const roads = await owner.position.create({ data: { tenantId: t.tenant.id, name: 'Roads operator' } });
  await owner.userPosition.create({ data: { tenantId: t.tenant.id, userId: ids.other, positionId: roads.id } });
  tok.hr = await signAccessToken({ sub: ids.hr, tid: t.tenant.id, roles: ['HR_ADMIN'], aat: now, mfa: true });
  tok.sup = await signAccessToken({ sub: ids.sup, tid: t.tenant.id, roles: ['AQUATIC_SUPERVISOR'], aat: now });
  tok.emp = await signAccessToken({ sub: t.users[0]!.id, tid: t.tenant.id, roles: ['STAFF'], aat: now });
  tok.emp2 = await signAccessToken({ sub: t.users[1]!.id, tid: t.tenant.id, roles: ['STAFF'], aat: now });
  tok.other = await signAccessToken({ sub: ids.other, tid: t.tenant.id, roles: ['EMPLOYEE'], aat: now });
  // Two departments: the supervisor manages aquatics only.
  const aq = await call(tok.hr).post('/api/departments', { name: 'Aquatics', aquatic: true, positionIds: [t.position.id], managerIds: [ids.sup] });
  expect(aq.status).toBe(201);
  expect((await call(tok.hr).post('/api/departments', { name: 'Roads', positionIds: [roads.id] })).status).toBe(201);
});
afterAll(async () => {
  await appDb.$disconnect();
  await owner.$disconnect();
});

describe('leave balances', () => {
  it('counts approved and pending time off against the entitlement', async () => {
    const u = t.users[0]!.id;
    // Mon–Fri approved (40h), one pending day (8h).
    await owner.timeOffRequest.create({ data: { tenantId: t.tenant.id, userId: u, type: 'VACATION', startsAt: new Date('2026-06-01T00:00:00Z'), endsAt: new Date('2026-06-06T00:00:00Z'), status: 'APPROVED' } });
    await owner.timeOffRequest.create({ data: { tenantId: t.tenant.id, userId: u, type: 'VACATION', startsAt: new Date('2026-07-06T00:00:00Z'), endsAt: new Date('2026-07-07T00:00:00Z') } });
    expect((await call(tok.hr).put(`/api/users/${u}/leave`, { year: 2026, type: 'VACATION', hours: 120, carryover: 16 })).status).toBe(200);
    const mine = (await call(tok.emp).get('/api/me/leave?year=2026')).body;
    const vac = mine.types.find((x: { type: string }) => x.type === 'VACATION');
    expect(vac).toMatchObject({ entitled: 120, carryover: 16, used: 40, pending: 8, remaining: 96 });
    expect(mine.types.find((x: { type: string }) => x.type === 'SICK')).toMatchObject({ entitled: 40, used: 0 });
  });

  it('counts the hours of the shifts the person is taken off, weekends included', async () => {
    const u = t.users[1]!.id;
    const shift = (start: string, hours: number) =>
      owner.shift.create({ data: { tenantId: t.tenant.id, facilityId: t.facility.id, positionId: t.position.id, userId: u, startsAt: new Date(start), endsAt: new Date(new Date(start).getTime() + hours * 3_600_000), status: 'PUBLISHED' } });
    // Saturday 10 h and Monday 6 h; Sunday off. By weekdays this would be 8 h (just the Monday).
    await shift('2027-01-09T15:00:00Z', 10);
    await shift('2027-01-11T16:00:00Z', 6);
    const req = await owner.timeOffRequest.create({ data: { tenantId: t.tenant.id, userId: u, type: 'VACATION', startsAt: new Date('2027-01-09T08:00:00Z'), endsAt: new Date('2027-01-12T08:00:00Z') } });
    const vac = async () => (await call(tok.emp2).get('/api/me/leave?year=2027')).body.types.find((x: { type: string }) => x.type === 'VACATION');
    expect(await vac()).toMatchObject({ pending: 16, used: 0 });
    // Approving takes them off those shifts; the 16 hours are kept on the request.
    expect((await call(tok.sup).post(`/api/time-off/${req.id}/decision`, { decision: 'APPROVE' })).status).toBe(200);
    expect(await owner.shift.count({ where: { userId: u, startsAt: { gte: new Date('2027-01-01') } } })).toBe(0);
    expect(await owner.timeOffRequest.findUniqueOrThrow({ where: { id: req.id } })).toMatchObject({ chargedBasis: 'SHIFTS' });
    expect(await vac()).toMatchObject({ pending: 0, used: 16 });
  });

  it('falls back to working days when nothing is scheduled', async () => {
    const u = t.users[1]!.id;
    const req = await owner.timeOffRequest.create({ data: { tenantId: t.tenant.id, userId: u, type: 'SICK', startsAt: new Date('2027-02-01T08:00:00Z'), endsAt: new Date('2027-02-03T08:00:00Z') } });
    expect((await call(tok.sup).post(`/api/time-off/${req.id}/decision`, { decision: 'APPROVE' })).status).toBe(200);
    expect(await owner.timeOffRequest.findUniqueOrThrow({ where: { id: req.id } })).toMatchObject({ chargedBasis: 'WEEKDAYS' });
    expect((await call(tok.emp2).get('/api/me/leave?year=2027')).body.types.find((x: { type: string }) => x.type === 'SICK')).toMatchObject({ used: 16 });
  });

  it('shows a supervisor only their department', async () => {
    const b = (await call(tok.sup).get('/api/leave/balances?year=2026')).body;
    expect(b.people.map((p: { userId: string }) => p.userId)).not.toContain(ids.other);
    expect(b.people.map((p: { userId: string }) => p.userId)).toContain(t.users[0]!.id);
    expect((await call(tok.emp).get('/api/leave/balances')).status).toBe(403);
  });
});

describe('performance reviews', () => {
  let id = '';
  it('goes self-assessment → reviewer → acknowledged, each step only by the right person', async () => {
    const r = await call(tok.hr).post('/api/reviews', { userId: t.users[0]!.id, reviewerId: ids.sup, cycle: '2026 annual', dueOn: '2026-12-15', goals: ['Recertify NLS', 'Lead two in-services'] });
    expect(r.status).toBe(201);
    id = r.body.id;
    expect((await call(tok.sup).put(`/api/reviews/${id}/manager`, { managerComments: 'Too early', rating: 3 })).body.code).toBe('REVIEW_STEP');
    expect((await call(tok.emp2).put(`/api/reviews/${id}/self`, { selfComments: 'Not mine' })).status).toBe(404);
    expect((await call(tok.emp).put(`/api/reviews/${id}/self`, { selfComments: 'A good season.' })).status).toBe(200);
    expect((await call(tok.emp).put(`/api/reviews/${id}/manager`, { managerComments: 'Great', rating: 5 })).status).toBe(404);
    expect((await call(tok.sup).put(`/api/reviews/${id}/manager`, { managerComments: 'Solid work.', rating: 4, goalsMet: [true, false] })).status).toBe(200);
    expect((await call(tok.emp).post(`/api/reviews/${id}/acknowledge`, { employeeComments: 'Thanks.' })).status).toBe(200);
    const mine = (await call(tok.emp).get('/api/me/reviews')).body;
    expect(mine[0]).toMatchObject({ status: 'ACKNOWLEDGED', rating: 4, mine: true });
    expect(mine[0].goals[1].met).toBe(false);
  });
  it('is hidden from people who aren’t part of it', async () => {
    expect((await call(tok.emp2).get('/api/me/reviews')).body).toHaveLength(0);
    expect((await call(tok.sup).get('/api/reviews')).body.map((r: { id: string }) => r.id)).toEqual([id]);
    expect((await call(tok.sup).post('/api/reviews', { userId: t.users[1]!.id, reviewerId: ids.sup, cycle: 'x1', dueOn: '2026-12-01' })).status).toBe(403);
  });
});

describe('training', () => {
  let course = '';
  it('HR sets up courses; mandatory ones show as missing until recorded', async () => {
    expect((await call(tok.sup).post('/api/training/courses', { name: 'WHMIS' })).status).toBe(403);
    const c = await call(tok.hr).post('/api/training/courses', { name: 'Standard First Aid', mandatory: true, renewMonths: 36, positionIds: [t.position.id], hours: 16 });
    expect(c.status).toBe(201);
    course = c.body.id;
    const due = (await call(tok.hr).get('/api/training')).body.due;
    expect(due.filter((d: { courseId: string }) => d.courseId === course).map((d: { userId: string }) => d.userId).sort()).toEqual(t.users.map((u) => u.id).sort());
  });
  it('a supervisor records sessions for their department only', async () => {
    expect((await call(tok.sup).post('/api/training/records', { courseId: course, userIds: [ids.other], completedOn: '2026-05-01' })).status).toBe(404);
    expect((await call(tok.sup).post('/api/training/records', { courseId: course, userIds: t.users.map((u) => u.id), completedOn: '2026-05-01', trainer: 'Red Cross' })).body.recorded).toBe(2);
    const mine = (await call(tok.emp).get('/api/me/training')).body;
    expect(mine.due).toHaveLength(0);
    expect(mine.records[0]).toMatchObject({ courseId: course, completedOn: '2026-05-01' });
    // Expired after the renewal period.
    await owner.trainingRecord.updateMany({ where: { userId: t.users[1]!.id }, data: { completedOn: new Date('2022-01-01') } });
    expect((await call(tok.emp2).get('/api/me/training')).body.due[0].status).toBe('EXPIRED');
  });
});

describe('grievances', () => {
  it('numbers each grievance and keeps the history of steps', async () => {
    const g1 = await call(tok.hr).post('/api/grievances', { userId: t.users[0]!.id, title: 'Overtime distribution', articles: '18.03', filedOn: '2026-10-01', dueOn: '2026-10-15' });
    const g2 = await call(tok.hr).post('/api/grievances', { userId: null, kind: 'POLICY', title: 'Scheduling notice', filedOn: '2026-10-02' });
    expect([g1.body.number, g2.body.number]).toEqual([1, 2]);
    expect((await call(tok.hr).patch(`/api/grievances/${g1.body.id}`, { status: 'STEP_1', note: 'Meeting set' })).status).toBe(200);
    const list = (await call(tok.hr).get('/api/grievances')).body;
    const one = list.find((g: { number: number }) => g.number === 1);
    expect(one.status).toBe('STEP_1');
    expect(one.history.map((x: { status: string }) => x.status)).toEqual(['FILED', 'STEP_1']);
    expect((await call(tok.sup).get('/api/grievances')).status).toBe(403);
  });
});

describe('offboarding', () => {
  it('needs the checklist done, then ends benefits and access', async () => {
    const u = t.users[1]!.id;
    const plan = await call(tok.hr).post('/api/benefits/plans', { name: 'Dental', kind: 'DENTAL', employeeAmount: 10 });
    expect((await call(tok.hr).post('/api/benefits/enrollments', { planId: plan.body.id, userId: u, startsOn: '2026-01-01' })).status).toBe(201);
    const o = await call(tok.hr).post(`/api/users/${u}/offboarding`, { lastDay: '2026-11-30', reason: 'RESIGNATION' });
    expect(o.status).toBe(201);
    const early = await call(tok.hr).post(`/api/offboarding/${o.body.id}/complete`);
    expect(early.body.code).toBe('CHECKLIST_OPEN');
    for (const key of ['finalPay', 'vacationPayout', 'roe', 'benefitsEnded', 'equipmentReturned', 'accessRemoved']) expect((await call(tok.hr).patch(`/api/offboarding/${o.body.id}/items/${key}`, { done: true })).status).toBe(200);
    expect((await call(tok.hr).post(`/api/offboarding/${o.body.id}/complete`)).status).toBe(200);
    expect((await owner.user.findUniqueOrThrow({ where: { id: u } })).status).toBe('TERMINATED');
    const e = await owner.benefitEnrollment.findFirstOrThrow({ where: { userId: u } });
    expect(e.endsOn?.toISOString().slice(0, 10)).toBe('2026-11-30');
    expect((await call(tok.emp2).get('/api/me/leave')).status).toBe(401);
  });
});

describe('HR overview', () => {
  it('counts what needs attention, for HR only', async () => {
    const o = (await call(tok.hr).get('/api/hr/overview')).body;
    expect(o.openGrievances).toBe(2);
    expect(o.offboarding).toBe(0);
    expect(o.trainingDue).toBeGreaterThanOrEqual(0);
    expect(o.staff).toBeGreaterThan(0);
    expect((await call(tok.sup).get('/api/hr/overview')).status).toBe(403);
  });
});
