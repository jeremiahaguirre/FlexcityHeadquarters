/**
 * Demand forecast for each hour of a week, from three sources:
 * - bather-load history: the last eight weeks of headcounts on the same weekday and hour (school
 *   days and non-school days kept apart), turned into lifeguards with each pool's ratio;
 * - facility hours: while open, never fewer than the facility's minimum on deck, even with no
 *   history; hours it's closed need no one;
 * - lesson registrations: each class running that hour with swimmers registered needs its
 *   instructors (one per full class size), counted for the class's instructor position.
 * Compared with who is scheduled, the gaps can become draft open shifts (`draftShiftsFor`).
 * Weather and one-off events are not known to it; it says how many days each figure rests on.
 */
import type { Tx } from '../../lib/db.js';
import { addDays, dayOfWeek, localDate, localHour, localIso, startOfLocalDay } from '../../lib/time.js';
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

export interface OpenBlock { dayOfWeek: number; opensMinute: number; closesMinute: number; minGuards: number }
export interface ClassRun { positionId: string; daysOfWeek: number[]; startMinute: number; endMinute: number; startsOn: string; endsOn: string; maxSwimmers: number; swimmers: number }

/** Whether the facility is open during [hour, hour+1) on a weekday, and the minimum on deck then. Null = no hours set. */
export function openAt(blocks: OpenBlock[], dow: number, hour: number): { open: boolean; minGuards: number } | null {
  if (!blocks.length) return null;
  const from = hour * 60;
  const to = from + 60;
  const now = blocks.filter((b) => b.dayOfWeek === dow && b.opensMinute < to && b.closesMinute > from);
  return { open: now.length > 0, minGuards: Math.max(0, ...now.map((b) => b.minGuards)) };
}

/** Classes running during [hour, hour+1) on a date, with swimmers registered: classes, swimmers and instructors needed. */
export function lessonsAt(classes: ClassRun[], date: string, hour: number, positionId: string | null) {
  const dow = dayOfWeek(date);
  const from = hour * 60;
  const to = from + 60;
  const running = classes.filter((c) => c.swimmers > 0 && c.startsOn <= date && c.endsOn >= date && c.daysOfWeek.includes(dow) && c.startMinute < to && c.endMinute > from);
  const mine = positionId ? running.filter((c) => c.positionId === positionId) : running;
  return {
    classes: running.length,
    swimmers: running.reduce((s, c) => s + c.swimmers, 0),
    instructors: mine.reduce((s, c) => s + Math.max(1, Math.ceil(c.swimmers / Math.max(1, c.maxSwimmers))), 0),
  };
}

