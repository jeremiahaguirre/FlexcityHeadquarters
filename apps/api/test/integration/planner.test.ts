/** The schedule builder's manual planner: board, batch eligibility, drops, copy, undo — scope, rules and tenants. */
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { createApp } from '../../src/app.js';
import { signAccessToken } from '../../src/auth/tokens.js';
import { app as appDb, owner, seedTenant } from './fixtures.js';

const server = createApp();
const SUB = 'plannerwk';
const SUB2 = 'plannerwk2';
const TZ = 'America/Vancouver';
const now = () => Math.floor(Date.now() / 1000);
const call = (token: string, sub = SUB) => ({
  get: (p: string) => request(server).get(p).set('x-tenant-subdomain', sub).auth(token, { type: 'bearer' }),
  post: (p: string, b: object = {}) => request(server).post(p).set('x-tenant-subdomain', sub).auth(token, { type: 'bearer' }).send(b),
});

const monday = DateTime.now().setZone(TZ).plus({ days: 2 }).startOf('week').plus({ weeks: 2 });
const WEEK = monday.toISODate()!;
const NEXT = monday.plus({ weeks: 1 }).toISODate()!;
const END = monday.plus({ weeks: 1 }).toISODate()!;
const at = (dayOffset: number, hour: number) => monday.plus({ days: dayOffset }).set({ hour }).toJSDate();

let t: Awaited<ReturnType<typeof seedTenant>>;
let t2: Awaited<ReturnType<typeof seedTenant>>;
let aquatics: string;
let parks: string;
let parksPos: string;
const people = { g: [] as string[], p0: '', p1: '' };
const tok = { admin: '', parksSup: '', guard: '', admin2: '' };
let openShift = '';
let parksShift = '';
let tuesday = '';

const allWeek = (tenantId: string, userId: string) => owner.availability.createMany({ data: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ tenantId, userId, dayOfWeek: d, startMinute: 0, endMinute: 1440, effectiveFrom: new Date('2020-01-01') })) });

