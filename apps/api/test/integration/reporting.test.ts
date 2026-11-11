import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { signAccessToken } from '../../src/auth/tokens.js';
import { withTenant } from '../../src/lib/db.js';
import { dispatchTenant } from '../../src/lib/outbox.js';
import { draftsFor } from '../../src/services/notifications/notifier.js';
import { approversFor } from '../../src/services/people/reporting.js';
import { app as appDb, owner, seedTenant } from './fixtures.js';

const server = createApp();
const SUB = 'orgline';
let t: Awaited<ReturnType<typeof seedTenant>>;
let other: Awaited<ReturnType<typeof seedTenant>>;
const pos = { guard: '', water: '' };
const ids = { hr: '', sup: '', lead: '', spare: '', guard: '', guard2: '', water: '', outsider: '' };
const tok = { hr: '', sup: '', lead: '', guard: '', guard2: '', water: '' };
type Role = 'HR_ADMIN' | 'AQUATIC_SUPERVISOR' | 'STAFF' | 'EMPLOYEE';
const call = (token: string) => ({
  get: (p: string) => request(server).get(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }),
  post: (p: string, b: object = {}) => request(server).post(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }).send(b),
  put: (p: string, b: object = {}) => request(server).put(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }).send(b),
  patch: (p: string, b: object = {}) => request(server).patch(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }).send(b),
});
const mk = async (roles: Role[], name: string, position?: string) => {
  const u = await owner.user.create({ data: { tenantId: t.tenant.id, roles, employmentStatus: 'FULL_TIME', firstName: name, lastName: 'Line', email: `${name}@orgline.test` } });
  if (position) await owner.userPosition.create({ data: { tenantId: t.tenant.id, userId: u.id, positionId: position } });
  return u.id;
};
const sign = (sub: string, roles: Role[]) => signAccessToken({ sub, tid: t.tenant.id, roles, aat: Math.floor(Date.now() / 1000) });
const day = (n: number) => new Date(Date.now() + n * 86_400_000);
/** Who got a time-off notification about this request. */
const toldAbout = async (requestId: string) =>
  (await owner.notification.findMany({ where: { tenantId: t.tenant.id, type: 'time_off_requested' }, select: { userId: true, params: true } }))
    .filter((n) => (n.params as { requestId?: string }).requestId === requestId)
    .map((n) => n.userId)
    .sort();
const askTimeOff = async (token: string, from: number) => {
  const r = await call(token).post('/api/me/time-off', { type: 'VACATION', startsAt: day(from).toISOString(), endsAt: day(from + 1).toISOString() });
  expect(r.status).toBe(201);
  await dispatchTenant(t.tenant.id);
  return r.body.request.id as string;
};

beforeAll(async () => {
  t = await seedTenant(SUB, 0);
  other = await seedTenant('orgline-other', 1);
  ids.outsider = other.users[0]!.id;
  pos.guard = (await owner.position.create({ data: { tenantId: t.tenant.id, name: 'Pool Guard' } })).id;
  pos.water = (await owner.position.create({ data: { tenantId: t.tenant.id, name: 'Water Operator' } })).id;
  ids.hr = await mk(['HR_ADMIN'], 'hr');
  ids.sup = await mk(['AQUATIC_SUPERVISOR'], 'sup', pos.guard);
  ids.lead = await mk(['AQUATIC_SUPERVISOR'], 'lead', pos.guard);
  ids.spare = await mk(['AQUATIC_SUPERVISOR'], 'spare'); // approves, runs no department
  ids.guard = await mk(['STAFF'], 'guard', pos.guard);
  ids.guard2 = await mk(['STAFF'], 'guardtwo', pos.guard);
  ids.water = await mk(['EMPLOYEE'], 'wally', pos.water);
  for (const k of ['hr', 'sup', 'lead', 'guard', 'guard2', 'water'] as const) {
    const roles = (await owner.user.findUniqueOrThrow({ where: { id: ids[k] } })).roles as Role[];
    tok[k] = await sign(ids[k], roles);
  }
  // Aquatics is run by sup and lead; Water Works has no manager.
  expect((await call(tok.hr).post('/api/departments', { name: 'Aquatics', aquatic: true, positionIds: [pos.guard], managerIds: [ids.sup, ids.lead] })).status).toBe(201);
  expect((await call(tok.hr).post('/api/departments', { name: 'Water Works', positionIds: [pos.water] })).status).toBe(201);
});
afterAll(async () => {
  await appDb.$disconnect();
  await owner.$disconnect();
});

