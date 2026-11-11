/** Fill the schedule, end to end: department scope, draft-only until publish, undo, settings, availability window. */
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { createApp } from '../../src/app.js';
import { signAccessToken } from '../../src/auth/tokens.js';
import { app as appDb, owner, seedTenant } from './fixtures.js';

const server = createApp();
const SUB = 'fillwk';
const SUB2 = 'fillwk2';
const TZ = 'America/Vancouver';
const now = () => Math.floor(Date.now() / 1000);
const call = (token: string, sub = SUB) => ({
  get: (p: string) => request(server).get(p).set('x-tenant-subdomain', sub).auth(token, { type: 'bearer' }),
  post: (p: string, b: object = {}) => request(server).post(p).set('x-tenant-subdomain', sub).auth(token, { type: 'bearer' }).send(b),
  put: (p: string, b: object = {}) => request(server).put(p).set('x-tenant-subdomain', sub).auth(token, { type: 'bearer' }).send(b),
});

// The Monday at least nine days out, so the week is in the future and beyond a one-week window.
const monday = DateTime.now().setZone(TZ).plus({ days: 2 }).startOf('week').plus({ weeks: 2 });
const WEEK = monday.toISODate()!;
const at = (dayOffset: number, hour: number) => monday.plus({ days: dayOffset }).set({ hour }).toJSDate();

let t: Awaited<ReturnType<typeof seedTenant>>;
let t2: Awaited<ReturnType<typeof seedTenant>>;
let aquatics: string;
let parks: string;
let parksPos: string;
const people = { g: [] as string[], p0: '', p1: '' };
const tok = { admin: '', parksSup: '', guard: '', admin2: '' };
const lifeguardShifts: string[] = [];
let parksShift = '';

const allWeek = (tenantId: string, userId: string) => owner.availability.createMany({ data: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ tenantId, userId, dayOfWeek: d, startMinute: 0, endMinute: 1440, effectiveFrom: new Date('2020-01-01') })) });

beforeAll(async () => {
  t = await seedTenant(SUB, 4);
  t2 = await seedTenant(SUB2, 1);
  aquatics = (await owner.department.create({ data: { tenantId: t.tenant.id, name: 'Aquatics', aquatic: true } })).id;
  parks = (await owner.department.create({ data: { tenantId: t.tenant.id, name: 'Parks', nameFr: 'Parcs' } })).id;
  await owner.position.update({ where: { id: t.position.id }, data: { departmentId: aquatics } });
  parksPos = (await owner.position.create({ data: { tenantId: t.tenant.id, name: 'Parks Worker', departmentId: parks } })).id;
  people.g = t.users.map((u) => u.id);
  for (const id of people.g) await allWeek(t.tenant.id, id);
  // p0: Parks first, also a certified lifeguard (two positions, across departments). p1: Parks only.
  for (const [key, both] of [['p0', true], ['p1', false]] as const) {
    const u = await owner.user.create({ data: { tenantId: t.tenant.id, roles: ['STAFF'], employmentStatus: 'PART_TIME', firstName: key, lastName: 'Parks', email: `${key}@${SUB}.test`, dateOfBirth: new Date('1990-01-01') } });
    await owner.userPosition.create({ data: { tenantId: t.tenant.id, userId: u.id, positionId: parksPos, approvedAt: new Date('2020-01-01') } });
    if (both) {
      await owner.userPosition.create({ data: { tenantId: t.tenant.id, userId: u.id, positionId: t.position.id } });
      await owner.userCertification.create({ data: { tenantId: t.tenant.id, userId: u.id, certificationId: t.nls.id, issueDate: new Date('2025-01-01'), expiryDate: new Date('2030-01-01'), verifiedAt: new Date() } });
    }
    await allWeek(t.tenant.id, u.id);
    people[key] = u.id;
  }
  // Five lifeguards needed at once on Monday morning (four guards + p0), two more on Tuesday.
  for (const [d, n] of [[0, 5], [1, 2]] as const) {
    for (let i = 0; i < n; i++) {
      lifeguardShifts.push((await owner.shift.create({ data: { tenantId: t.tenant.id, facilityId: t.facility.id, positionId: t.position.id, startsAt: at(d, 9), endsAt: at(d, 13), status: 'DRAFT' } })).id);
    }
  }
  parksShift = (await owner.shift.create({ data: { tenantId: t.tenant.id, facilityId: t.facility.id, positionId: parksPos, startsAt: at(0, 9), endsAt: at(0, 13), status: 'DRAFT' } })).id;

  const admin = await owner.user.create({ data: { tenantId: t.tenant.id, roles: ['HR_ADMIN', 'AQUATIC_SUPERVISOR'], employmentStatus: 'FULL_TIME', firstName: 'Ada', lastName: 'Admin', email: `admin@${SUB}.test` } });
  tok.admin = await signAccessToken({ sub: admin.id, tid: t.tenant.id, roles: ['HR_ADMIN', 'AQUATIC_SUPERVISOR'], aat: now() });
  const role = await owner.customRole.create({ data: { tenantId: t.tenant.id, name: 'Parks Supervisor', permissions: ['schedule.read', 'schedule.write', 'schedule.assist', 'users.read'], scopePositionIds: [parksPos] } });
  const sup = await owner.user.create({ data: { tenantId: t.tenant.id, roles: ['EMPLOYEE'], employmentStatus: 'FULL_TIME', firstName: 'Sam', lastName: 'Sup', email: `sup@${SUB}.test` } });
  await owner.userCustomRole.create({ data: { tenantId: t.tenant.id, userId: sup.id, customRoleId: role.id } });
  tok.parksSup = await signAccessToken({ sub: sup.id, tid: t.tenant.id, roles: ['EMPLOYEE'], aat: now() });
  tok.guard = await signAccessToken({ sub: people.g[0]!, tid: t.tenant.id, roles: ['STAFF'], aat: now() });
  const admin2 = await owner.user.create({ data: { tenantId: t2.tenant.id, roles: ['HR_ADMIN', 'AQUATIC_SUPERVISOR'], employmentStatus: 'FULL_TIME', firstName: 'Bo', lastName: 'Two', email: `admin@${SUB2}.test` } });
  tok.admin2 = await signAccessToken({ sub: admin2.id, tid: t2.tenant.id, roles: ['HR_ADMIN', 'AQUATIC_SUPERVISOR'], aat: now() });
});
afterAll(async () => {
  await appDb.$disconnect();
  await owner.$disconnect();
});

