/**
 * Work rules for scheduling and pay (wave 2 of the city scheduling needs), stored in
 * `Tenant.workRules`. Pure functions only: the same helpers feed payroll (payCalc / payrollRun),
 * the pay preview, overtime projections, the solver and the planner, so the schedule and the pay
 * stub can never disagree.
 *
 *   {
 *     breaks:  { breakAfterHours: number | null, warnMissing: boolean },
 *     callIn:  { enabled: boolean, minHours: number | null },              // null = the province's minimum
 *     notice:  { postDaysAhead: number | null, lateChangeHours: number | null,
 *                premiumKind: 'multiplier' | 'flat', multiplier: number, flatAmount: number },
 *     standby: { perDay: number | null, hoursPerDay: number | null, percent: number | null,
 *                callbackMinHours: number | null, callbackMultiplier: number },
 *     premiums: PremiumRule[],                                               // evening, night, weekend, holiday…
 *     departments: { [departmentId]: { breaks?, callIn?, notice?, standby? } }  // collective agreements differ
 *   }
 *
 * A department's own values win; anything it leaves out falls back to the organization's.
 * Premium rules carry their own department/position filters instead.
 */
import { z } from 'zod';
import { DateTime } from 'luxon';
import { addDays, localDate } from '../../lib/time.js';
import type { MealBreakRule, ProvinceRules, ReportingPayRule } from '../compliance/provincialRules.js';

// ------------------------------------------------------------------ settings

export const breaksBody = z.object({ breakAfterHours: z.number().min(1).max(12).nullable(), warnMissing: z.boolean() }).partial();
export const callInBody = z.object({ enabled: z.boolean(), minHours: z.number().min(0).max(8).nullable() }).partial();
export const noticeBody = z
  .object({
    postDaysAhead: z.number().int().min(0).max(90).nullable(),
    lateChangeHours: z.number().min(0).max(720).nullable(),
    premiumKind: z.enum(['multiplier', 'flat']),
    multiplier: z.number().min(1).max(3),
    flatAmount: z.number().min(0).max(1000),
  })
  .partial();
export const standbyBody = z
  .object({
    perDay: z.number().min(0).max(1000).nullable(),
    hoursPerDay: z.number().min(0).max(24).nullable(),
    percent: z.number().min(0).max(200).nullable(),
    callbackMinHours: z.number().min(0).max(8).nullable(),
    callbackMultiplier: z.number().min(1).max(3),
  })
  .partial();
export const premiumRuleBody = z.object({
  id: z.string().min(1).max(64),
  name: z.string().trim().min(1).max(80),
  nameFr: z.string().trim().max(80).nullable().optional(),
  kind: z.enum(['evening', 'night', 'weekend', 'holiday', 'custom']),
  /** 0 = Sunday … 6 = Saturday; empty = every day. */
  days: z.array(z.number().int().min(0).max(6)).max(7).default([]),
  /** Wall-clock minutes from the day's midnight; the end may run past midnight (up to 2880). */
  startMinute: z.number().int().min(0).max(1439),
  endMinute: z.number().int().min(1).max(2880),
  /** Only on statutory holidays (as the organization observes them). */
  holidaysOnly: z.boolean().default(false),
  perHour: z.number().min(0).max(100).nullable().default(null),
  percent: z.number().min(0).max(200).nullable().default(null),
  departmentIds: z.array(z.string().uuid()).max(200).default([]),
  positionIds: z.array(z.string().uuid()).max(500).default([]),
  active: z.boolean().default(true),
});
export const departmentWorkRulesBody = z.object({ breaks: breaksBody.optional(), callIn: callInBody.optional(), notice: noticeBody.optional(), standby: standbyBody.optional() });
export const workRulesBody = z.object({
  breaks: breaksBody.optional(),
  callIn: callInBody.optional(),
  notice: noticeBody.optional(),
  standby: standbyBody.optional(),
  premiums: z.array(premiumRuleBody).max(50).optional(),
});

export type PremiumRule = z.output<typeof premiumRuleBody>;
export interface BreakSettings { breakAfterHours: number | null; warnMissing: boolean }
export interface CallInSettings { enabled: boolean; minHours: number | null }
export interface NoticeSettings { postDaysAhead: number | null; lateChangeHours: number | null; premiumKind: 'multiplier' | 'flat'; multiplier: number; flatAmount: number }
export interface StandbySettings { perDay: number | null; hoursPerDay: number | null; percent: number | null; callbackMinHours: number | null; callbackMultiplier: number }
export type DepartmentWorkRules = z.output<typeof departmentWorkRulesBody>;