describe('reporting lines', () => {
  it('defaults to the department’s managers, who don’t default to each other', async () => {
    const g = (await call(tok.hr).get(`/api/users/${ids.guard}/reporting`)).body;
    expect(g.source).toBe('department');
    expect(g.managers.map((m: { id: string }) => m.id).sort()).toEqual([ids.sup, ids.lead].sort());
    const s = (await call(tok.hr).get(`/api/users/${ids.sup}/reporting`)).body;
    expect(s.source).toBeNull();
    expect(s.directReports.map((m: { id: string }) => m.id)).toEqual(expect.arrayContaining([ids.guard, ids.guard2]));
  });

  it('HR sets a manager; it is audited', async () => {
    const r = await call(tok.hr).put(`/api/users/${ids.guard}/manager`, { managerId: ids.lead });
    expect(r.status).toBe(200);
    expect(r.body.changed).toBe(1);
    const g = (await call(tok.hr).get(`/api/users/${ids.guard}/reporting`)).body;
    expect([g.source, g.managers.map((m: { id: string }) => m.id)]).toEqual(['set', [ids.lead]]);
    const log = await owner.auditLog.findFirst({ where: { tenantId: t.tenant.id, action: 'user.manager', entityId: ids.guard } });
    expect(log?.after).toEqual({ reportsToId: ids.lead });
    expect(log?.actorId).toBe(ids.hr);
  });

  it('nobody reports to themselves or to someone below them', async () => {
    expect((await call(tok.hr).put(`/api/users/${ids.guard}/manager`, { managerId: ids.guard })).body.code).toBe('MANAGER_SELF');
    expect((await call(tok.hr).put(`/api/users/${ids.lead}/manager`, { managerId: ids.sup })).status).toBe(200);
    // guard → lead → sup: sup can't report to guard, nor lead to guard.
    const loop = await call(tok.hr).put(`/api/users/${ids.sup}/manager`, { managerId: ids.guard });
    expect([loop.status, loop.body.code]).toEqual([400, 'MANAGER_CYCLE']);
    expect((await call(tok.hr).put(`/api/users/${ids.lead}/manager`, { managerId: ids.guard })).body.code).toBe('MANAGER_CYCLE');
    // In bulk, a loop anywhere refuses the whole change.
    const bulk = await call(tok.hr).post('/api/reporting/managers', { userIds: [ids.water, ids.sup], managerId: ids.guard });
    expect(bulk.body.code).toBe('MANAGER_CYCLE');
    expect((await owner.user.findUniqueOrThrow({ where: { id: ids.water } })).reportsToId).toBeNull();
    // And the database refuses a self-loop outright.
    await expect(owner.user.update({ where: { id: ids.guard }, data: { reportsToId: ids.guard } })).rejects.toThrow();
  });

  it('another organization’s person can’t be a manager, or be given one', async () => {
    expect((await call(tok.hr).put(`/api/users/${ids.guard}/manager`, { managerId: ids.outsider })).status).toBe(404);
    expect((await call(tok.hr).put(`/api/users/${ids.outsider}/manager`, { managerId: ids.lead })).status).toBe(404);
    expect((await call(tok.hr).post('/api/reporting/managers', { userIds: [ids.guard2, ids.outsider], managerId: ids.lead })).status).toBe(404);
    expect((await owner.user.findUniqueOrThrow({ where: { id: ids.outsider } })).reportsToId).toBeNull();
  });

  it('a department’s manager sets managers for its people only', async () => {
    expect((await call(tok.lead).put(`/api/users/${ids.guard2}/manager`, { managerId: ids.sup })).status).toBe(200);
    // Water Works isn't theirs: out of scope reads as not found.
    expect((await call(tok.lead).put(`/api/users/${ids.water}/manager`, { managerId: ids.lead })).status).toBe(404);
    // A staff member can't set anyone's manager.
    expect((await call(tok.guard).put(`/api/users/${ids.guard2}/manager`, { managerId: ids.guard })).status).toBe(403);
    // HR in bulk, then back to the default with null.
    expect((await call(tok.hr).post('/api/reporting/managers', { userIds: [ids.water], managerId: ids.hr })).body.changed).toBe(1);
    expect((await call(tok.hr).post('/api/reporting/managers', { userIds: [ids.water], managerId: null })).body.changed).toBe(1);
  });
});