const run = (token: string, departmentId: string, extra: object = {}, sub = SUB) => call(token, sub).post('/api/schedule/fill/run', { departmentId, weekStart: WEEK, horizonStart: WEEK, weekIndex: 0, horizonWeeks: 1, ...extra });
type RunOut = { proposals: Array<{ slotId: string; userId: string; tentative: boolean; reasons: Array<{ code: string }> }>; slots: Array<{ id: string; version: number }>; people: Record<string, { name: string; fromDepartment: { name: string } | null }>; summary: { filled: number; slots: number }; week: { tentative: boolean }; settings: { useSeniority: boolean } };
const accept = (token: string, out: RunOut, only?: (p: RunOut['proposals'][number]) => boolean) =>
  call(token).post('/api/schedule/fill/accept', { items: out.proposals.filter(only ?? (() => true)).map((p) => ({ shiftId: p.slotId, userId: p.userId, expectedVersion: out.slots.find((s) => s.id === p.slotId)!.version, previousUserId: null })) });

describe('Fill the schedule', () => {
  let first: RunOut;

  it('offers the departments a person may fill, with the plan-ahead default', async () => {
    const r = await call(tok.admin).get('/api/schedule/fill/options');
    expect(r.status).toBe(200);
    expect(r.body.departments.map((d: { name: string }) => d.name)).toEqual(['Aquatics', 'Parks']);
    expect(r.body.canAll).toBe(true);
    expect(r.body.settings.planAheadWeeks).toBe(2);
    const sup = await call(tok.parksSup).get('/api/schedule/fill/options');
    expect(sup.body.departments.map((d: { id: string }) => d.id)).toEqual([parks]);
    expect(sup.body.defaultDepartmentId).toBe(parks);
    expect((await call(tok.guard).get('/api/schedule/fill/options')).status).toBe(403);
  });

  it('fills a department’s week with its own people (and marks people from other departments), writing nothing', async () => {
    const r = await run(tok.admin, aquatics);
    expect(r.status).toBe(200);
    first = r.body;
    expect(first.summary).toMatchObject({ slots: 7, filled: 7 });
    const ids = new Set(first.proposals.map((p) => p.userId));
    expect(ids.has(people.p1)).toBe(false);
    expect(ids.has(people.p0)).toBe(true);
    expect(first.people[people.p0]!.fromDepartment).toEqual({ name: 'Parks', nameFr: 'Parcs' });
    expect(first.slots.map((s) => s.id)).not.toContain(parksShift);
    // A preview: nothing assigned yet, and the run is audited.
    expect(await owner.shift.count({ where: { id: { in: lifeguardShifts }, userId: { not: null } } })).toBe(0);
    expect(await owner.auditLog.count({ where: { tenantId: t.tenant.id, action: 'schedule.fill.run' } })).toBe(1);
  });

  it('a department manager fills only their department, and can’t touch another', async () => {
    expect((await run(tok.parksSup, aquatics)).status).toBe(404);
    expect((await run(tok.parksSup, 'all')).body.slots.map((s: { id: string }) => s.id)).toEqual([parksShift]);
    const r = await call(tok.parksSup).post('/api/schedule/fill/accept', { items: [{ shiftId: lifeguardShifts[0], userId: people.g[0], expectedVersion: 0, previousUserId: null }] });
    expect(r.status).toBe(403);
  });

  let undoId = '';
  it('accepting writes draft assignments only; staff don’t see them until publish', async () => {
    const monday0 = first.proposals.filter((p) => lifeguardShifts.slice(0, 5).includes(p.slotId));
    const r = await accept(tok.admin, first, (p) => monday0.includes(p));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ applied: 5, skipped: [] });
    undoId = r.body.undoId;
    const rows = await owner.shift.findMany({ where: { id: { in: lifeguardShifts.slice(0, 5) } } });
    expect(rows.every((s) => s.status === 'DRAFT' && s.userId)).toBe(true);
    const mine = monday0.find((p) => p.userId === people.g[0]);
    const range = `from=${encodeURIComponent(monday.toJSDate().toISOString())}&to=${encodeURIComponent(monday.plus({ days: 7 }).toJSDate().toISOString())}`;
    expect((await call(tok.guard).get(`/api/me/shifts?${range}`)).body).toEqual([]);
    if (mine) {
      const pub = await call(tok.admin).post('/api/shifts/publish', { facilityId: t.facility.id, from: monday.toJSDate().toISOString(), to: monday.plus({ days: 7 }).toJSDate().toISOString(), shiftIds: [mine.slotId] });
      expect(pub.body.published).toBe(1);
      expect((await call(tok.guard).get(`/api/me/shifts?${range}`)).body.map((s: { id: string }) => s.id)).toEqual([mine.slotId]);
    }
  });

  it('a person shared by two departments is never double-booked', async () => {
    const r = await run(tok.parksSup, parks);
    expect(r.body.proposals.map((p: { userId: string }) => p.userId)).toEqual([people.p1]);
  });

  it('accepting again is refused for shifts that changed; undo restores the drafts it still owns', async () => {
    const again = await accept(tok.admin, first, (p) => p.slotId === lifeguardShifts[1]);
    expect(again.body.skipped).toEqual([{ shiftId: lifeguardShifts[1], code: 'CHANGED' }]);
    const u = await call(tok.admin).post('/api/schedule/fill/undo', { undoId });
    expect(u.status).toBe(200);
    // One of the five was published meanwhile, so it stays.
    expect(u.body.of).toBe(5);
    expect(u.body.restored).toBeGreaterThanOrEqual(4);
    expect((await call(tok.admin).post('/api/schedule/fill/undo', { undoId })).status).toBe(400);
  });

  it('keeps cities apart', async () => {
    expect((await run(tok.admin2, aquatics, {}, SUB2)).status).toBe(404);
    const r = await call(tok.admin2, SUB2).post('/api/schedule/fill/accept', { items: [{ shiftId: lifeguardShifts[6], userId: people.g[1], expectedVersion: 0, previousUserId: null }] });
    expect(r.body).toMatchObject({ applied: 0, skipped: [{ code: 'NOT_FOUND' }] });
    expect((await owner.shift.findUniqueOrThrow({ where: { id: lifeguardShifts[6]! } })).userId).toBeNull();
  });
});

