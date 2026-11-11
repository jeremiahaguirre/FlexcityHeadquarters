/**
 * Recurring rotation templates: a cycle of N days, each day off or with one or more shifts (07:00–
 * 19:00 days, 19:00–07:00 nights), worked by crews that start the cycle offset days apart. Presets
 * for the common ones (12-hour 4-on-4-off, 2-2-3 Pitman, Monday–Friday days), or a custom N-week
 * cycle with days and nights.
 *
 * "Generate shifts" for a date range creates DRAFTS: each crew member is placed on their shift
 * only when the shared rule check (evaluateCandidate, every path's check) passes without overtime;
 * otherwise the shift stays open with the reason, for Fill the schedule or the planner to fill.
 *  - wall-clock times on every date (DST-correct: a 19:00–07:00 night is 11 or 13 real hours on a
 *    changeover night, and still starts at 19:00);
 *  - facilities the organization closes on statutory holidays get nothing on those days;
 *  - beyond the Plan-ahead window shifts are created open (people haven't confirmed availability);
 *  - running it twice creates nothing new (a template's shift at the same time is kept).
 */
import { z } from 'zod';
import type { AuthContext } from '../../auth/middleware.js';
import { type Tx, audit } from '../../lib/db.js';
import { badRequest, forbidden, notFound } from '../../lib/errors.js';
import { addDays, localDate } from '../../lib/time.js';
import { holidaysTouching, organizationDay, statutoryDay } from '../payroll/holidayRules.js';
import { shiftInScope, userInScope } from '../people/scope.js';
import { evaluateCandidate, wallClock } from './eligibility.js';
import { evalOpts, loadCandidate, loadShiftBundle } from './eligibilityLoader.js';
import { NO_DEPARTMENT, schedulableDepartments } from './fillRun.js';
import { lockForAssignment } from './locks.js';
import { effectiveSettings, parseSolverSettings } from './solverSettings.js';
import { resolveFeatures } from '../platform/features.js';

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const patternBody = z.array(z.object({ day: z.number().int().min(0).max(83), start: hhmm, end: hhmm, label: z.enum(['day', 'evening', 'night']).nullable().optional() })).min(1).max(200);
export const crewsBody = z.array(z.object({ name: z.string().trim().min(1).max(40), offsetDays: z.number().int().min(0).max(83), userIds: z.array(z.string().uuid()).max(60).default([]), openSlots: z.number().int().min(0).max(20).default(0) })).min(1).max(12);
export const templateBody = z.object({
  name: z.string().trim().min(2).max(80),
  departmentId: z.string().uuid().nullable().optional(),
  facilityId: z.string().uuid(),
  positionId: z.string().uuid(),
  cycleDays: z.number().int().min(1).max(84),
  anchorDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  pattern: patternBody,
  crews: crewsBody,
  unpaidBreakMinutes: z.number().int().min(0).max(240).nullable().optional(),
  active: z.boolean().default(true),
});
export type TemplateInput = z.infer<typeof templateBody>;
export type PatternDay = z.infer<typeof patternBody>[number];
export type Crew = z.infer<typeof crewsBody>[number];

export type PresetKey = 'FOUR_ON_FOUR_OFF' | 'PITMAN_2_2_3' | 'WEEKDAYS' | 'DAYS_NIGHTS_4_WEEK';

/** Common rotations, ready to adjust. */
export function rotationPreset(key: PresetKey): Pick<TemplateInput, 'cycleDays' | 'pattern' | 'crews'> {
  const days = (ds: number[], start: string, end: string, label: PatternDay['label'] = 'day') => ds.map((day) => ({ day, start, end, label }));
  switch (key) {
    case 'FOUR_ON_FOUR_OFF':
      return { cycleDays: 8, pattern: days([0, 1, 2, 3], '07:00', '19:00'), crews: [{ name: 'A', offsetDays: 0, userIds: [], openSlots: 0 }, { name: 'B', offsetDays: 4, userIds: [], openSlots: 0 }] };
    case 'PITMAN_2_2_3':
      // 2 on, 2 off, 3 on, 2 off, 2 on, 3 off: every other weekend off; two crews cover every day.
      return { cycleDays: 14, pattern: days([0, 1, 4, 5, 6, 9, 10], '07:00', '19:00'), crews: [{ name: 'A', offsetDays: 0, userIds: [], openSlots: 0 }, { name: 'B', offsetDays: 7, userIds: [], openSlots: 0 }] };
    case 'WEEKDAYS':
      return { cycleDays: 7, pattern: days([0, 1, 2, 3, 4], '08:00', '16:30'), crews: [{ name: 'A', offsetDays: 0, userIds: [], openSlots: 0 }] };
    case 'DAYS_NIGHTS_4_WEEK':
      // Two weeks of days, then two weeks of nights (Mon–Fri); two crews alternate.
      return {
        cycleDays: 28,
        pattern: [...days([0, 1, 2, 3, 4, 7, 8, 9, 10, 11], '07:00', '15:00'), ...days([14, 15, 16, 17, 18, 21, 22, 23, 24, 25], '23:00', '07:00', 'night')],
        crews: [{ name: 'A', offsetDays: 0, userIds: [], openSlots: 0 }, { name: 'B', offsetDays: 14, userIds: [], openSlots: 0 }],
      };
  }
}