describe('routing approvals to the manager', () => {
  it('time off goes to the person’s manager only', async () => {
    const id = await askTimeOff(tok.guard, 10); // guard → lead
    expect(await toldAbout(id)).toEqual([ids.lead]);
  });

  it('no manager who can approve: their department’s managers, then everyone with the permission', async () => {
    // guard2 → sup (set). Clear it: back to Aquatics' managers.
    await call(tok.hr).put(`/api/users/${ids.guard2}/manager`, { managerId: null });
    const id = await askTimeOff(tok.guard2, 12);
    expect(await toldAbout(id)).toEqual([ids.sup, ids.lead].sort());
    // A manager who can't approve time off (HR here) is passed over.
    await call(tok.hr).put(`/api/users/${ids.water}/manager`, { managerId: ids.hr });
    const w = await askTimeOff(tok.water, 14);
    // Water Works has no manager: everyone who approves time off, as before.
    expect(await toldAbout(w)).toEqual([ids.sup, ids.lead, ids.spare].sort());
  });

  it('expense and overtime-claim approvals follow the same line', async () => {
    const r = await withTenant(t.tenant.id, (tx) => approversFor(tx, t.tenant.id, [ids.guard], 'expenses.approve'));
    expect(r).toEqual({ to: [ids.lead], via: 'manager' });
    const drafts = await withTenant(t.tenant.id, (tx) => draftsFor(tx, { type: 'shift.offer.pending_approval', tenantId: t.tenant.id, offerId: '00000000-0000-0000-0000-000000000001', shiftId: '00000000-0000-0000-0000-000000000002', claimantId: ids.guard, overtimeHours: '2' }));
    expect(drafts.filter((d) => d.type === 'claim_needs_approval').map((d) => d.userId)).toEqual([ids.lead]);
  });

  it('“My team” narrows the queue; the whole queue stays for everyone who could see it', async () => {
    const all = (await call(tok.lead).get('/api/time-off')).body.map((r: { userId: string }) => r.userId);
    expect(all).toEqual(expect.arrayContaining([ids.guard, ids.guard2]));
    const mine = (await call(tok.lead).get('/api/time-off?team=mine')).body.map((r: { userId: string }) => r.userId);
    // guard reports to lead; guard2 defaults to Aquatics' managers (lead among them).
    expect(new Set(mine)).toEqual(new Set([ids.guard, ids.guard2]));
    await call(tok.hr).put(`/api/users/${ids.guard2}/manager`, { managerId: ids.sup });
    const narrowed = (await call(tok.lead).get('/api/time-off?team=mine')).body.map((r: { userId: string }) => r.userId);
    expect(new Set(narrowed)).toEqual(new Set([ids.guard]));
    // The filter never adds people outside the lead's department, even if they report to them.
    await call(tok.hr).put(`/api/users/${ids.water}/manager`, { managerId: ids.lead });
    const still = (await call(tok.lead).get('/api/time-off?team=mine')).body.map((r: { userId: string }) => r.userId);
    expect(still).not.toContain(ids.water);
    for (const p of ['/api/punches?team=mine', '/api/offers/pending?team=mine']) expect((await call(tok.lead).get(p)).status, p).toBe(200);
    await call(tok.hr).put(`/api/users/${ids.water}/manager`, { managerId: null });
  });

  it('performance reviews default the reviewer to the manager', async () => {
    const r = await call(tok.hr).post('/api/reviews', { userId: ids.guard, cycle: '2026 annual', dueOn: '2026-12-15' });
    expect(r.status).toBe(201);
    expect((await owner.performanceReview.findUniqueOrThrow({ where: { id: r.body.id } })).reviewerId).toBe(ids.lead);
    // Nobody to default to: HR has to choose.
    expect((await call(tok.hr).post('/api/reviews', { userId: ids.water, cycle: '2026 annual', dueOn: '2026-12-15' })).body.code).toBe('NO_REVIEWER');
  });
});

