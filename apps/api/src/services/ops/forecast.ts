/**
 * Demand forecast for each hour of a week, from three sources:
 * - bather-load history: the last eight weeks of headcounts on the same weekday and hour (school
 *   days and non-school days kept apart), turned into lifeguards with each pool's ratio;
 * - facility hours: while open, never fewer than the facility's minimum on deck, even with no
 *   history; hours it's closed need no one;
 * - lesson registrations: each class running that hour with swimmers registered needs its
 *   instructors (one per full class size), counted for the class's instructor position.
 * Then adjusted for each day's weather (ECCC forecast; the effect learned from this facility's own
 * history once there's enough, else a rule of thumb for indoor, outdoor or arena), statutory
 * holidays and special events (a percentage, or extra people at a time). Each adjustment is listed
 * with the day so the screen can say why ("+18% hot and sunny (31 °C)"); the figures before
 * adjustment are kept alongside (`base`). Without weather it works as before.
 * Compared with who is scheduled, the gaps can become draft open shifts (`draftShiftsFor`), from
 * the adjusted figures. It says how many days each figure rests on.
 */
import type { Tx } from '../../lib/db.js';
import { addDays, dayOfWeek, localDate, localHour, localIso, startOfLocalDay } from '../../lib/time.js';
import { buildSchoolCalendar } from '../compliance/schoolCalendar.js';
import { lifeguardsRequired } from './chemistry.js';
import { coversHour, holidayEffect, occursOn, type EventRow } from './specialEvents.js';
import { learnEffects, profileOf, weatherEffect, type Bucket, type Condition, type WeatherDay } from './weather.js';

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

const iso = (d: Date) => d.toISOString().slice(0, 10);
const asDate = (s: string) => new Date(`${s}T00:00:00Z`);

export type Adjustment =
  | { kind: 'weather'; bucket: string; condition: Condition; high: number | null; pct: number; source: 'learned' | 'default'; days?: number }
  | { kind: 'holiday'; name: string; nameFr: string | null; pct: number }
  | { kind: 'event'; id: string; name: string; pct: number | null; extra: number | null; startMinute: number | null; endMinute: number | null; cityWide: boolean; notes: string | null }
  | { kind: 'school'; name: string };

export interface DayWeather {
  high: number | null;
  low: number | null;
  pop: number | null;
  iconCode: number | null;
  condition: Condition;
  summaryEn: string | null;
  summaryFr: string | null;
  observed: boolean;
}

/** How attendance responded to the weather here: a year of daily totals against the observed weather. */
async function learnedFor(tx: Tx, facilityId: string, tz: string, site: string, isSchoolDay: (d: string) => boolean) {
  const until = new Date();
  const since = new Date(until.getTime() - 365 * 86_400_000);
  const [totals, obs] = await Promise.all([
    tx.$queryRaw<Array<{ d: Date; total: number }>>`
      SELECT d, SUM(peak)::int AS total FROM (
        SELECT (h."recordedAt" AT TIME ZONE ${tz})::date AS d, h."poolBodyId", date_trunc('hour', h."recordedAt" AT TIME ZONE ${tz}) AS hr, MAX(h.count) AS peak
        FROM "HeadCount" h JOIN "PoolBody" p ON p.id = h."poolBodyId"
        WHERE p."facilityId" = ${facilityId}::uuid AND h."recordedAt" >= ${since} AND h."recordedAt" < ${until}
        GROUP BY 1, 2, 3) x
      GROUP BY d`,
    tx.weatherObservation.findMany({ where: { site, date: { gte: since, lt: until } }, select: { date: true, high: true, condition: true, precipMm: true, snowCm: true } }),
  ]);
  const weather = new Map(obs.map((o) => [iso(o.date), { high: o.high, condition: o.condition as Condition, precipMm: o.precipMm, snowCm: o.snowCm } satisfies WeatherDay]));
  const days = totals.flatMap((t) => {
    const w = weather.get(iso(t.d));
    return w ? [{ date: iso(t.d), total: Number(t.total), weather: w }] : [];
  });
  return learnEffects(days, isSchoolDay);
}