export interface WorkRules {
  breaks: BreakSettings;
  callIn: CallInSettings;
  notice: NoticeSettings;
  standby: StandbySettings;
  premiums: PremiumRule[];
  departments: Record<string, DepartmentWorkRules>;
}
export type EffectiveWorkRules = Omit<WorkRules, 'departments'>;

export const DEFAULT_BREAKS: BreakSettings = { breakAfterHours: null, warnMissing: true };
export const DEFAULT_CALL_IN: CallInSettings = { enabled: true, minHours: null };
/** Notice: a schedule is posted two weeks ahead; late-change premiums are off until a department's agreement turns them on. */
export const DEFAULT_NOTICE: NoticeSettings = { postDaysAhead: 14, lateChangeHours: null, premiumKind: 'multiplier', multiplier: 1.5, flatAmount: 0 };
/** Standby pay is off until set; a call-back is paid at least 3 hours (a common agreement minimum). */
export const DEFAULT_STANDBY: StandbySettings = { perDay: null, hoursPerDay: null, percent: null, callbackMinHours: 3, callbackMultiplier: 1 };

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const safe = <T>(schema: z.ZodType<T>, v: unknown): T | Record<string, never> => {
  const r = schema.safeParse(obj(v));
  return r.success ? r.data : {};
};

/** Reads `Tenant.workRules`; anything missing or invalid takes the default. */
export function parseWorkRules(stored: unknown): WorkRules {
  const s = obj(stored);
  const departments: Record<string, DepartmentWorkRules> = {};
  for (const [id, raw] of Object.entries(obj(s.departments))) {
    const d = obj(raw);
    departments[id] = {
      ...(d.breaks ? { breaks: safe(breaksBody, d.breaks) } : {}),
      ...(d.callIn ? { callIn: safe(callInBody, d.callIn) } : {}),
      ...(d.notice ? { notice: safe(noticeBody, d.notice) } : {}),
      ...(d.standby ? { standby: safe(standbyBody, d.standby) } : {}),
    };
  }
  const premiums: PremiumRule[] = [];
  for (const p of Array.isArray(s.premiums) ? s.premiums : []) {
    const r = premiumRuleBody.safeParse(p);
    if (r.success) premiums.push(r.data);
  }
  return {
    breaks: { ...DEFAULT_BREAKS, ...safe(breaksBody, s.breaks) },
    callIn: { ...DEFAULT_CALL_IN, ...safe(callInBody, s.callIn) },
    notice: { ...DEFAULT_NOTICE, ...safe(noticeBody, s.notice) },
    standby: { ...DEFAULT_STANDBY, ...safe(standbyBody, s.standby) },
    premiums,
    departments,
  };
}

/** The rules one department works under: its own values over the organization's. */
export function effectiveWorkRules(w: WorkRules, departmentId: string | null | undefined): EffectiveWorkRules {
  const d = (departmentId && w.departments[departmentId]) || {};
  return {
    breaks: { ...w.breaks, ...(d.breaks ?? {}) },
    callIn: { ...w.callIn, ...(d.callIn ?? {}) },
    notice: { ...w.notice, ...(d.notice ?? {}) },
    standby: { ...w.standby, ...(d.standby ?? {}) },
    premiums: w.premiums.filter((p) => p.active && (!p.departmentIds.length || (!!departmentId && p.departmentIds.includes(departmentId)))),
  };
}

// ------------------------------------------------------------------ unpaid meal breaks

/** A shift's unpaid break: its own value, else its position's, else none. */
export function breakMinutesOf(shift: { unpaidBreakMinutes?: number | null }, position?: { unpaidBreakMinutes?: number | null } | null): number {
  const m = shift.unpaidBreakMinutes ?? position?.unpaidBreakMinutes ?? 0;
  return Number.isFinite(m) && m > 0 ? Math.round(m) : 0;
}

export interface BreakInterval { start: Date; end: Date; breakMinutes?: number | null; breakAfterHours?: number | null }