beforeAll(async () => {
  t = await seedTenant(SUB, 4);
  t2 = await seedTenant(SUB2, 1);
  aquatics = (await owner.department.create({ data: { tenantId: t.tenant.id, name: 'Aquatics', aquatic: true } })).id;
  parks = (await owner.department.create({ data: { tenantId: t.tenant.id, name: 'Parks', nameFr: 'Parcs' } })).id;
  await owner.position.update({ where: { id: t.position.id }, data: { departmentId: aquatics } });
  parksPos = (await owner.position.create({ data: { tenantId: t.tenant.id, name: 'Parks Worker', departmentId: parks } })).id;
  people.g = t.users.map((u) => u.id);
  // Guard 0..2 have availability; guard 3 submitted none (a warning, not a refusal, by hand).
  for (const id of people.g.slice(0, 3)) await allWeek(t.tenant.id, id);
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
  // p0 already works Parks on Monday 9–13 (another department's draft).
  parksShift = (await owner.shift.create({ data: { tenantId: t.tenant.id, facilityId: t.facility.id, positionId: parksPos, userId: people.p0, startsAt: at(0, 9), endsAt: at(0, 13), status: 'DRAFT' } })).id;
  openShift = (await owner.shift.create({ data: { tenantId: t.tenant.id, facilityId: t.facility.id, positionId: t.position.id, startsAt: at(0, 9), endsAt: at(0, 13), status: 'DRAFT' } })).id;
  tuesday = (await owner.shift.create({ data: { tenantId: t.tenant.id, facilityId: t.facility.id, positionId: t.position.id, userId: people.g[1], startsAt: at(1, 9), endsAt: at(1, 13), status: 'DRAFT' } })).id;
  // Guard 2 is on approved time off all Wednesday.
  await owner.timeOffRequest.create({ data: { tenantId: t.tenant.id, userId: people.g[2]!, type: 'VACATION', startsAt: at(2, 0), endsAt: at(3, 0), status: 'APPROVED' } });

  const admin = await owner.user.create({ data: { tenantId: t.tenant.id, roles: ['HR_ADMIN', 'AQUATIC_SUPERVISOR'], employmentStatus: 'FULL_TIME', firstName: 'Ada', lastName: 'Admin', email: `admin@${SUB}.test` } });
  tok.admin = await signAccessToken({ sub: admin.id, tid: t.tenant.id, roles: ['HR_ADMIN', 'AQUATIC_SUPERVISOR'], aat: now() });
  const role = await owner.customRole.create({ data: { tenantId: t.tenant.id, name: 'Parks Supervisor', permissions: ['schedule.read', 'schedule.write', 'users.read'], scopePositionIds: [parksPos] } });
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

type Reason = { code: string; at?: string; n?: number[] };
type Cells = { ok: number[]; warn: Array<[number, number]>; block: Array<[number, number]> };
type Elig = { users: string[]; reasons: Reason[][]; shifts: Record<string, Cells>; days: Record<string, Cells> };
const statusIn = (e: Elig, cells: Cells, userId: string) => {
  const i = e.users.indexOf(userId);
  if (cells.ok.includes(i)) return { status: 'ok', reasons: [] as Reason[] };
  const w = cells.warn.find((x) => x[0] === i);
  if (w) return { status: 'warn', reasons: e.reasons[w[1]]! };
  const b = cells.block.find((x) => x[0] === i);
  if (b) return { status: 'block', reasons: e.reasons[b[1]]! };
  return { status: 'none', reasons: [] as Reason[] };
};
const elig = (token: string, body: object = {}, sub = SUB) => call(token, sub).post('/api/schedule/planner/eligibility', { departmentId: aquatics, from: WEEK, to: END, ...body });

describe('Manual planner: board and eligibility', () => {
  it('shows the department’s people (with people from other departments marked) and shifts', async () => {
    const r = await call(tok.admin).get(`/api/schedule/planner?departmentId=${aquatics}&from=${WEEK}&to=${END}`);
    expect(r.status).toBe(200);
    const ids = r.body.people.map((p: { id: string }) => p.id);
    expect(ids).toEqual(expect.arrayContaining([...people.g, people.p0]));
    expect(ids).not.toContain(people.p1);
    const p0 = r.body.people.find((p: { id: string }) => p.id === people.p0);
    expect(p0.fromDepartment).toEqual({ name: 'Parks', nameFr: 'Parcs' });
    // Hours count every department: p0's Parks shift is 4 h.
    expect(p0.scheduledHours).toBe(4);
    const g2 = r.body.people.find((p: { id: string }) => p.id === people.g[2]);
    expect(g2.timeOff[monday.plus({ days: 2 }).toISODate()!]).toEqual([[0, 1440]]);
    expect(g2.availability[WEEK]).toEqual([[0, 1440]]);
    expect(r.body.shifts.map((s: { id: string }) => s.id).sort()).toEqual([openShift, tuesday].sort());
    expect(r.body.usual[t.position.id][0]).toMatchObject({ start: '09:00', end: '13:00' });
  });

  it('needs schedule.write, and a department lead sees only their department', async () => {
    expect((await call(tok.guard).get(`/api/schedule/planner?departmentId=${aquatics}&from=${WEEK}&to=${END}`)).status).toBe(403);
    expect((await elig(tok.guard)).status).toBe(403);
    expect((await call(tok.parksSup).get(`/api/schedule/planner?departmentId=${aquatics}&from=${WEEK}&to=${END}`)).status).toBe(404);
    expect((await elig(tok.parksSup)).status).toBe(404);
    const own = await call(tok.parksSup).get(`/api/schedule/planner?departmentId=${parks}&from=${WEEK}&to=${END}`);
    expect(own.body.shifts.map((s: { id: string }) => s.id)).toEqual([parksShift]);
    expect((await call(tok.admin).get(`/api/schedule/planner?departmentId=${aquatics}&from=${WEEK}&to=2099-01-01`)).status).toBe(400);
  });

  it('returns per person × shift and per day: ok, warnings and refusals with reasons', async () => {
    const r = await elig(tok.admin, { days: true });
    expect(r.status).toBe(200);
    const e = r.body as Elig;
    const open = e.shifts[openShift]!;
    expect(statusIn(e, open, people.g[0]!).status).toBe('ok');
    // Cross-department: already working Parks 9–13.
    expect(statusIn(e, open, people.p0)).toEqual({ status: 'block', reasons: [{ code: 'OVERLAPPING_SHIFT', at: '09:00-13:00' }] });
    // No availability submitted: allowed by hand, with a warning.
    expect(statusIn(e, open, people.g[3]!)).toMatchObject({ status: 'warn', reasons: [{ code: 'NOT_AVAILABLE' }] });
    // Not in the department's people at all.
    expect(e.users).not.toContain(people.p1);
    const wed = e.days[monday.plus({ days: 2 }).toISODate()!]!;
    expect(statusIn(e, wed, people.g[2]!)).toMatchObject({ status: 'block', reasons: [{ code: 'ON_APPROVED_TIME_OFF' }] });
    expect(statusIn(e, wed, people.g[0]!).status).toBe('ok');
    // The person on a shift isn't blocked by it.
    expect(statusIn(e, e.shifts[tuesday]!, people.g[1]!).status).toBe('ok');
  });

  it('narrows to some people', async () => {
    const r = await elig(tok.admin, { userIds: [people.g[0]] });
    expect(r.body.users).toEqual([people.g[0]]);
  });
});

describe('Manual planner: drops', () => {
  it('creates a draft shift with a person, audited; a hard rule refuses and nothing is kept', async () => {
    const before = await owner.shift.count({ where: { tenantId: t.tenant.id } });
    const r = await call(tok.admin).post('/api/schedule/planner/shifts', { facilityId: t.facility.id, positionId: t.position.id, startsAt: at(3, 6), endsAt: at(3, 10), userIds: [people.g[0]] });
    expect(r.status).toBe(201);
    const s = await owner.shift.findUniqueOrThrow({ where: { id: r.body.ids[0] } });
    expect(s).toMatchObject({ status: 'DRAFT', userId: people.g[0] });
    expect(await owner.auditLog.count({ where: { entityId: s.id, action: { in: ['shift.create', 'shift.assign'] } } })).toBe(2);
    // p0 works Parks Monday 9–13: refused, and the shift isn't left behind.
    const no = await call(tok.admin).post('/api/schedule/planner/shifts', { facilityId: t.facility.id, positionId: t.position.id, startsAt: at(0, 10), endsAt: at(0, 14), userIds: [people.p0] });
    expect(no.status).toBe(422);
    expect(no.body.error?.code ?? no.body.code).toBe('NOT_ELIGIBLE');
    expect(await owner.shift.count({ where: { tenantId: t.tenant.id } })).toBe(before + 1);
    // On time off: refused.
    expect((await call(tok.admin).post('/api/schedule/planner/shifts', { facilityId: t.facility.id, positionId: t.position.id, startsAt: at(2, 9), endsAt: at(2, 13), userIds: [people.g[2]] })).status).toBe(422);
  });

  it('asks before overtime and keeps it when confirmed', async () => {
    const body = { facilityId: t.facility.id, positionId: t.position.id, startsAt: at(4, 6), endsAt: at(4, 16), userIds: [people.g[1]] };
    const r = await call(tok.admin).post('/api/schedule/planner/shifts', body);
    expect(r.status).toBe(409);
    expect(r.body.error?.code ?? r.body.code).toBe('OVERTIME_REQUIRES_ACK');
    expect((await call(tok.admin).post('/api/schedule/planner/shifts', { ...body, acknowledgeOvertime: true })).status).toBe(201);
  });

  it('moves, resizes, reassigns and copies a shift; refuses a move into a conflict', async () => {
    let s = await owner.shift.findUniqueOrThrow({ where: { id: tuesday } });
    // Move to Thursday 13–17 and stretch to 18.
    let r = await call(tok.admin).post(`/api/schedule/planner/shifts/${tuesday}/move`, { expectedVersion: s.version, startsAt: at(3, 13), endsAt: at(3, 18) });
    expect(r.status).toBe(200);
    s = await owner.shift.findUniqueOrThrow({ where: { id: tuesday } });
    expect([s.startsAt.getTime(), s.endsAt.getTime(), s.userId]).toEqual([at(3, 13).getTime(), at(3, 18).getTime(), people.g[1]]);
    // Copy (Alt-drag) to Friday for the same person: a new draft, the original stays.
    r = await call(tok.admin).post(`/api/schedule/planner/shifts/${tuesday}/move`, { expectedVersion: s.version, startsAt: at(5, 13), endsAt: at(5, 17), copy: true });
    expect(r.body.created).toBe(true);
    expect((await owner.shift.findUniqueOrThrow({ where: { id: r.body.id } })).userId).toBe(people.g[1]);
    // Reassign to guard 0, who already has Thursday 6–10: 9 h that day is overtime, so it asks first.
    r = await call(tok.admin).post(`/api/schedule/planner/shifts/${tuesday}/move`, { expectedVersion: s.version, userId: people.g[0] });
    expect(r.status).toBe(409);
    expect((await owner.shift.findUniqueOrThrow({ where: { id: tuesday } })).userId).toBe(people.g[1]);
    r = await call(tok.admin).post(`/api/schedule/planner/shifts/${tuesday}/move`, { expectedVersion: s.version, userId: people.g[0], acknowledgeOvertime: true });
    expect(r.status).toBe(200);
    s = await owner.shift.findUniqueOrThrow({ where: { id: tuesday } });
    expect(s.userId).toBe(people.g[0]);
    // Moving it onto guard 0's own 6–10 shift is refused; nothing changes.
    r = await call(tok.admin).post(`/api/schedule/planner/shifts/${tuesday}/move`, { expectedVersion: s.version, startsAt: at(3, 7), endsAt: at(3, 11) });
    expect(r.status).toBe(422);
    expect((await owner.shift.findUniqueOrThrow({ where: { id: tuesday } })).startsAt.getTime()).toBe(at(3, 13).getTime());
    // A stale version is refused.
    expect((await call(tok.admin).post(`/api/schedule/planner/shifts/${tuesday}/move`, { expectedVersion: 0, userId: null })).status).toBe(409);
  });

  it('assigns several people to one shift (extra spots as same-time drafts), skipping who can’t', async () => {
    const s = await owner.shift.findUniqueOrThrow({ where: { id: openShift } });
    const r = await call(tok.admin).post(`/api/schedule/planner/shifts/${openShift}/assign-many`, { expectedVersion: s.version, userIds: [people.g[0], people.g[3], people.p0] });
    expect(r.status).toBe(200);
    const res = r.body.results as Array<{ userId: string; shiftId: string | null; code: string | null }>;
    expect(res.find((x) => x.userId === people.g[0])).toMatchObject({ shiftId: openShift, code: null });
    const extra = res.find((x) => x.userId === people.g[3])!;
    expect(extra.shiftId).not.toBe(openShift);
    expect(await owner.shift.findUniqueOrThrow({ where: { id: extra.shiftId! } })).toMatchObject({ userId: people.g[3], status: 'DRAFT', startsAt: s.startsAt });
    expect(res.find((x) => x.userId === people.p0)).toMatchObject({ shiftId: null, code: 'OVERLAPPING_SHIFT' });
  });

  it('copies a week with people as drafts, re-checking each, and doesn’t copy twice', async () => {
    const r = await call(tok.admin).post('/api/schedule/planner/copy', { departmentId: aquatics, from: WEEK, to: NEXT, days: 7, withPeople: true });
    expect(r.status).toBe(200);
    const source = await owner.shift.count({ where: { tenantId: t.tenant.id, positionId: t.position.id, status: { not: 'CANCELLED' }, startsAt: { gte: at(0, 0), lt: at(7, 0) } } });
    expect(r.body.created.length).toBe(source);
    const copies = await owner.shift.findMany({ where: { id: { in: r.body.created } } });
    expect(copies.every((c) => c.status === 'DRAFT')).toBe(true);
    expect(r.body.assigned + r.body.leftOpen.length).toBe(copies.filter((c) => c.userId).length + r.body.leftOpen.length);
    expect(await owner.auditLog.count({ where: { tenantId: t.tenant.id, action: 'schedule.copy' } })).toBe(1);
    const again = await call(tok.admin).post('/api/schedule/planner/copy', { departmentId: aquatics, from: WEEK, to: NEXT, days: 7, withPeople: true });
    expect(again.body).toMatchObject({ created: [], skippedExisting: source });
    // Parks' shift isn't part of the Aquatics copy.
    expect(copies.some((c) => c.positionId === parksPos)).toBe(false);

    // Undo: the copies are cancelled; a published one is kept.
    await owner.shift.update({ where: { id: r.body.created[0] }, data: { status: 'PUBLISHED' } });
    const u = await call(tok.admin).post('/api/schedule/planner/cancel', { shiftIds: r.body.created });
    expect(u.body).toMatchObject({ cancelled: source - 1, kept: [r.body.created[0]] });
  });

  it('keeps a department lead inside their department', async () => {
    expect((await call(tok.parksSup).post('/api/schedule/planner/shifts', { facilityId: t.facility.id, positionId: t.position.id, startsAt: at(5, 6), endsAt: at(5, 10), userIds: [] })).status).toBe(403);
    const s = await owner.shift.findUniqueOrThrow({ where: { id: openShift } });
    expect((await call(tok.parksSup).post(`/api/schedule/planner/shifts/${openShift}/move`, { expectedVersion: s.version, startsAt: at(5, 6), endsAt: at(5, 10) })).status).toBe(403);
    // Their own shift can't be moved into a position outside their department.
    const p = await owner.shift.findUniqueOrThrow({ where: { id: parksShift } });
    expect((await call(tok.parksSup).post(`/api/schedule/planner/shifts/${parksShift}/move`, { expectedVersion: p.version, positionId: t.position.id })).status).toBe(403);
    expect((await call(tok.parksSup).post('/api/schedule/planner/copy', { departmentId: aquatics, from: WEEK, to: NEXT, days: 1 })).status).toBe(404);
    expect((await call(tok.parksSup).post('/api/schedule/planner/cancel', { shiftIds: [openShift] })).status).toBe(403);
  });

  it('keeps cities apart', async () => {
    const s = await owner.shift.findUniqueOrThrow({ where: { id: openShift } });
    expect((await call(tok.admin2, SUB2).post(`/api/schedule/planner/shifts/${openShift}/move`, { expectedVersion: s.version, userId: null })).status).toBe(404);
    expect((await elig(tok.admin2, {}, SUB2)).status).toBe(404);
    expect((await call(tok.admin2, SUB2).get(`/api/schedule/planner?departmentId=${aquatics}&from=${WEEK}&to=${END}`)).status).toBe(404);
    // Another city’s person can't be put on this city’s shift.
    const r = await call(tok.admin).post('/api/schedule/planner/shifts', { facilityId: t.facility.id, positionId: t.position.id, startsAt: at(6, 6), endsAt: at(6, 10), userIds: [t2.users[0]!.id] });
    expect([403, 404]).toContain(r.status);
    expect((await call(tok.admin2, SUB2).post('/api/schedule/planner/cancel', { shiftIds: [openShift] })).status).toBe(404);
  });
});
