import { DateTime } from 'luxon';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { signAccessToken } from '../../src/auth/tokens.js';
import { withTenant } from '../../src/lib/db.js';
import { leaveTimeZones, personLeaveTimeZone, weekdayRecount } from '../../src/services/people/leaveHours.js';
import { lieuAvailable } from '../../src/services/payroll/lieu.js';
import { decideTimeOff, requestTimeOff } from '../../src/services/people/timeOff.js';
import { app as appDb, owner, seedTenant } from './fixtures.js';

// An organization whose first facility is in Ontario, with a BC facility (seedTenant's, America/Vancouver)
// where one person works: their leave is counted in Vancouver time, as payroll counts their days.
const server = createApp();
const SUB = 'leavetz';
const VAN = 'America/Vancouver';
let t: Awaited<ReturnType<typeof seedTenant>>;
let bc = '';
let nobody = '';
let hrId = '';
let tok = '';
const DAY = 86_400_000;
const ago = (days: number, hour: number) => new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate() - days, hour));
// Monday 09:00 → Saturday 09:00 in Vancouver, in July: 12:00 in Toronto, so counted in Toronto time each day would be the next.
const monday = DateTime.fromISO('2027-07-12T09:00', { zone: VAN });
const week = { startsAt: monday.toJSDate(), endsAt: monday.plus({ days: 5 }).toJSDate() };

beforeAll(async () => {
  t = await seedTenant(SUB, 2);
  bc = t.users[0]!.id;
  nobody = t.users[1]!.id;
  const ontario = await owner.facility.create({ data: { tenantId: t.tenant.id, name: 'City Hall', province: 'ON', timezone: 'America/Toronto', createdAt: new Date('2020-01-01T00:00:00Z') } });
  hrId = (await owner.user.create({ data: { tenantId: t.tenant.id, roles: ['HR_ADMIN'], employmentStatus: 'FULL_TIME', firstName: 'Hana', lastName: 'Tz', email: `hr@${SUB}.test` } })).id;
  // Most of their hours are in BC (three 8-hour days); a 2-hour meeting in Ontario.
  const punch = (facilityId: string, clockIn: Date, hours: number) =>
    owner.timePunch.create({ data: { tenantId: t.tenant.id, userId: bc, facilityId, positionId: t.position.id, clockIn, clockOut: new Date(clockIn.getTime() + hours * 3_600_000), status: 'APPROVED' } });
  for (const d of [50, 49, 48]) await punch(t.facility.id, ago(d, 16), 8);
  await punch(ontario.id, ago(47, 15), 2);
  tok = await signAccessToken({ sub: bc, tid: t.tenant.id, roles: ['STAFF'], aat: Math.floor(Date.now() / 1000) });
});
afterAll(async () => {
  await appDb.$disconnect();
  await owner.$disconnect();
});

describe('leave is counted in the person’s time zone', () => {
  it('their main facility’s (most hours), else the organization’s first facility’s', async () => {
    const asked = { bc: { userId: bc, startsAt: new Date() }, nobody: { userId: nobody, startsAt: new Date() } };
    const zones = await withTenant(t.tenant.id, (tx) => leaveTimeZones(tx, [asked.bc, asked.nobody]));
    expect(zones(asked.bc)).toBe(VAN);
    expect(zones(asked.nobody)).toBe('America/Toronto');
    // Hours long before the window don't count.
    const long = { userId: bc, startsAt: new Date(Date.now() - 200 * DAY) };
    const old = await withTenant(t.tenant.id, (tx) => leaveTimeZones(tx, [long]));
    expect(old(long)).toBe('America/Toronto');
  });

  it('a Vancouver person in a Toronto-zone organization: Monday 09:00 → Saturday 09:00 is 40 hours, pending and charged', async () => {
    const out = await withTenant(t.tenant.id, (tx) => requestTimeOff(tx, t.tenant.id, bc, { type: 'VACATION', ...week }));
    const year = week.startsAt.getUTCFullYear();
    const mine = (await request(server).get(`/api/me/leave?year=${year}`).set('x-tenant-subdomain', SUB).auth(tok, { type: 'bearer' })).body;
    expect(mine.types.find((x: { type: string }) => x.type === 'VACATION')).toMatchObject({ pending: 40 });
    await withTenant(t.tenant.id, (tx) => decideTimeOff(tx, { userId: hrId, tenantId: t.tenant.id }, out.request.id, 'APPROVE'));
    const row = await owner.timeOffRequest.findUniqueOrThrow({ where: { id: out.request.id } });
    expect({ hours: Number(row.chargedHours), basis: row.chargedBasis }).toEqual({ hours: 40, basis: 'WEEKDAYS' });
  });
});

