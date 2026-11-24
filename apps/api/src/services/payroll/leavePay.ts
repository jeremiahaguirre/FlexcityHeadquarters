/**
 * Paid hours of an organization's own leave types (bereavement, jury duty…), day by day, for pay runs
 * and the provider export (payrollRun.ts).
 *
 * - Leave charged from the shifts it took off is paid on those shifts' days (chargedDays, recorded
 *   at approval). Otherwise the hours charged are spread over the request's local working days
 *   (Monday to Friday, in the person's leave time zone, as leave is counted: leaveHours.ts), or over
 *   all its days when it has no weekday. A request shorter than a day is one day: the one it starts on.
 * - Each day is paid in the pay period that holds it, unless the request was approved later: then
 *   in the period that holds the approval day. So leave across two periods is paid in each, and
 *   leave approved after its period's run is paid in the next run, never twice and never lost.
 * - Each day is paid at the person's rate on that day, chosen the same way in every run (the
 *   newest rate in effect, then the highest, then by position), and only in a run that covers
 *   that rate's position: a person in two departments is paid once, by one department's run.
 *   With no rate, the day belongs to their first position (the run reports it: LEAVE_NO_RATE).
 * - The same days count as wages in statutory holiday pay's look-back, like hours worked.
 */
import { DateTime } from 'luxon';
import type { Tx } from '../../lib/db.js';
import { Decimal, dec } from '../../lib/money.js';
import { localDate } from '../../lib/time.js';
import { leaveTimeZones } from '../people/leaveHours.js';

export interface PaidLeaveDay {
  requestId: string;
  userId: string;
  /** The day the leave was taken (YYYY-MM-DD, local). */
  day: string;
  /** The day it's paid on: the leave day, or the approval day when that's later. */
  payOn: string;
  hours: Decimal;
  rate: Decimal | null;
  positionId: string | null;
  leave: string;
  leaveFr: string;
  payCode: string | null;
  person: { employeeNumber: string | null; name: string; hireDate: Date | null };
}

/** A request's hours over its local days: weekdays when it has any, else every day it touches. */
export function splitLeaveHours(startsAt: Date, endsAt: Date, hours: number, timeZone: string): Array<{ day: string; hours: number }> {
  const first = DateTime.fromJSDate(startsAt, { zone: timeZone });
  const length = DateTime.fromJSDate(endsAt, { zone: timeZone }).diff(first, 'days').days;
  // Each day as the local day its middle falls on, as weekdayLeaveHours counts them.
  const all = length < 1 ? [first] : Array.from({ length: Math.round(length) }, (_, i) => first.plus({ days: i }).plus({ hours: 12 }));
  const weekdays = all.filter((d) => d.weekday <= 5);
  const days = (weekdays.length ? weekdays : all).map((d) => d.toISODate()!);
  // Hundredths of an hour, the remainder on the last day, so the days add up to the hours charged.
  const total = Math.round(hours * 100);
  const each = Math.floor(total / days.length);
  return days.map((day, i) => ({ day, hours: (i === days.length - 1 ? total - each * (days.length - 1) : each) / 100 }));
}

/** The recorded days of leave charged from shifts, or null when there are none (or they don't add up). */
function recordedDays(v: unknown, hours: number): Array<{ day: string; hours: number }> | null {
  if (!Array.isArray(v) || !v.length) return null;
  const days = v.filter((x): x is { day: string; hours: number } => !!x && typeof x.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x.day) && typeof x.hours === 'number');
  if (days.length !== v.length || Math.abs(days.reduce((a, x) => a + x.hours, 0) - hours) > 0.005) return null;
  return days;
}

/** Approved paid leave of the organization's own types with a day in [from, to) or approved in it. */
export async function paidLeaveDays(tx: Tx, opts: { from: string; to: string; onlyUsers: Set<string> | null; positionIds: string[] | null }): Promise<PaidLeaveDay[]> {
  const lo = new Date(Date.parse(`${opts.from}T00:00:00Z`) - 86_400_000);
  const hi = new Date(Date.parse(`${opts.to}T00:00:00Z`) + 86_400_000);
  const reqs = await tx.timeOffRequest.findMany({
    where: {
      status: 'APPROVED',
      chargedHours: { gt: 0 },
      leaveType: { system: null, paid: true },
      OR: [{ startsAt: { lt: hi }, endsAt: { gt: lo } }, { decidedAt: { gte: lo, lt: hi } }],
      ...(opts.onlyUsers ? { userId: { in: [...opts.onlyUsers] } } : {}),
    },
    include: { leaveType: { select: { name: true, nameFr: true, payCode: true } }, user: { select: { employeeNumber: true, firstName: true, lastName: true, hireDate: true, payRates: true, positions: { select: { positionId: true } } } } },
    orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
  });
  const asked = reqs.map((r) => ({ userId: r.userId, startsAt: r.startsAt, asOf: r.decidedAt }));
  const zoneOf = await leaveTimeZones(tx, asked);
  const out: PaidLeaveDay[] = [];
  for (const [i, r] of reqs.entries()) {
    const tz = zoneOf(asked[i]!);
    const decided = r.decidedAt ? localDate(r.decidedAt, tz) : '0000-00-00';
    const firstPosition = r.user.positions.map((p) => p.positionId).sort()[0] ?? null;
    const days = recordedDays(r.chargedDays, Number(r.chargedHours)) ?? splitLeaveHours(r.startsAt, r.endsAt, Number(r.chargedHours), tz);
    for (const { day, hours } of days) {
      // Chosen without regard to the run, so every run agrees on which one pays the day.
      const rate = r.user.payRates
        .filter((pr) => pr.effectiveFrom.toISOString().slice(0, 10) <= day && (!pr.effectiveTo || pr.effectiveTo.toISOString().slice(0, 10) >= day))
        .sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime() || Number(b.hourlyRate) - Number(a.hourlyRate) || a.positionId.localeCompare(b.positionId))[0];
      const owner = rate?.positionId ?? firstPosition;
      if (opts.positionIds && !(owner && opts.positionIds.includes(owner))) continue;
      out.push({
        requestId: r.id,
        userId: r.userId,
        day,
        payOn: decided > day ? decided : day,
        hours: new Decimal(hours),
        rate: rate ? dec(rate.hourlyRate) : null,
        positionId: rate?.positionId ?? null,
        leave: r.leaveType!.name,
        leaveFr: r.leaveType!.nameFr,
        payCode: r.leaveType!.payCode,
        person: { employeeNumber: r.user.employeeNumber, name: `${r.user.firstName} ${r.user.lastName}`, hireDate: r.user.hireDate },
      });
    }
  }
  return out;
}