/**
 * Where an unpaid break falls: in the middle of the shift, but starting no later than
 * `afterHours` into it (the province's "no more than 5 hours in a row", or the organization's
 * placement). Placement only matters for which day or pay week the break's minutes come out of.
 */
export function breakWindow(start: Date, end: Date, minutes: number, afterHours: number | null | undefined): { start: Date; end: Date } | null {
  const len = end.getTime() - start.getTime();
  const b = minutes * 60_000;
  if (minutes <= 0 || b >= len) return null;
  const middle = (len - b) / 2;
  const at = afterHours ? Math.min(middle, afterHours * 3_600_000) : middle;
  const s = new Date(start.getTime() + Math.round(at / 60_000) * 60_000);
  return { start: s, end: new Date(s.getTime() + b) };
}

/** The paid parts of a shift: the shift minus its unpaid break. */
export function paidIntervals<T extends BreakInterval>(iv: T): Array<T & { start: Date; end: Date }> {
  const w = iv.breakMinutes ? breakWindow(iv.start, iv.end, iv.breakMinutes, iv.breakAfterHours) : null;
  if (!w) return [iv];
  return [
    { ...iv, start: iv.start, end: w.start, breakMinutes: 0 },
    { ...iv, start: w.end, end: iv.end, breakMinutes: 0 },
  ].filter((x) => x.end > x.start);
}

/** Paid hours of a shift: length − unpaid break. */
export function paidHours(iv: BreakInterval): number {
  const len = (iv.end.getTime() - iv.start.getTime()) / 3_600_000;
  const b = iv.breakMinutes && iv.breakMinutes * 60_000 < iv.end.getTime() - iv.start.getTime() ? iv.breakMinutes / 60 : 0;
  return Math.max(0, len - b);
}

/** Minutes of meal break the rule asks for on a shift of `hours` (0 = none). */
export function requiredBreakMinutes(hours: number, rule: MealBreakRule | null | undefined): number {
  if (!rule || hours <= rule.afterHours + 1e-9) return 0;
  const block = (rule.everyHours ?? rule.afterHours) + rule.minutes / 60;
  return Math.ceil((hours - rule.afterHours - 1e-9) / block) * rule.minutes;
}

export interface BreakWarning { code: 'BREAK_MISSING' | 'BREAK_SHORT'; requiredMinutes: number; plannedMinutes: number; afterHours: number }

/**
 * A shift long enough to need a meal break with none (or too little) planned. The break may be
 * paid (someone who must stay at their post), so this is a warning, never a refusal.
 */
export function breakWarning(lengthHours: number, plannedMinutes: number, rule: MealBreakRule | null | undefined, settings: Pick<BreakSettings, 'warnMissing'> = DEFAULT_BREAKS): BreakWarning | null {
  if (!settings.warnMissing || !rule) return null;
  const required = requiredBreakMinutes(lengthHours, rule);
  if (!required || plannedMinutes >= required) return null;
  return { code: plannedMinutes ? 'BREAK_SHORT' : 'BREAK_MISSING', requiredMinutes: required, plannedMinutes, afterHours: rule.afterHours };
}

/** Where the break goes: the organization's (or department's) placement, else the province's rule. */
export const breakAfterHoursFor = (b: Pick<BreakSettings, 'breakAfterHours'>, rules: Pick<ProvinceRules, 'mealBreak'>) => b.breakAfterHours ?? rules.mealBreak?.afterHours ?? null;

// ------------------------------------------------------------------ minimum call-in / reporting pay

export interface ReportingMinimum { minHours: number; source: 'organization' | 'province' }

/** The minimum paid hours for someone who reports for a shift scheduled for `scheduledHours`. */
export function reportingMinimum(callIn: CallInSettings, rule: ReportingPayRule | null | undefined, scheduledHours: number): ReportingMinimum | null {
  if (!callIn.enabled) return null;
  const statutory = rule ? (rule.longShiftOverHours && rule.longShiftMinHours && scheduledHours > rule.longShiftOverHours ? rule.longShiftMinHours : rule.minHours) : 0;
  // The organization's minimum never goes below the statute.
  const own = callIn.minHours ?? 0;
  const min = Math.max(statutory, own);
  if (min <= 0) return null;
  return { minHours: min, source: own >= statutory && callIn.minHours !== null ? 'organization' : 'province' };
}