const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
const mod = (n: number, m: number) => ((n % m) + m) % m;

export interface Occurrence { date: string; crew: string; offsetDays: number; start: Date; end: Date; label: string | null; userIds: string[]; openSlots: number }

/** Every shift a template asks for in [from, to) (local dates), wall-clock in the facility's time zone. */
export function occurrences(t: Pick<TemplateInput, 'cycleDays' | 'anchorDate' | 'pattern' | 'crews'>, from: string, to: string, tz: string): Occurrence[] {
  const out: Occurrence[] = [];
  for (let d = from; d < to; d = addDays(d, 1)) {
    for (const c of t.crews) {
      const idx = mod(daysBetween(t.anchorDate, d) - c.offsetDays, t.cycleDays);
      for (const p of t.pattern.filter((x) => x.day === idx)) {
        const s = minutes(p.start);
        let e = minutes(p.end);
        if (e <= s) e += 1440; // past midnight
        out.push({ date: d, crew: c.name, offsetDays: c.offsetDays, start: wallClock(d, s, tz), end: wallClock(d, e, tz), label: p.label ?? null, userIds: c.userIds, openSlots: c.openSlots ?? 0 });
      }
    }
  }
  return out;
}

export interface GenerateInput { templateIds?: string[]; departmentId?: string; from: string; to: string; dryRun?: boolean }
export interface GeneratedItem { templateId: string; date: string; crew: string; startsAt: string; endsAt: string; userId: string | null; status: 'assigned' | 'open' | 'existing' | 'holiday'; reason: string | null }

export const MAX_GENERATE_DAYS = 91;