export async function forecastWeek(tx: Tx, facilityId: string, weekStart: string, positionId: string | null) {
  const facility = await tx.facility.findUniqueOrThrow({ where: { id: facilityId }, select: { timezone: true, name: true } });
  const tz = facility.timezone;
  const from = startOfLocalDay(addDays(weekStart, -7 * WEEKS), tz);
  const to = startOfLocalDay(weekStart, tz);
  const weekEnd = addDays(weekStart, 6);
  const [blocks, lessonRows] = await Promise.all([
    tx.facilityHours.findMany({ where: { facilityId }, select: { dayOfWeek: true, opensMinute: true, closesMinute: true, minGuards: true } }),
    tx.lessonClass.findMany({
      where: { facilityId, published: true, startsOn: { lte: new Date(`${weekEnd}T00:00:00Z`) }, endsOn: { gte: new Date(`${weekStart}T00:00:00Z`) } },
      select: { positionId: true, dayOfWeek: true, daysOfWeek: true, startMinute: true, endMinute: true, startsOn: true, endsOn: true, maxSwimmers: true, _count: { select: { enrollments: { where: { active: true, status: 'ENROLLED' } } } } },
    }),
  ]);
  const classes: ClassRun[] = lessonRows.map((c) => ({
    positionId: c.positionId,
    daysOfWeek: c.daysOfWeek.length ? c.daysOfWeek : [c.dayOfWeek],
    startMinute: c.startMinute,
    endMinute: c.endMinute,
    startsOn: c.startsOn.toISOString().slice(0, 10),
    endsOn: c.endsOn.toISOString().slice(0, 10),
    maxSwimmers: c.maxSwimmers,
    swimmers: c._count.enrollments,
  }));
  const lessonPositions = new Set(classes.map((c) => c.positionId));
  // An instructor position is staffed by lessons alone; any other by bathers and opening hours.
  const forLessons = !!positionId && lessonPositions.has(positionId);
  const [pools, counts, periods, shifts] = await Promise.all([
    tx.poolBody.findMany({ where: { facilityId, archivedAt: null }, select: { id: true, name: true, bathersPerLifeguard: true } }),
    tx.headCount.findMany({ where: { poolBody: { facilityId }, recordedAt: { gte: from, lt: to } }, select: { poolBodyId: true, count: true, recordedAt: true } }),
    tx.schoolCalendarPeriod.findMany(),
    tx.shift.findMany({
      where: { facilityId, status: { not: 'CANCELLED' }, startsAt: { lt: startOfLocalDay(addDays(weekStart, 7), tz) }, endsAt: { gt: to }, ...(positionId ? { positionId } : {}) },
      select: { startsAt: true, endsAt: true, userId: true },
    }),
  ]);
  const cal = buildSchoolCalendar(periods.map((p) => ({ kind: p.kind, startsOn: p.startsOn.toISOString().slice(0, 10), endsOn: p.endsOn.toISOString().slice(0, 10) })));
  const samples: Sample[] = counts.map((c) => ({ poolId: c.poolBodyId, day: localDate(c.recordedAt, tz), hour: Number(localIso(c.recordedAt, tz).slice(11, 13)), count: c.count }));
  const expect = expectedByHour(samples, (d) => cal.isSchoolDay(d));
  // Every hour anything happens: history, opening hours or a class.
  const hourSet = new Set(samples.map((s) => s.hour));
  for (const b of blocks) for (let h = Math.floor(b.opensMinute / 60); h * 60 < b.closesMinute; h++) hourSet.add(h);
  for (const c of classes) if (c.swimmers) for (let h = Math.floor(c.startMinute / 60); h * 60 < c.endMinute; h++) hourSet.add(h);
  const hoursSeen = [...hourSet].filter((h) => h >= 0 && h < 24).sort((a, b) => a - b);

  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)).map((day) => ({
    date: day,
    schoolDay: cal.isSchoolDay(day),
    hours: hoursSeen.map((hour) => {
      const slotStart = localHour(day, hour, tz);
      const slotEnd = new Date(slotStart.getTime() + 3_600_000);
      let expected = 0;
      let fromBathers = 0;
      let basedOn = 0;
      for (const p of pools) {
        const e = expect(p.id, day, hour);
        if (!e) continue;
        expected += e.expected;
        basedOn = Math.max(basedOn, e.basedOnDays);
        fromBathers += e.expected > 0 ? lifeguardsRequired(e.expected, p.bathersPerLifeguard) ?? 0 : 0;
      }
      const hours = openAt(blocks, dayOfWeek(day), hour);
      const lessons = lessonsAt(classes, day, hour, positionId);
      const open = hours ? hours.open : null;
      let needed: number;
      const reasons: Array<'bathers' | 'minimum' | 'lessons' | 'closed'> = [];
      if (forLessons) {
        needed = lessons.instructors;
        if (needed) reasons.push('lessons');
      } else if (open === false) {
        needed = 0;
        reasons.push('closed');
      } else {
        const minimum = hours?.minGuards ?? 0;
        needed = Math.max(fromBathers, minimum);
        if (fromBathers && fromBathers >= minimum) reasons.push('bathers');
        if (minimum && minimum >= fromBathers) reasons.push('minimum');
      }
      const during = shifts.filter((s) => s.startsAt < slotEnd && s.endsAt > slotStart);
      const scheduled = during.filter((s) => s.userId).length;
      // Open shifts already made for this hour (drafted or on the board), not yet filled.
      const unfilled = during.length - scheduled;
      return { hour, open, unfilled, expected, needed, scheduled, gap: Math.max(0, needed - scheduled), basedOnDays: basedOn, lessons: { classes: lessons.classes, swimmers: lessons.swimmers }, reasons };
    }),
  }));
  return {
    facility: facility.name,
    weekStart,
    weeksOfHistory: WEEKS,
    hoursSet: blocks.length > 0,
    forLessons,
    pools: pools.map((p) => ({ id: p.id, name: p.name, ratio: p.bathersPerLifeguard })),
    days,
  };
}