/** Hours to top up: the minimum less the hours worked (0 when they worked enough, or not at all). */
export function reportingTopUp(workedHours: number, minimum: ReportingMinimum | null): number {
  if (!minimum || workedHours <= 0) return 0;
  return Math.max(0, Math.round((minimum.minHours - workedHours) * 100) / 100);
}

/** The shortest shift worth scheduling: the call-in minimum (a shorter shift is paid the minimum anyway). */
export function minimumShiftHours(callIn: CallInSettings, rule: ReportingPayRule | null | undefined, fallback: number): number {
  const m = reportingMinimum(callIn, rule, 0);
  return m ? m.minHours : fallback;
}

// ------------------------------------------------------------------ shift premiums

export interface PremiumContext { timezone: string; departmentId: string | null; positionId: string; holidays: ReadonlySet<string> }
export interface PremiumPiece { ruleId: string; hours: number; perHour: number | null; percent: number | null }

const minuteOfWeekday = (d: string) => new Date(`${d}T12:00:00Z`).getUTCDay();

function wallClockAt(isoDate: string, minute: number, tz: string): number {
  const extra = Math.floor(minute / 1440);
  const m = minute - extra * 1440;
  return DateTime.fromISO(addDays(isoDate, extra), { zone: tz }).set({ hour: Math.floor(m / 60), minute: m % 60, second: 0, millisecond: 0 }).toMillis();
}

/**
 * Hours of a paid interval inside each premium rule's windows. A rule window is a wall-clock time
 * on matching days (DST-correct), may run past midnight (22:00–06:00 is 1320–1800 on the day it
 * starts), and on holidays-only rules counts only on the organization's statutory holidays. Every
 * matching rule applies (an evening premium and a weekend premium both pay on a Saturday evening).
 */
export function premiumPieces(iv: { start: Date; end: Date }, rules: ReadonlyArray<PremiumRule>, ctx: PremiumContext): PremiumPiece[] {
  const out: PremiumPiece[] = [];
  const a = iv.start.getTime();
  const b = iv.end.getTime();
  if (b <= a) return out;
  const first = addDays(localDate(iv.start, ctx.timezone), -1);
  const last = localDate(new Date(b - 1), ctx.timezone);
  for (const r of rules) {
    if (!r.active) continue;
    if (r.positionIds.length && !r.positionIds.includes(ctx.positionId)) continue;
    if (r.departmentIds.length && (!ctx.departmentId || !r.departmentIds.includes(ctx.departmentId))) continue;
    if (!r.perHour && !r.percent) continue;
    let ms = 0;
    for (let d = first; d <= last; d = addDays(d, 1)) {
      if (r.days.length && !r.days.includes(minuteOfWeekday(d))) continue;
      if (r.holidaysOnly && !ctx.holidays.has(d)) continue;
      const ws = wallClockAt(d, r.startMinute, ctx.timezone);
      const we = wallClockAt(d, r.endMinute, ctx.timezone);
      ms += Math.max(0, Math.min(b, we) - Math.max(a, ws));
    }
    if (ms > 0) out.push({ ruleId: r.id, hours: ms / 3_600_000, perHour: r.perHour, percent: r.percent });
  }
  return out;
}

/** $ a premium piece adds at a base rate. */
export const premiumAmount = (p: PremiumPiece, rate: number) => p.hours * ((p.perHour ?? 0) + (p.percent ? (rate * p.percent) / 100 : 0));

/** Premium $/h a shift averages at a rate (the solver's cost and the planner's estimate). */
export function premiumPerHourOf(iv: { start: Date; end: Date }, rules: ReadonlyArray<PremiumRule>, ctx: PremiumContext, rate: number): number {
  const hours = (iv.end.getTime() - iv.start.getTime()) / 3_600_000;
  if (!hours) return 0;
  return premiumPieces(iv, rules, ctx).reduce((s, p) => s + premiumAmount(p, rate), 0) / hours;
}

// ------------------------------------------------------------------ schedule change notice

export type ChangeKind = 'TIME' | 'ADDED' | 'REMOVED';
export interface ChangeInput {
  kind: ChangeKind;
  old: { start: Date; end: Date } | null;
  next: { start: Date; end: Date } | null;
  now: Date;
}
export interface NoticeResult {
  noticeHours: number;
  requiredHours: number | null;
  late: boolean;
  /** Hours the multiplier premium applies to (the changed hours). */
  premiumHours: number;
  multiplier: number | null;
  flatAmount: number | null;
}

