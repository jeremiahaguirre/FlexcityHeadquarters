/**
 * Regression tests for the independent scheduler review: each P1 scenario end to end, plus the
 * publish warnings, scoped candidates, forecast preview and planner reasons.
 */
import request from 'supertest';
import { DateTime } from 'luxon';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { signAccessToken } from '../../src/auth/tokens.js';
import { withTenant } from '../../src/lib/db.js';
import { answer, createCallOut } from '../../src/services/winter/callOuts.js';
import { app as appDb, owner, seedTenant } from './fixtures.js';

const server = createApp();
const SUB = 'schedrev';
const VAN = 'America/Vancouver';
const TOR = 'America/Toronto';
const now = () => Math.floor(Date.now() / 1000);
const call = (token: string) => ({
  get: (p: string) => request(server).get(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }),
  post: (p: string, b: object = {}) => request(server).post(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }).send(b),
  put: (p: string, b: object = {}) => request(server).put(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }).send(b),
});
// A Monday well in the future, so nothing has started.
const monday = DateTime.now().setZone(VAN).plus({ days: 2 }).startOf('week').plus({ weeks: 3 });
const at = (day: number, hour: number, zone = VAN) => DateTime.fromISO(monday.toISODate()!, { zone }).plus({ days: day }).set({ hour }).toJSDate();

let t: Awaited<ReturnType<typeof seedTenant>>;
let onFacility = '';
let tok = { admin: '', lead: '' };
const allWeek = (userId: string) => owner.availability.createMany({ data: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ tenantId: t.tenant.id, userId, dayOfWeek: d, startMinute: 0, endMinute: 1440, effectiveFrom: new Date('2020-01-01') })) });
const draft = async (start: Date, end: Date, facilityId = t.facility.id, userId: string | null = null) =>
  owner.shift.create({ data: { tenantId: t.tenant.id, facilityId, positionId: t.position.id, startsAt: start, endsAt: end, status: 'DRAFT', userId } });
const assign = (id: string, userId: string | null, version: number, ack = false) => call(tok.admin).post(`/api/shifts/${id}/assign`, { userId, expectedVersion: version, acknowledgeOvertime: ack });
const setSolver = (solver: object) => owner.tenant.update({ where: { id: t.tenant.id }, data: { overtimePolicy: { solver } } });

beforeAll(async () => {
  t = await seedTenant(SUB, 4);
  for (const u of t.users) await allWeek(u.id);
  onFacility = (await owner.facility.create({ data: { tenantId: t.tenant.id, name: 'Toronto Pool', province: 'ON', timezone: TOR, latitude: 43.6, longitude: -79.4, costCenter: 'CC-2' } })).id;
  const admin = await owner.user.create({ data: { tenantId: t.tenant.id, roles: ['HR_ADMIN', 'AQUATIC_SUPERVISOR'], employmentStatus: 'FULL_TIME', firstName: 'Ada', lastName: 'Admin', email: `admin@${SUB}.test` } });
  tok.admin = await signAccessToken({ sub: admin.id, tid: t.tenant.id, roles: ['HR_ADMIN', 'AQUATIC_SUPERVISOR'], aat: now() });
  // A lead whose scope is the Toronto facility only.
  const role = await owner.customRole.create({ data: { tenantId: t.tenant.id, name: 'Toronto lead', permissions: ['schedule.read', 'schedule.write', 'users.read'], scopeFacilityIds: [onFacility] } });
  const lead = await owner.user.create({ data: { tenantId: t.tenant.id, roles: ['EMPLOYEE'], employmentStatus: 'FULL_TIME', firstName: 'Lee', lastName: 'Lead', email: `lead@${SUB}.test` } });
  await owner.userCustomRole.create({ data: { tenantId: t.tenant.id, userId: lead.id, customRoleId: role.id } });
  tok.lead = await signAccessToken({ sub: lead.id, tid: t.tenant.id, roles: ['EMPLOYEE'], aat: now() });
});
afterAll(async () => {
  await appDb.$disconnect();
  await owner.$disconnect();
});

