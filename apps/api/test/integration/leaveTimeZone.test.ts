import { DateTime } from 'luxon';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { signAccessToken } from '../../src/auth/tokens.js';
import { withTenant } from '../../src/lib/db.js';
import { leaveTimeZones, weekdayRecount } from '../../src/services/people/leaveHours.js';
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
    const zones = await withTenant(t.tenant.id, (tx) => leaveTimeZones(tx, [bc, nobody], new Date()));
    expect(zones.get(bc)).toBe(VAN);
    expect(zones.get(nobody)).toBe('America/Toronto');
    // Hours long before the window don't count.
    const old = await withTenant(t.tenant.id, (tx) => leaveTimeZones(tx, [bc], new Date(Date.now() - 200 * DAY)));
    expect(old.get(bc)).toBe('America/Toronto');
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