export async function forecastWeek(tx: Tx, facilityId: string, weekStart: string, positionId: string | null) {
  const facility = await tx.facility.findUniqueOrThrow({ where: { id: facilityId }, select: { timezone: true, name: true, province: true, exposure: true, venueKind: true, weatherSite: true, weatherSiteAuto: true } });
  const tz = facility.timezone;
  const profile = profileOf(facility.exposure, facility.venueKind);
  const site = facility.weatherSite ?? facility.weatherSiteAuto;
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
  const weekFrom = asDate(weekStart);
  const weekTo = asDate(weekEnd);
  const [eventRows, holidays, siteRow, fcDays, obsDays, learned] = await Promise.all([
    tx.specialEvent.findMany({ where: { OR: [{ facilityId }, { facilityId: null }], startsOn: { lte: weekTo } }, orderBy: { startsOn: 'asc' } }),
    tx.statutoryHoliday.findMany({ where: { province: facility.province, date: { gte: weekFrom, lte: weekTo } } }),
    site ? tx.weatherSite.findUnique({ where: { site } }) : null,
    site ? tx.weatherForecastDay.findMany({ where: { site, date: { gte: weekFrom, lte: weekTo } } }) : [],
    site ? tx.weatherObservation.findMany({ where: { site, date: { gte: weekFrom, lte: weekTo } } }) : [],
    site ? learnedFor(tx, facilityId, tz, site, (d) => cal.isSchoolDay(d)) : new Map<Bucket, { pct: number; days: number }>(),
  ]);
  const events: EventRow[] = eventRows
    .map((e) => ({ id: e.id, facilityId: e.facilityId, name: e.name, startsOn: iso(e.startsOn), endsOn: iso(e.endsOn), startMinute: e.startMinute, endMinute: e.endMinute, extraPeople: e.extraPeople, percent: e.percent, recursYearly: e.recursYearly, notes: e.notes }))
    .filter((e) => e.recursYearly || e.endsOn >= weekStart);
  const today = localDate(new Date(), tz);
  const fcBy = new Map(fcDays.map((d) => [iso(d.date), d]));
  const obsBy = new Map(obsDays.map((d) => [iso(d.date), d]));
  const weatherOn = (day: string): DayWeather | null => {
    const o = obsBy.get(day);
    const f = fcBy.get(day);
    if (o && (day < today || !f)) return { high: o.high === null ? null : Math.round(o.high), low: o.low === null ? null : Math.round(o.low), pop: null, iconCode: null, condition: o.condition as Condition, summaryEn: null, summaryFr: null, observed: true };
    if (f) return { high: f.high, low: f.low, pop: f.pop, iconCode: f.iconCode, condition: f.condition as Condition, summaryEn: f.summaryEn, summaryFr: f.summaryFr, observed: false };
    return null;
  };
  const breaks = periods.filter((p) => p.kind === 'BREAK');
  const samples: Sample[] = counts.map((c) => ({ poolId: c.poolBodyId, day: localDate(c.recordedAt, tz), hour: Number(localIso(c.recordedAt, tz).slice(11, 13)), count: c.count }));
  const expect = expectedByHour(samples, (d) => cal.isSchoolDay(d));
  // Every hour anything happens: history, opening hours or a class.
  const hourSet = new Set(samples.map((s) => s.hour));
  for (const b of blocks) for (let h = Math.floor(b.opensMinute / 60); h * 60 < b.closesMinute; h++) hourSet.add(h);
  for (const c of classes) if (c.swimmers) for (let h = Math.floor(c.startMinute / 60); h * 60 < c.endMinute; h++) hourSet.add(h);
  const hoursSeen = [...hourSet].filter((h) => h >= 0 && h < 24).sort((a, b) => a - b);

  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)).map((day) => {
    const weather = weatherOn(day);
    const adjustments: Adjustment[] = [];
    let dayFactor = 1;
    if (weather) {
      const eff = weatherEffect(profile, weather, day, learned);
      adjustments.push({ kind: 'weather', bucket: eff.bucket, condition: weather.condition, high: weather.high, pct: eff.pct, source: eff.source, ...(eff.days ? { days: eff.days } : {}) });
      dayFactor *= 1 + eff.pct / 100;
    }
    for (const hd of holidays.filter((x) => iso(x.date) === day)) {
      const pct = holidayEffect(profile);
      adjustments.push({ kind: 'holiday', name: hd.name, nameFr: hd.nameFr, pct });
      dayFactor *= 1 + pct / 100;
    }
    const todays = events.filter((e) => occursOn(e, day));
    for (const e of todays) adjustments.push({ kind: 'event', id: e.id, name: e.name, pct: e.percent, extra: e.extraPeople, startMinute: e.startMinute, endMinute: e.endMinute, cityWide: e.facilityId === null, notes: e.notes });
    for (const b of breaks.filter((p) => iso(p.startsOn) <= day && iso(p.endsOn) >= day)) adjustments.push({ kind: 'school', name: b.name });
    return {
      date: day,
      schoolDay: cal.isSchoolDay(day),
      weather,
      adjustments,
      hours: hoursSeen.map((hour) => {
        const slotStart = localHour(day, hour, tz);
        const slotEnd = new Date(slotStart.getTime() + 3_600_000);
        const hours = openAt(blocks, dayOfWeek(day), hour);
        const lessons = lessonsAt(classes, day, hour, positionId);
        const open = hours ? hours.open : null;
        let basedOn = 0;
        const base = new Map<string, number>();
        for (const p of pools) {
          const e = expect(p.id, day, hour);
          if (!e) continue;
          base.set(p.id, e.expected);
          basedOn = Math.max(basedOn, e.basedOnDays);
        }
        // This hour's events: a percentage, or extra people at a time (shared across pools as usual).
        const now = todays.filter((e) => coversHour(e, hour));
        const factor = now.reduce((f, e) => f * (1 + (e.percent ?? 0) / 100), dayFactor);
        const extra = open === false ? 0 : now.reduce((s, e) => s + (e.extraPeople ?? 0), 0);
        const baseTotal = [...base.values()].reduce((s, v) => s + v, 0);
        const adjusted = new Map<string, number>();
        for (const p of pools) {
          const b = base.get(p.id) ?? 0;
          const share = extra ? (baseTotal ? (extra * b) / baseTotal : p === pools[0] ? extra : 0) : 0;
          adjusted.set(p.id, Math.max(0, Math.round(b * factor + share)));
        }
        const staff = (byPool: Map<string, number>) => {
          let expected = 0;
          let fromBathers = 0;
          for (const p of pools) {
            const n = byPool.get(p.id) ?? 0;
            expected += n;
            fromBathers += n > 0 ? lifeguardsRequired(n, p.bathersPerLifeguard) ?? 0 : 0;
          }
          if (!pools.length) expected = Math.round(extra);
          const reasons: Array<'bathers' | 'minimum' | 'lessons' | 'closed'> = [];
          let needed: number;
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
          return { expected, needed, reasons };
        };
        const before = staff(base);
        const after = forLessons ? before : staff(adjusted);
        const during = shifts.filter((s) => s.startsAt < slotEnd && s.endsAt > slotStart);
        const scheduled = during.filter((s) => s.userId).length;
        // Open shifts already made for this hour (drafted or on the board), not yet filled.
        const unfilled = during.length - scheduled;
        return {
          hour,
          open,
          unfilled,
          expected: after.expected,
          needed: after.needed,
          scheduled,
          gap: Math.max(0, after.needed - scheduled),
          basedOnDays: basedOn,
          lessons: { classes: lessons.classes, swimmers: lessons.swimmers },
          reasons: after.reasons,
          base: { expected: before.expected, needed: before.needed, gap: Math.max(0, before.needed - scheduled) },
        };
      }),
    };
  });
  const anyWeather = days.some((d) => d.weather);
  const weatherStatus: 'ok' | 'unavailable' | 'no-location' | 'beyond' = !site
    ? 'no-location'
    : anyWeather
      ? 'ok'
      : weekStart > addDays(today, 6)
        ? 'beyond'
        : 'unavailable';
  return {
    facility: facility.name,
    weekStart,
    weeksOfHistory: WEEKS,
    hoursSet: blocks.length > 0,
    forLessons,
    pools: pools.map((p) => ({ id: p.id, name: p.name, ratio: p.bathersPerLifeguard })),
    weather: {
      status: weatherStatus,
      site,
      siteName: siteRow ? { en: siteRow.nameEn, fr: siteRow.nameFr ?? siteRow.nameEn } : null,
      fetchedAt: siteRow?.lastOkAt?.toISOString() ?? null,
      // The last fetch failed: what's shown may be older than usual.
      stale: !!siteRow?.failures && !!siteRow.lastOkAt && Date.now() - siteRow.lastOkAt.getTime() > 12 * 3_600_000,
      profile,
      learned: [...learned.entries()].map(([bucket, v]) => ({ bucket, pct: v.pct, days: v.days })),
    },
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
