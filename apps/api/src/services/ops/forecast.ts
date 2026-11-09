/**
 * Demand forecast: expected bathers per pool for each hour of a week, from the
 * last eight weeks of headcounts on the same weekday and hour (school days and
 * non-school days kept apart), turned into lifeguards needed with each pool's
 * ratio, and compared with who is scheduled. Weather and one-off events are
 * not known to it; it says how many days each figure rests on.
 */
import type { Tx } from '../../lib/db.js';
import { addDays, dayOfWeek, localDate, localIso, startOfLocalDay } from '../../lib/time.js';
import { buildSchoolCalendar } from '../compliance/schoolCalendar.js';
import { lifeguardsRequired } from './chemistry.js';

const WEEKS = 8;

export interface Sample { day: string; hour: number; poolId: string; count: number }

/** Average of the busiest count per day for each (pool, weekday, school-day, hour). */
export function expectedByHour(samples: Sample[], isSchoolDay: (d: string) => boolean) {
  const peak = new Map<string, number>(); // pool|day|hour → max count that hour
  for (const s of samples) {
    const k = `${s.poolId}|${s.day}|${s.hour}`;
    peak.set(k, Math.max(peak.get(k) ?? 0, s.count));
  }
  const groups = new Map<string, number[]>(); // pool|weekday|school|hour → peaks
  for (const [k, v] of peak) {
    const [poolId, day, hour] = k.split('|');
    const g = `${poolId}|${dayOfWeek(day!)}|${isSchoolDay(day!) ? 1 : 0}|${hour}`;
    groups.set(g, [...(groups.get(g) ?? []), v]);
  }
  return (poolId: string, day: string, hour: number) => {
    const xs = groups.get(`${poolId}|${dayOfWeek(day)}|${isSchoolDay(day) ? 1 : 0}|${hour}`) ?? [];
    return xs.length ? { expected: Math.round(xs.reduce((a, b) => a + b, 0) / xs.length), basedOnDays: xs.length } : null;
  };
}

export async function forecastWeek(tx: Tx, facilityId: string, weekStart: string, positionId: string | null) {
  const facility = await tx.facility.findUniqueOrThrow({ where: { id: facilityId }, select: { timezone: true, name: true } });
  const tz = facility.timezone;
  const from = startOfLocalDay(addDays(weekStart, -7 * WEEKS), tz);
  const to = startOfLocalDay(weekStart, tz);
  const [pools, counts, periods, shifts] = await Promise.all([
    tx.poolBody.findMany({ where: { facilityId, archivedAt: null }, select: { id: true, name: true, bathersPerLifeguard: true } }),
    tx.headCount.findMany({ where: { poolBody: { facilityId }, recordedAt: { gte: from, lt: to } }, select: { poolBodyId: true, count: true, recordedAt: true } }),
    tx.schoolCalendarPeriod.findMany(),
    tx.shift.findMany({
      where: { facilityId, status: { not: 'CANCELLED' }, userId: { not: null }, startsAt: { lt: startOfLocalDay(addDays(weekStart, 7), tz) }, endsAt: { gt: to }, ...(positionId ? { positionId } : {}) },
      select: { startsAt: true, endsAt: true },
    }),
  ]);
  const cal = buildSchoolCalendar(periods.map((p) => ({ kind: p.kind, startsOn: p.startsOn.toISOString().slice(0, 10), endsOn: p.endsOn.toISOString().slice(0, 10) })));
  const samples: Sample[] = counts.map((c) => ({ poolId: c.poolBodyId, day: localDate(c.recordedAt, tz), hour: Number(localIso(c.recordedAt, tz).slice(11, 13)), count: c.count }));
  const expect = expectedByHour(samples, (d) => cal.isSchoolDay(d));
  const hoursSeen = [...new Set(samples.map((s) => s.hour))].sort((a, b) => a - b);

  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)).map((day) => ({
    date: day,
    schoolDay: cal.isSchoolDay(day),
    hours: hoursSeen.map((hour) => {
      const slotStart = new Date(startOfLocalDay(day, tz).getTime() + hour * 3_600_000);
      const slotEnd = new Date(slotStart.getTime() + 3_600_000);
      let expected = 0;
      let needed = 0;
      let basedOn = 0;
      for (const p of pools) {
        const e = expect(p.id, day, hour);
        if (!e) continue;
        expected += e.expected;
        basedOn = Math.max(basedOn, e.basedOnDays);
        needed += e.expected > 0 ? lifeguardsRequired(e.expected, p.bathersPerLifeguard) ?? 0 : 0;
      }
      const scheduled = shifts.filter((s) => s.startsAt < slotEnd && s.endsAt > slotStart).length;
      return { hour, expected, needed, scheduled, gap: Math.max(0, needed - scheduled), basedOnDays: basedOn };
    }),
  }));
  return { facility: facility.name, weekStart, weeksOfHistory: WEEKS, pools: pools.map((p) => ({ id: p.id, name: p.name, ratio: p.bathersPerLifeguard })), days };
}