describe('org chart', () => {
  it('HR sees everyone under their manager', async () => {
    const r = await call(tok.hr).get('/api/org-chart');
    expect(r.status).toBe(200);
    const by = new Map(r.body.people.map((p: { id: string; managerId: string | null; directReports: number }) => [p.id, p]));
    expect((by.get(ids.guard) as { managerId: string }).managerId).toBe(ids.lead);
    expect((by.get(ids.lead) as { managerId: string }).managerId).toBe(ids.sup);
    expect((by.get(ids.sup) as { directReports: number }).directReports).toBeGreaterThanOrEqual(2);
    expect(by.has(ids.outsider)).toBe(false);
    // One department at a time.
    const water = (await call(tok.hr).get('/api/departments')).body.departments.find((d: { name: string }) => d.name === 'Water Works').id;
    expect((await call(tok.hr).get(`/api/org-chart?department=${water}`)).body.people.map((p: { id: string }) => p.id)).toEqual([ids.water]);
  });

  it('a department’s manager sees their department only; staff can’t open it', async () => {
    const people = (await call(tok.lead).get('/api/org-chart')).body.people.map((p: { id: string }) => p.id);
    expect(people).toEqual(expect.arrayContaining([ids.guard, ids.guard2, ids.sup]));
    expect(people).not.toContain(ids.water);
    expect(people).not.toContain(ids.hr);
    expect((await call(tok.guard).get('/api/org-chart')).status).toBe(403);
    // Another organization's chart never shows here.
    const otherHr = await owner.user.create({ data: { tenantId: other.tenant.id, roles: ['HR_ADMIN'], employmentStatus: 'FULL_TIME', firstName: 'Other', lastName: 'HR', email: 'hr@orgline-other.test' } });
    const tk = await signAccessToken({ sub: otherHr.id, tid: other.tenant.id, roles: ['HR_ADMIN'], aat: Math.floor(Date.now() / 1000) });
    const theirs = (await request(server).get('/api/org-chart').set('x-tenant-subdomain', 'orgline-other').auth(tk, { type: 'bearer' })).body.people.map((p: { id: string }) => p.id);
    expect(theirs).not.toContain(ids.guard);
    expect(theirs).toContain(ids.outsider);
  });

  it('my profile shows my manager and my team', async () => {
    const me = (await call(tok.guard).get('/api/me/reporting')).body;
    expect(me.managers.map((m: { id: string }) => m.id)).toEqual([ids.lead]);
    const lead = (await call(tok.lead).get('/api/me/reporting')).body;
    expect(lead.directReports.map((m: { id: string }) => m.id)).toContain(ids.guard);
  });
});

describe('leaving', () => {
  it('offboarding someone with reports asks who they report to now', async () => {
    const o = await call(tok.hr).post(`/api/users/${ids.lead}/offboarding`, { lastDay: '2026-12-31', reason: 'RESIGNATION' });
    expect(o.status).toBe(201);
    const list = (await call(tok.hr).get('/api/offboarding')).body.offboardings.find((x: { id: string }) => x.id === o.body.id);
    expect(list.reports).toBe(1);
    await owner.offboarding.update({ where: { id: o.body.id }, data: { checklist: ['finalPay', 'vacationPayout', 'roe', 'benefitsEnded', 'equipmentReturned', 'accessRemoved', 'exitInterview'].map((key) => ({ key, done: true })) } });
    const ask = await call(tok.hr).post(`/api/offboarding/${o.body.id}/complete`);
    expect([ask.status, ask.body.code]).toEqual([409, 'HAS_REPORTS']);
    expect(ask.body.details.reports.map((r: { id: string }) => r.id)).toEqual([ids.guard]);
    expect((await call(tok.hr).post(`/api/offboarding/${o.body.id}/complete`, { reassignTo: ids.sup })).status).toBe(200);
    expect((await owner.user.findUniqueOrThrow({ where: { id: ids.guard } })).reportsToId).toBe(ids.sup);
    expect((await owner.user.findUniqueOrThrow({ where: { id: ids.lead } })).status).toBe('TERMINATED');
  });

  it('a manager who left no longer counts: their people fall back to the department', async () => {
    await owner.user.update({ where: { id: ids.guard2 }, data: { reportsToId: ids.lead } });
    const g = (await call(tok.hr).get(`/api/users/${ids.guard2}/reporting`)).body;
    expect([g.source, g.managers.map((m: { id: string }) => m.id)]).toEqual(['department', [ids.sup]]);
  });
});