describe('P1 — rules every path enforces', () => {
  it('1. Ontario: an ordinary 09:00–17:00 shift can be assigned (daily rest over 24 h, not the calendar day)', async () => {
    const s = await draft(at(0, 9, TOR), at(0, 17, TOR), onFacility);
    const r = await assign(s.id, t.users[0]!.id, s.version);
    expect(r.status).toBe(200);
  });

  it("2. the organization's max hours a day applies to manual assignment too", async () => {
    await setSolver({ limits: { maxDailyHours: 8, maxConsecutiveDays: 6 } });
    const s = await draft(at(1, 8), at(1, 18));
    const r = await assign(s.id, t.users[1]!.id, s.version, true);
    expect(r.status).toBe(422);
    expect(r.body.details.blocks.map((b: { code: string }) => b.code)).toContain('DAILY_HOURS');
    await setSolver({});
  });

  it('3. a 16-hour overnight shift is refused when the limit is 12 h a day', async () => {
    const s = await draft(at(2, 16), at(3, 8));
    const r = await assign(s.id, t.users[1]!.id, s.version, true);
    expect(r.status).toBe(422);
    expect(r.body.details.blocks.map((b: { code: string }) => b.code)).toContain('DAILY_HOURS');
  });

  it('2b. BC weekly rest: no shift that leaves under 32 h off in a row that week', async () => {
    const u = t.users[2]!.id;
    // Sunday to Thursday 15–23 assigned; Friday 15–23 would leave Fri 23:00 → Sun 00:00 (25 h).
    const sun = DateTime.fromJSDate(at(-1, 15)).setZone(VAN);
    for (let d = 0; d < 5; d++) await draft(sun.plus({ days: d }).toJSDate(), sun.plus({ days: d, hours: 8 }).toJSDate(), t.facility.id, u);
    const fri = await draft(sun.plus({ days: 5 }).toJSDate(), sun.plus({ days: 5, hours: 8 }).toJSDate());
    const r = await assign(fri.id, u, fri.version, true);
    expect(r.status).toBe(422);
    expect(r.body.details.blocks.map((b: { code: string }) => b.code)).toContain('WEEKLY_REST');
  });

  it('4. two Fill accepts for the same person at the same time book them once', async () => {
    const u = t.users[3]!.id;
    const a = await draft(at(4, 9), at(4, 13));
    const b = await draft(at(4, 10), at(4, 14));
    const [ra, rb] = await Promise.all([
      call(tok.admin).post('/api/schedule/fill/accept', { items: [{ shiftId: a.id, userId: u, expectedVersion: a.version, previousUserId: null }] }),
      call(tok.admin).post('/api/schedule/fill/accept', { items: [{ shiftId: b.id, userId: u, expectedVersion: b.version, previousUserId: null }] }),
    ]);
    expect(ra.status).toBe(200);
    expect(rb.status).toBe(200);
    expect(ra.body.applied + rb.body.applied).toBe(1);
    expect([...ra.body.skipped, ...rb.body.skipped].map((x: { code: string }) => x.code)).toContain('OVERLAPPING_SHIFT');
  });

  it('5. Fill accept charges overtime to the ledger, and undo and unassign take it off', async () => {
    const u = t.users[0]!.id;
    // 5 × 8 h already this week (Tue–Sat at the BC facility) → a sixth shift is weekly overtime.
    const base = DateTime.fromJSDate(at(7, 8)).setZone(VAN);
    for (let d = 1; d <= 5; d++) await draft(base.plus({ days: d }).toJSDate(), base.plus({ days: d, hours: 8 }).toJSDate(), t.facility.id, u);
    const s = await draft(base.toJSDate(), base.plus({ hours: 4 }).toJSDate());
    const r = await call(tok.admin).post('/api/schedule/fill/accept', { items: [{ shiftId: s.id, userId: u, expectedVersion: s.version, previousUserId: null }], allowOvertime: true });
    expect(r.body.applied).toBe(1);
    const sum = async () => (await owner.overtimeEntry.findMany({ where: { userId: u, shiftId: s.id } })).reduce((x, e) => x + Number(e.hours), 0);
    expect(await sum()).toBeGreaterThan(0);
    const undo = await call(tok.admin).post('/api/schedule/fill/undo', { undoIds: r.body.undoIds });
    expect(undo.body.restored).toBe(1);
    expect(await sum()).toBe(0);
    // Assign again by hand with overtime, then unassign: the charge comes off too.
    const fresh = await owner.shift.findUniqueOrThrow({ where: { id: s.id } });
    expect((await assign(s.id, u, fresh.version, true)).status).toBe(200);
    expect(await sum()).toBeGreaterThan(0);
    expect((await assign(s.id, null, fresh.version + 1)).status).toBe(200);
    expect(await sum()).toBe(0);
  });

  it('6. call-outs: an acceptance is re-checked, and two at once fill it once', async () => {
    const start = at(10, 6);
    const end = at(10, 14);
    const actor = { tenantId: t.tenant.id, userId: t.users[0]!.id };
    const c = await withTenant(t.tenant.id, (tx) => createCallOut(tx, actor, { facilityId: t.facility.id, positionId: t.position.id, reason: 'Storm', startsAt: start, endsAt: end }));
    const contacts = await owner.callOutContact.findMany({ where: { callOutId: c.id, status: { in: ['WAITING', 'OFFERED'] } }, orderBy: { rank: 'asc' } });
    expect(contacts.length).toBeGreaterThanOrEqual(2);
    // The first person picked up an overlapping shift after the list was made: skipped at accept.
    await draft(at(10, 5), at(10, 9), t.facility.id, contacts[0]!.userId);
    const r0 = await withTenant(t.tenant.id, (tx) => answer(tx, contacts[0]!, 'ACCEPTED', actor.userId));
    expect(r0).toMatchObject({ accepted: false, reason: 'OVERLAPPING_SHIFT' });
    const rest = await owner.callOutContact.findMany({ where: { callOutId: c.id, status: { in: ['WAITING', 'OFFERED'] } }, orderBy: { rank: 'asc' } });
    const results = await Promise.allSettled(rest.slice(0, 2).map((x) => withTenant(t.tenant.id, (tx) => answer(tx, x, 'ACCEPTED', actor.userId))));
    expect(results.filter((x) => x.status === 'fulfilled' && x.value.accepted)).toHaveLength(1);
    const accepted = await owner.overtimeEntry.count({ where: { shiftId: c.shiftId, kind: 'ACCEPTED' } });
    expect(accepted).toBe(1);
  });
});