/**
 * The notice a change to a published shift gives, and the premium a late one earns:
 *  - notice = hours from the change to the earlier of the old and new start;
 *  - late when that is under the department's `lateChangeHours`;
 *  - 'multiplier' premium: the changed hours (hours of the new shift outside the old one; a whole
 *    new shift for someone newly assigned) at (multiplier − 1) × their rate, on top of the hours
 *    themselves, which payroll pays from the punches. A removed shift earns no multiplier premium
 *    (reporting pay and the agreement's own cancellation rules cover it);
 *  - 'flat' premium: a fixed amount for each late change, whatever its kind.
 */
export function changeNotice(input: ChangeInput, notice: NoticeSettings): NoticeResult {
  const starts = [input.old?.start, input.next?.start].filter((x): x is Date => !!x).map((d) => d.getTime());
  const first = starts.length ? Math.min(...starts) : input.now.getTime();
  const noticeHours = Math.max(0, (first - input.now.getTime()) / 3_600_000);
  const required = notice.lateChangeHours;
  const late = required !== null && required > 0 && noticeHours < required - 1e-9;
  let changed = 0;
  if (input.next) {
    const n0 = input.next.start.getTime();
    const n1 = input.next.end.getTime();
    if (input.kind === 'ADDED' || !input.old) changed = (n1 - n0) / 3_600_000;
    else {
      const o0 = input.old.start.getTime();
      const o1 = input.old.end.getTime();
      const inside = Math.max(0, Math.min(n1, o1) - Math.max(n0, o0));
      changed = (n1 - n0 - inside) / 3_600_000;
    }
  }
  const round2 = (n: number) => Math.round(n * 100) / 100;
  if (!late) return { noticeHours: round2(noticeHours), requiredHours: required, late: false, premiumHours: 0, multiplier: null, flatAmount: null };
  if (notice.premiumKind === 'flat') return { noticeHours: round2(noticeHours), requiredHours: required, late, premiumHours: 0, multiplier: null, flatAmount: notice.flatAmount || null };
  const premiumHours = input.kind === 'REMOVED' ? 0 : round2(changed);
  return { noticeHours: round2(noticeHours), requiredHours: required, late, premiumHours, multiplier: premiumHours > 0 ? notice.multiplier : null, flatAmount: null };
}

/** $ of a recorded change premium at a base rate. */
export function changePremiumAmount(c: { premiumHours: number | null; multiplier: number | null; flatAmount: number | null }, rate: number): number {
  const m = c.multiplier && c.premiumHours ? c.premiumHours * rate * Math.max(0, c.multiplier - 1) : 0;
  return Math.round((m + (c.flatAmount ?? 0)) * 100) / 100;
}

// ------------------------------------------------------------------ standby and call-back

/**
 * Standby pay for on-call time inside [from, to): each started 24 hours on call (counted from the
 * period's start, clipped to the pay period) earns `perDay`, plus `hoursPerDay` hours at `percent`
 * of the person's rate. Returns days and $.
 */
export function standbyPay(periods: ReadonlyArray<{ start: Date; end: Date }>, from: Date, to: Date, s: StandbySettings, rate: number): { days: number; amount: number; hours: number } {
  let days = 0;
  for (const p of periods) {
    const a = Math.max(p.start.getTime(), from.getTime());
    const b = Math.min(p.end.getTime(), to.getTime());
    if (b <= a) continue;
    days += Math.ceil((b - a) / 86_400_000 - 1e-9);
  }
  const hours = s.hoursPerDay && s.percent ? days * s.hoursPerDay : 0;
  const amount = days * (s.perDay ?? 0) + (hours ? (hours * rate * (s.percent ?? 0)) / 100 : 0);
  return { days, hours: Math.round(hours * 100) / 100, amount: Math.round(amount * 100) / 100 };
}

/** The call-back minimum for a department: its own, else the call-in minimum, else 3 hours. */
export function callbackMinimum(s: StandbySettings, reporting: ReportingMinimum | null): number {
  return s.callbackMinHours ?? reporting?.minHours ?? 3;
}