describe('recount report for hours charged before the fix', () => {
  it('lists approved weekday-counted requests whose recount differs, and changes nothing', async () => {
    const friday = DateTime.now().setZone(VAN).plus({ weeks: 1 }).startOf('week').plus({ days: 4 }).set({ hour: 8 });
    const wednesday = friday.minus({ days: 2 });
    const base = { tenantId: t.tenant.id, userId: bc, type: 'OTHER' as const, status: 'APPROVED' as const, chargedBasis: 'WEEKDAYS', decidedById: hrId, decidedAt: new Date() };
    // Charged 0 under the UTC bug (counted as Saturday); a Wednesday charged right; one counted from shifts.
    const wrong = await owner.timeOffRequest.create({ data: { ...base, startsAt: friday.toJSDate(), endsAt: friday.plus({ days: 1 }).toJSDate(), chargedHours: 0 } });
    await owner.timeOffRequest.create({ data: { ...base, startsAt: wednesday.toJSDate(), endsAt: wednesday.plus({ days: 1 }).toJSDate(), chargedHours: 8 } });
    await owner.timeOffRequest.create({ data: { ...base, chargedBasis: 'SHIFTS', startsAt: friday.plus({ weeks: 1 }).toJSDate(), endsAt: friday.plus({ weeks: 1, days: 1 }).toJSDate(), chargedHours: 0 } });
    const before = await owner.timeOffRequest.findMany({ where: { tenantId: t.tenant.id }, orderBy: { id: 'asc' } });
    const rows = await withTenant(t.tenant.id, (tx) => weekdayRecount(tx), { readOnly: true });
    expect(rows).toEqual([expect.objectContaining({ id: wrong.id, userId: bc, charged: 0, recount: 8, timeZone: VAN })]);
    expect(await owner.timeOffRequest.findMany({ where: { tenantId: t.tenant.id }, orderBy: { id: 'asc' } })).toEqual(before);
  });
});

describe('every caller reads a request’s zone as of the same moment: when it starts, or now for one ahead', () => {
  const TOR = 'America/Toronto';
  let ontarioId = '';
  const person = async (name: string) => (await owner.user.create({ data: { tenantId: t.tenant.id, roles: ['STAFF'], employmentStatus: 'PART_TIME', firstName: name, lastName: 'Tz', email: `${name}@${SUB}.test` } })).id;
  const punchFor = (userId: string, facilityId: string, clockIn: Date, hours: number) =>
    owner.timePunch.create({ data: { tenantId: t.tenant.id, userId, facilityId, positionId: t.position.id, clockIn, clockOut: new Date(clockIn.getTime() + hours * 3_600_000), status: 'APPROVED' } });
  beforeAll(async () => {
    ontarioId = (await owner.facility.findFirstOrThrow({ where: { tenantId: t.tenant.id, timezone: TOR } })).id;
  });

  it('a punch that starts before the 90-day window and runs into it counts; one that ends before it doesn’t', async () => {
    const at = ago(10, 0);
    const edge = await person('edge');
    const stale = await person('stale');
    const windowStart = at.getTime() - 90 * DAY;
    await punchFor(edge, t.facility.id, new Date(windowStart - 2 * 3_600_000), 6);
    await punchFor(stale, t.facility.id, new Date(windowStart - 7 * 3_600_000), 6);
    await withTenant(t.tenant.id, async (tx) => {
      expect(await personLeaveTimeZone(tx, edge, at)).toBe(VAN);
      expect(await personLeaveTimeZone(tx, stale, at)).toBe(TOR);
    });
  });

  it('someone who moved from Ontario to BC: sick leave entered after it started is counted in Toronto time everywhere', async () => {
    // A Friday 71–77 days ago, 10:00 in Vancouver (12:00 or 13:00 in Toronto): Friday there, Saturday in Toronto time.
    const friday = DateTime.now().setZone(VAN).minus({ days: 75 }).startOf('week').plus({ days: 4 }).set({ hour: 10 });
    const mover = await person('mover');
    // Ontario before it (25–40 days before, so outside the last 90 days); BC since (the last three weeks).
    for (const d of [25, 30, 35, 40]) await punchFor(mover, ontarioId, friday.minus({ days: d }).toJSDate(), 8);
    for (const d of [20, 15, 10, 5]) await punchFor(mover, t.facility.id, ago(d, 16), 8);
    const pending = await owner.timeOffRequest.create({ data: { tenantId: t.tenant.id, userId: mover, type: 'SICK', startsAt: friday.toJSDate(), endsAt: friday.plus({ days: 1 }).toJSDate() } });
    // The same, a week earlier, as time in lieu still pending against their bank (which is empty).
    const lieuFriday = friday.minus({ weeks: 1 });
    await owner.timeOffRequest.create({ data: { tenantId: t.tenant.id, userId: mover, type: 'LIEU', startsAt: lieuFriday.toJSDate(), endsAt: lieuFriday.plus({ days: 1 }).toJSDate() } });
    const moverTok = await signAccessToken({ sub: mover, tid: t.tenant.id, roles: ['STAFF'], aat: Math.floor(Date.now() / 1000) });

    // Their balance shows it pending in Toronto time (Saturday: 0 hours)…
    const mine = (await request(server).get(`/api/me/leave?year=${friday.toUTC().year}`).set('x-tenant-subdomain', SUB).auth(moverTok, { type: 'bearer' })).body;
    expect(mine.types.find((x: { type: string }) => x.type === 'SICK')).toMatchObject({ pending: 0 });
    // …the lieu bank counts the pending lieu request the same way…
    expect(await withTenant(t.tenant.id, (tx) => lieuAvailable(tx, mover))).toBe(0);
    // …and approval charges the same.
    await withTenant(t.tenant.id, (tx) => decideTimeOff(tx, { userId: hrId, tenantId: t.tenant.id }, pending.id, 'APPROVE'));
    const row = await owner.timeOffRequest.findUniqueOrThrow({ where: { id: pending.id } });
    expect({ hours: Number(row.chargedHours), basis: row.chargedBasis }).toEqual({ hours: 0, basis: 'WEEKDAYS' });
  });
});