describe('P2/P3 — publish warnings, scope, forecast preview, planner reasons', () => {
  it('warns before publishing a schedule that leaves required coverage short, and publishes on confirm (audited)', async () => {
    await owner.coverageRule.create({ data: { tenantId: t.tenant.id, facilityId: t.facility.id, name: 'NLS on deck', certificationId: t.nls.id, minCount: 1, daysOfWeek: [0, 1, 2, 3, 4, 5, 6], startMinute: 600, endMinute: 720 } });
    const s = await draft(at(14, 9), at(14, 10));
    const from = at(14, 0).toISOString();
    const to = at(15, 0).toISOString();
    const check = await call(tok.admin).post('/api/shifts/publish/check', { facilityId: t.facility.id, from, to, shiftIds: [s.id] });
    expect(check.body.gaps.length).toBeGreaterThan(0);
    const refused = await call(tok.admin).post('/api/shifts/publish', { facilityId: t.facility.id, from, to, shiftIds: [s.id] });
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('PUBLISH_WARNINGS');
    const ok = await call(tok.admin).post('/api/shifts/publish', { facilityId: t.facility.id, from, to, shiftIds: [s.id], acknowledgeWarnings: true });
    expect(ok.body.published).toBe(1);
    expect(await owner.auditLog.count({ where: { tenantId: t.tenant.id, action: 'shift.publish.warnings_acknowledged' } })).toBe(1);
  });

  it("lists candidates only from the caller's people scope", async () => {
    const s = await draft(at(15, 9, TOR), at(15, 13, TOR), onFacility);
    const all = await call(tok.admin).get(`/api/shifts/${s.id}/candidates`);
    const scoped = await call(tok.lead).get(`/api/shifts/${s.id}/candidates`);
    expect(scoped.status).toBe(200);
    // Only people who have worked at the lead's facility (users[0], from test 1) are listed.
    expect(scoped.body.candidates.length).toBeLessThan(all.body.candidates.length);
    expect(scoped.body.candidates.map((c: { user: { id: string } }) => c.user.id)).toEqual([t.users[0]!.id]);
  });

  it('Fill accepts a forecast shift by creating it only then, and undo cancels it', async () => {
    const before = await owner.shift.count({ where: { tenantId: t.tenant.id } });
    const newShift = { facilityId: t.facility.id, positionId: t.position.id, startsAt: at(16, 9).toISOString(), endsAt: at(16, 13).toISOString() };
    const r = await call(tok.admin).post('/api/schedule/fill/accept', { items: [{ newShift, key: 'new:a', userId: t.users[1]!.id }] });
    expect(r.body.applied).toBe(1);
    expect(r.body.created).toHaveLength(1);
    expect(await owner.shift.count({ where: { tenantId: t.tenant.id } })).toBe(before + 1);
    await call(tok.admin).post('/api/schedule/fill/undo', { undoIds: r.body.undoIds });
    expect((await owner.shift.findUniqueOrThrow({ where: { id: r.body.created[0].shiftId } })).status).toBe('CANCELLED');
  });

  it("the planner's batch check returns the new reasons (max hours a day)", async () => {
    await setSolver({ limits: { maxDailyHours: 8 } });
    const s = await draft(at(17, 8), at(17, 18));
    const from = monday.plus({ days: 17 }).toISODate()!;
    const r = await call(tok.admin).post('/api/schedule/planner/eligibility', { departmentId: 'all', from, to: monday.plus({ days: 18 }).toISODate(), shiftIds: [s.id] });
    expect(r.status).toBe(200);
    const codes = (r.body.shifts[s.id].block as Array<[number, number]>).flatMap(([, ref]) => r.body.reasons[ref].map((x: { code: string }) => x.code));
    expect(codes).toContain('DAILY_HOURS');
    await setSolver({});
  });
});