describe('Plan ahead: one setting for availability and the fill horizon', () => {
  it('the organization’s window is the default horizon; a department can override it', async () => {
    expect((await call(tok.admin).put('/api/schedule/fill/settings', { departmentId: null, planAheadWeeks: 4 })).status).toBe(200);
    let opts = (await call(tok.admin).get('/api/schedule/fill/options')).body;
    expect(opts.settings.planAheadWeeks).toBe(4);
    expect(opts.departments.map((d: { planAheadWeeks: number }) => d.planAheadWeeks)).toEqual([4, 4]);
    expect((await call(tok.parksSup).put('/api/schedule/fill/settings', { departmentId: null, planAheadWeeks: 1 })).status).toBe(403);
    expect((await call(tok.parksSup).put('/api/schedule/fill/settings', { departmentId: aquatics, planAheadWeeks: 1 })).status).toBe(404);
    expect((await call(tok.parksSup).put('/api/schedule/fill/settings', { departmentId: parks, planAheadWeeks: 1 })).status).toBe(200);
    opts = (await call(tok.admin).get('/api/schedule/fill/options')).body;
    expect(opts.departments.find((d: { id: string }) => d.id === parks).planAheadWeeks).toBe(1);
    expect((await call(tok.parksSup).get('/api/schedule/fill/options')).body.settings.planAheadWeeks).toBe(1);
  });

  it('saving the overtime policy keeps the plan-ahead setting', async () => {
    expect((await call(tok.admin).put('/api/overtime/policy', { countRefusals: true, clause: null, periodStartMonth: 1 })).status).toBe(200);
    expect((await call(tok.admin).get('/api/schedule/fill/options')).body.settings.planAheadWeeks).toBe(4);
  });

  it('weeks beyond the window are tentative and say so', async () => {
    const parksRun = (await run(tok.parksSup, parks)).body as RunOut;
    expect(parksRun.week.tentative).toBe(true);
    expect(parksRun.proposals.every((p) => p.tentative)).toBe(true);
    const aq = (await run(tok.admin, aquatics)).body as RunOut;
    expect(aq.week.tentative).toBe(false);
  });

  it('staff see the window, confirm their usual availability, and supervisors see who hasn’t', async () => {
    const w = await call(tok.guard).get('/api/me/availability/window');
    expect(w.body).toMatchObject({ planAheadWeeks: 4, current: false, confirmedThrough: null });
    const c = await call(tok.guard).post('/api/me/availability/confirm');
    expect(c.body).toMatchObject({ current: true, confirmedThrough: w.body.through });
    const st = await call(tok.admin).get(`/api/availability/status?departmentId=${aquatics}`);
    const byId = new Map(st.body.people.map((p: { id: string; current: boolean }) => [p.id, p.current]));
    expect(byId.get(people.g[0])).toBe(true);
    expect(byId.get(people.g[1])).toBe(false);
    expect(byId.has(people.p1)).toBe(false);
  });

  it('reminders go only to people in the department who aren’t current', async () => {
    const r = await call(tok.parksSup).post('/api/availability/remind', { departmentId: parks });
    expect(r.body.sent).toBe(2); // p0 and p1
    const sent = await owner.notification.findMany({ where: { tenantId: t.tenant.id, type: 'availability_reminder' }, select: { userId: true } });
    expect(new Set(sent.map((n) => n.userId))).toEqual(new Set([people.p0, people.p1]));
    expect((await call(tok.parksSup).post('/api/availability/remind', { departmentId: aquatics })).status).toBe(404);
  });

  it('with seniority off, nothing about seniority is used or shown', async () => {
    const f = (await owner.tenant.findUniqueOrThrow({ where: { id: t.tenant.id } })).features as Record<string, unknown>;
    await owner.tenant.update({ where: { id: t.tenant.id }, data: { features: { ...f, seniority: false } } });
    const { forgetFeatures } = await import('../../src/services/platform/features.js');
    forgetFeatures(t.tenant.id);
    const opts = (await call(tok.admin).get('/api/schedule/fill/options')).body;
    expect(opts.seniorityOn).toBe(false);
    expect(opts.departments.every((d: object) => !('useSeniority' in d))).toBe(true);
    const r = (await run(tok.admin, aquatics, { weights: { seniority: 10 } })).body as RunOut;
    expect(r.settings.useSeniority).toBe(false);
    expect(JSON.stringify(r.proposals)).not.toContain('SENIORITY');
  });
});