/** Creates (or previews) the drafts the active templates ask for in a range. */
export async function generateFromTemplates(tx: Tx, a: AuthContext, input: GenerateInput) {
  const days = daysBetween(input.from, input.to);
  if (days <= 0) throw badRequest('The range must end after it starts.');
  if (days > MAX_GENERATE_DAYS) throw badRequest(`Choose a range of up to ${MAX_GENERATE_DAYS} days.`);
  const departments = await schedulableDepartments(tx, a);
  const allowedPositions = new Set(departments.flatMap((d) => d.positionIds));
  const templates = await tx.rotationTemplate.findMany({
    where: { active: true, ...(input.templateIds?.length ? { id: { in: input.templateIds } } : {}), ...(input.departmentId && input.departmentId !== 'all' ? { departmentId: input.departmentId === NO_DEPARTMENT ? null : input.departmentId } : {}) },
    orderBy: { name: 'asc' },
  });
  const usable = templates.filter((t) => allowedPositions.has(t.positionId) && shiftInScope(a.scope, t));
  if (input.templateIds?.length && usable.length !== new Set(input.templateIds).size) throw notFound('Rotation');
  const tenant = await tx.tenant.findFirstOrThrow({ select: { overtimePolicy: true, features: true, holidayObservance: true } });
  const solver = parseSolverSettings(tenant.overtimePolicy);
  const closed = new Set(solver.holidayClosedFacilityIds);
  const facilities = new Map((await tx.facility.findMany({ where: { id: { in: usable.map((t) => t.facilityId) } }, select: { id: true, timezone: true, province: true } })).map((f) => [f.id, f]));
  const holidayCache = new Map<string, Set<string>>();
  const holidaysOf = async (province: string) => {
    if (!holidayCache.has(province)) {
      const rows = await holidaysTouching(tx, province as Parameters<typeof holidaysTouching>[1], input.from, input.to);
      holidayCache.set(province, new Set(rows.flatMap((h) => [statutoryDay(h), organizationDay(h, tenant.holidayObservance)])));
    }
    return holidayCache.get(province)!;
  };
  const items: GeneratedItem[] = [];
  let created = 0;
  for (const t of usable) {
    const f = facilities.get(t.facilityId);
    if (!f) continue;
    const pattern = patternBody.parse(t.pattern);
    const crews = crewsBody.parse(t.crews);
    const today = localDate(new Date(), f.timezone);
    const planAhead = effectiveSettings(solver, t.departmentId, resolveFeatures(tenant.features).seniority).planAheadWeeks;
    const windowEnd = addDays(today, planAhead * 7);
    const holidays = closed.has(t.facilityId) ? await holidaysOf(f.province) : new Set<string>();
    const occ = occurrences({ cycleDays: t.cycleDays, anchorDate: t.anchorDate.toISOString().slice(0, 10), pattern, crews }, input.from, input.to, f.timezone);
    const existing = await tx.shift.findMany({
      where: { status: { not: 'CANCELLED' }, facilityId: t.facilityId, positionId: t.positionId, startsAt: { gte: wallClock(input.from, 0, f.timezone), lt: wallClock(addDays(input.to, 1), 0, f.timezone) } },
      select: { id: true, startsAt: true, endsAt: true, userId: true, rotationTemplateId: true },
    });
    for (const o of occ) {
      const base = { templateId: t.id, date: o.date, crew: o.crew, startsAt: o.start.toISOString(), endsAt: o.end.toISOString() };
      if (holidays.has(o.date)) {
        items.push({ ...base, userId: null, status: 'holiday', reason: 'HOLIDAY_CLOSED' });
        continue;
      }
      const same = existing.filter((x) => x.rotationTemplateId === t.id && x.startsAt.getTime() === o.start.getTime() && x.endsAt.getTime() === o.end.getTime());
      const all: Array<string | null> = [...o.userIds, ...Array.from({ length: o.openSlots }, () => null)];
      if (!all.length) all.push(null);
      // Already generated: the template's shifts at this time count against the people it needs
      // (a person's shift left open earlier still counts), so a second run makes nothing new.
      for (const x of same) items.push({ ...base, userId: x.userId, status: 'existing', reason: null });
      const placed = new Set(same.map((x) => x.userId).filter(Boolean));
      const wanted = all.filter((u) => u === null || !placed.has(u)).slice(0, Math.max(0, all.length - same.length));
      for (const userId of wanted) {
        if (input.dryRun) {
          items.push({ ...base, userId, status: userId && o.date < windowEnd ? 'assigned' : 'open', reason: userId && o.date >= windowEnd ? 'BEYOND_PLAN_AHEAD' : null });
          continue;
        }
        const s = await tx.shift.create({ data: { tenantId: a.tenantId, facilityId: t.facilityId, positionId: t.positionId, startsAt: o.start, endsAt: o.end, status: 'DRAFT', unpaidBreakMinutes: t.unpaidBreakMinutes, rotationTemplateId: t.id } });
        created++;
        let reason: string | null = null;
        let placed: string | null = null;
        if (userId) {
          if (o.date >= windowEnd) reason = 'BEYOND_PLAN_AHEAD';
          else if (!(await userInScope(tx, a.scope, userId))) reason = 'NOT_IN_SCOPE';
          else {
            await lockForAssignment(tx, { userIds: [userId] });
            const bundle = (await loadShiftBundle(tx, s.id))!;
            const c = await loadCandidate(tx, bundle, userId);
            const e = c && evaluateCandidate(c, bundle.shift, bundle.position, evalOpts(bundle));
            if (!e) reason = 'NOT_ACTIVE';
            else if (!e.eligible) reason = e.blocks[0]!.code;
            else if (e.overtimeHours.gt(0)) reason = 'OVERTIME';
            else {
              await tx.shift.update({ where: { id: s.id }, data: { userId, version: { increment: 1 } } });
              placed = userId;
            }
          }
          if (reason) await tx.shift.update({ where: { id: s.id }, data: { conflictReason: `Rotation: ${reason}` } });
        }
        items.push({ ...base, userId: placed, status: placed ? 'assigned' : 'open', reason });
      }
    }
  }
  if (!input.dryRun && created) {
    await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'rotation.generate', entity: 'RotationTemplate', entityId: usable[0]?.id ?? a.tenantId, after: { templates: usable.map((t) => t.id), from: input.from, to: input.to, created, assigned: items.filter((i) => i.status === 'assigned').length } });
  }
  return {
    templates: usable.length,
    created,
    assigned: items.filter((i) => i.status === 'assigned').length,
    open: items.filter((i) => i.status === 'open').length,
    existing: items.filter((i) => i.status === 'existing').length,
    holidays: items.filter((i) => i.status === 'holiday').length,
    items: items.slice(0, 2000),
  };
}

/** Checks a template's department, facility, position and people against the caller's scope. */
export async function assertTemplateWritable(tx: Tx, a: AuthContext, t: Pick<TemplateInput, 'departmentId' | 'facilityId' | 'positionId' | 'crews'>) {
  if (!shiftInScope(a.scope, t)) throw forbidden('This rotation isn’t in your department.');
  const departments = await schedulableDepartments(tx, a);
  if (!departments.some((d) => d.positionIds.includes(t.positionId))) throw forbidden('This rotation isn’t in your department.');
  const pos = await tx.position.findUnique({ where: { id: t.positionId }, select: { departmentId: true } });
  if (!pos) throw notFound('Position');
  if (!(await tx.facility.findUnique({ where: { id: t.facilityId }, select: { id: true } }))) throw notFound('Facility');
  if (t.departmentId && pos.departmentId !== t.departmentId) throw badRequest('The position isn’t in that department.');
  for (const u of [...new Set(t.crews.flatMap((c) => c.userIds))]) if (!(await userInScope(tx, a.scope, u))) throw forbidden('Someone on a crew isn’t in your department.');
  return pos.departmentId;
}