/** Longest draft shift; a longer gap is split into even shifts rounded to the hour (6 a.m.–9 p.m. → 6–14 and 14–21). */
export const MAX_SHIFT_HOURS = 8;

/**
 * Turns the gaps into shift blocks: on each day, layer k covers every hour still short by at
 * least k, consecutive hours joined, so two guards short from 9 to 12 gives two 9–12 shifts.
 * Blocks longer than MAX_SHIFT_HOURS are split into even back-to-back shifts.
 */
export function gapBlocks(days: Array<{ date: string; hours: Array<{ hour: number; gap: number }> }>): Array<{ date: string; startHour: number; endHour: number }> {
  return rawGapBlocks(days).flatMap((b) => {
    const len = b.endHour - b.startHour;
    const parts = Math.ceil(len / MAX_SHIFT_HOURS);
    if (parts <= 1) return [b];
    const out = [];
    let start = b.startHour;
    for (let i = 0; i < parts; i++) {
      const end = i === parts - 1 ? b.endHour : b.startHour + Math.round(((i + 1) * len) / parts);
      out.push({ date: b.date, startHour: start, endHour: end });
      start = end;
    }
    return out;
  });
}

function rawGapBlocks(days: Array<{ date: string; hours: Array<{ hour: number; gap: number }> }>): Array<{ date: string; startHour: number; endHour: number }> {
  const out: Array<{ date: string; startHour: number; endHour: number }> = [];
  for (const d of days) {
    const gap = new Map(d.hours.map((h) => [h.hour, h.gap]));
    const most = Math.max(0, ...gap.values());
    for (let k = 1; k <= most; k++) {
      let start: number | null = null;
      for (let h = 0; h <= 24; h++) {
        const short = (gap.get(h) ?? 0) >= k;
        if (short && start === null) start = h;
        if (!short && start !== null) {
          out.push({ date: d.date, startHour: start, endHour: h });
          start = null;
        }
      }
    }
  }
  return out;
}

/** Creates the gaps as draft open shifts (unpublished: a scheduler reviews, fills or posts them). */
export async function draftShiftsFor(tx: Tx, tenantId: string, facilityId: string, weekStart: string, positionId: string) {
  const f = await forecastWeek(tx, facilityId, weekStart, positionId);
  const facility = await tx.facility.findUniqueOrThrow({ where: { id: facilityId }, select: { timezone: true } });
  // Only what isn't already covered by an open shift waiting to be filled, so running it twice adds nothing.
  const blocks = gapBlocks(f.days.map((d) => ({ date: d.date, hours: d.hours.map((h) => ({ hour: h.hour, gap: Math.max(0, h.gap - h.unfilled) })) })));
  const created = [];
  for (const b of blocks) {
    created.push(
      await tx.shift.create({
        data: { tenantId, facilityId, positionId, startsAt: localHour(b.date, b.startHour, facility.timezone), endsAt: b.endHour >= 24 ? startOfLocalDay(addDays(b.date, 1), facility.timezone) : localHour(b.date, b.endHour, facility.timezone), status: 'DRAFT', conflictReason: null },
        select: { id: true, startsAt: true, endsAt: true },
      }),
    );
  }
  return created;
}
