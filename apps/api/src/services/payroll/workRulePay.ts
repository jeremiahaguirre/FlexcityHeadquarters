/**
 * Work rules in payroll (services/scheduling/workRules.ts):
 *  - unpaid meal breaks: a scheduled shift's planned break comes out of its punch when the person
 *    didn't punch out for it (one punch for the shift). Two or more punches for a shift mean the
 *    break was punched, so the punches are paid as recorded. Unscheduled punches have no plan and
 *    are paid as recorded;
 *  - rule-based shift premiums (evening, night, weekend, holiday) on the paid hours;
 *  - minimum call-in (reporting) pay: a REPORTING_PAY top-up when someone worked less than the
 *    minimum on a scheduled shift (the province's minimum, or the department's if higher);
 *  - call-back minimum: a CALLBACK_PAY top-up on call-back shifts (someone on call called in);
 *  - late schedule-change premiums (SCHEDULE_CHANGE_PREMIUM) recorded when a published shift
 *    changed with less notice than the department's rule, paid in the period of `payOn`;
 *  - standby pay (STANDBY_PAY) for on-call periods inside the pay period.
 * Shifts and people with none of these rules are paid exactly as before.
 */
import type { PayCodeKey, Prisma, Province } from '@prisma/client';
import type { Tx } from '../../lib/db.js';
import { Decimal, ZERO, cents, dec } from '../../lib/money.js';
import { localDate, startOfLocalDay, wholeYearsBetween } from '../../lib/time.js';
import { type ProvinceRules, resolveRules, vacationPercent } from '../compliance/provincialRules.js';
import {
  type EffectiveWorkRules,
  breakWindow,
  type PremiumPiece,
  type WorkRules,
  breakAfterHoursFor,
  breakMinutesOf,
  callbackMinimum,
  changePremiumAmount,
  effectiveWorkRules,
  paidHours,
  paidIntervals,
  parseWorkRules,
  premiumPieces,
  reportingMinimum,
  reportingTopUp,
  standbyPay,
} from '../scheduling/workRules.js';
import type { PayLine, PayResult } from './payCalc.js';

export type PayResultWithExtras = PayResult;

interface PunchLike {
  id: string;
  clockIn: Date;
  clockOut: Date | null;
  positionId: string;
  shiftId: string | null;
  shift: { id: string; startsAt: Date; endsAt: Date; positionId: string; status: string; callBack: boolean; premiumPerHour: Prisma.Decimal | null; unpaidBreakMinutes: number | null; position: { unpaidBreakMinutes: number | null } } | null;
}

export function workRuleIntervals(ps: ReadonlyArray<PunchLike>, ctx: { rules: ProvinceRules; workRules: WorkRules; deptOfPosition: ReadonlyMap<string, string | null>; timezone: string }) {
  const eff = new Map<string, EffectiveWorkRules>();
  const effFor = (positionId: string) => {
    const d = ctx.deptOfPosition.get(positionId) ?? null;
    const k = d ?? '';
    if (!eff.has(k)) eff.set(k, effectiveWorkRules(ctx.workRules, d));
    return eff.get(k)!;
  };
  const perShift = new Map<string, number>();
  for (const p of ps) if (p.shiftId) perShift.set(p.shiftId, (perShift.get(p.shiftId) ?? 0) + 1);
  const intervals = ps.map((p) => {
    const iv = { start: p.clockIn, end: p.clockOut!, positionId: p.positionId, premiumPerHour: p.shift?.premiumPerHour ? dec(p.shift.premiumPerHour) : null, breakAt: null as { start: Date; end: Date } | null };
    // The shift's planned break, only where the single punch covers the whole break window
    // (someone who left early, before or during the break, or came in for an hour, isn't docked
    // a break they didn't complete).
    if (p.shift && perShift.get(p.shift.id) === 1) {
      const b = breakMinutesOf(p.shift, p.shift.position);
      const w = b ? breakWindow(p.shift.startsAt, p.shift.endsAt, b, breakAfterHoursFor(effFor(p.shift.positionId).breaks, ctx.rules)) : null;
      if (w && w.start >= iv.start && w.end <= iv.end) iv.breakAt = w;
    }
    return iv;
  });

  const rulePremiums = (holidays: ReadonlySet<string>) => {
    if (!ctx.workRules.premiums.some((r) => r.active)) return undefined;
    return (piece: { start: Date; end: Date; positionId: string }): PremiumPiece[] =>
      premiumPieces(piece, effFor(piece.positionId).premiums, { timezone: ctx.timezone, departmentId: ctx.deptOfPosition.get(piece.positionId) ?? null, positionId: piece.positionId, holidays });
  };

  /** Call-in and call-back top-ups for scheduled shifts starting inside [from, to) (local dates). */
  const topUps = (from: string, to: string) => {
    const out: Array<{ code: PayCodeKey; positionId: string; hours: number; multiplier: number; localDate: string }> = [];
    const shifts = new Map<string, NonNullable<PunchLike['shift']>>();
    for (const p of ps) if (p.shift && p.shift.status !== 'CANCELLED') shifts.set(p.shift.id, p.shift);
    for (const sh of shifts.values()) {
      const day = localDate(sh.startsAt, ctx.timezone);
      if (day < from || day >= to) continue;
      const worked = intervals.filter((_, k) => ps[k]!.shiftId === sh.id).reduce((s, iv) => s + paidIntervals(iv).reduce((t, x) => t + (x.end.getTime() - x.start.getTime()) / 3_600_000, 0), 0);
      const w = effFor(sh.positionId);
      const scheduled = paidHours({ start: sh.startsAt, end: sh.endsAt, breakMinutes: breakMinutesOf(sh, sh.position) });
      const reporting = reportingMinimum(w.callIn, ctx.rules.reportingPay, scheduled);
      if (sh.callBack) {
        const min = callbackMinimum(w.standby, reporting);
        const hours = reportingTopUp(worked, { minHours: min, source: 'organization', statutoryHours: reporting?.statutoryHours ?? 0 });
        if (hours > 0) out.push({ code: 'CALLBACK_PAY', positionId: sh.positionId, hours, multiplier: w.standby.callbackMultiplier, localDate: day });
      } else {
        const hours = reportingTopUp(worked, reporting);
        if (hours > 0) out.push({ code: 'REPORTING_PAY', positionId: sh.positionId, hours, multiplier: 1, localDate: day });
      }
    }
    return out;
  };

  return { intervals, rulePremiums, topUps };
}

/** Adds an earning line (and the vacation pay on it) to a pay result, in place. */
export function addEarning(result: PayResult, line: { code: PayCodeKey; positionId: string | null; hours: Decimal; rate: Decimal; multiplier: Decimal; amount?: Decimal }, mode: 'PAY_EACH_PERIOD' | 'ACCRUE') {
  const amount = line.amount ?? cents(line.hours.mul(line.rate).mul(line.multiplier));
  if (amount.lte(0)) return;
  const l: PayLine = { code: line.code, positionId: line.positionId, hours: line.hours, rate: line.rate, multiplier: line.multiplier, amount };
  // Keep vacation pay the last line.
  const vacIdx = result.lines.findIndex((x) => x.code === 'VACATION_PAY');
  if (vacIdx >= 0) result.lines.splice(vacIdx, 0, l);
  else result.lines.push(l);
  result.grossWages = result.grossWages.plus(amount);
  const vac = cents(amount.mul(result.vacationPercent).div(100));
  if (vac.lte(0)) return;
  if (mode === 'PAY_EACH_PERIOD') {
    const v = result.lines.find((x) => x.code === 'VACATION_PAY');
    if (v) v.amount = v.amount.plus(vac);
    else result.lines.push({ code: 'VACATION_PAY', positionId: null, hours: ZERO, rate: ZERO, multiplier: new Decimal(result.vacationPercent).div(100), amount: vac });
    result.vacationPay = result.vacationPay.plus(vac);
  } else result.vacationAccrued = result.vacationAccrued.plus(vac);
}

interface ExtraInput {
  tenant: { workRules: unknown; ruleOverrides: Array<{ province: Province | null; ruleKey: string; value: unknown; effectiveFrom: Date; effectiveTo: Date | null }> };
  periodStart: string;
  periodEnd: string;
  onlyUsers: Set<string> | null;
  positionIds: string[] | null;
  facilities: Array<{ id: string; province: Province; timezone: string }>;
}

/** Late-change premiums and standby pay owed in a period, per person. */
export async function workRuleExtras(tx: Tx, x: ExtraInput) {
  const workRules = parseWorkRules(x.tenant.workRules);
  const tz = x.facilities[0]?.timezone ?? 'America/Toronto';
  const from = startOfLocalDay(x.periodStart, tz);
  const to = startOfLocalDay(x.periodEnd, tz);
  const userFilter = x.onlyUsers ? { userId: { in: [...x.onlyUsers] } } : {};
  const [changes, positions] = await Promise.all([
    tx.shiftChange.findMany({ where: { late: true, waivedAt: null, payOn: { gte: new Date(x.periodStart), lt: new Date(x.periodEnd) }, ...userFilter, ...(x.positionIds ? { positionId: { in: x.positionIds } } : {}) } }),
    tx.position.findMany({ select: { id: true, departmentId: true } }),
  ]);
  const deptIds = x.positionIds ? [...new Set(positions.filter((p) => x.positionIds!.includes(p.id) && p.departmentId).map((p) => p.departmentId!))] : null;
  const onCall = await tx.onCallPeriod.findMany({ where: { startsAt: { lt: to }, endsAt: { gt: from }, ...userFilter, ...(deptIds ? { departmentId: { in: deptIds } } : {}) } });
  const userIds = [...new Set([...changes.map((c) => c.userId), ...onCall.map((o) => o.userId)])];
  if (!userIds.length) return [];
  const [users, shifts] = await Promise.all([
    tx.user.findMany({ where: { id: { in: userIds } }, select: { id: true, firstName: true, lastName: true, employeeNumber: true, hireDate: true, payRates: true } }),
    tx.shift.findMany({ where: { id: { in: changes.map((c) => c.shiftId) } }, select: { id: true, facilityId: true } }),
  ]);
  const overrides = x.tenant.ruleOverrides.map((o) => ({ province: o.province, ruleKey: o.ruleKey, value: o.value, effectiveFrom: o.effectiveFrom.toISOString().slice(0, 10), effectiveTo: o.effectiveTo?.toISOString().slice(0, 10) ?? null }));
  const out: Array<{ userId: string; facilityId: string; employeeNumber: string | null; displayName: string; vacationPercent: number; lines: Array<{ code: PayCodeKey; positionId: string | null; hours: Decimal; rate: Decimal; multiplier: Decimal; amount?: Decimal }> }> = [];
  for (const u of users) {
    const rateOn = (positionId: string | null, day: string) => {
      const rs = u.payRates.filter((r) => (positionId === null || r.positionId === positionId) && r.effectiveFrom.toISOString().slice(0, 10) <= day && (!r.effectiveTo || r.effectiveTo.toISOString().slice(0, 10) >= day)).sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime());
      return rs[0] ? dec(rs[0].hourlyRate) : null;
    };
    const lines: (typeof out)[number]['lines'] = [];
    let facilityId: string | null = null;
    for (const c of changes.filter((y) => y.userId === u.id)) {
      const day = c.payOn!.toISOString().slice(0, 10);
      const rate = rateOn(c.positionId, day) ?? rateOn(null, day) ?? ZERO;
      const amount = changePremiumAmount({ premiumHours: c.premiumHours ? Number(c.premiumHours) : null, multiplier: c.multiplier ? Number(c.multiplier) : null, flatAmount: c.flatAmount ? Number(c.flatAmount) : null }, Number(rate));
      if (amount <= 0) continue;
      facilityId ??= shifts.find((s) => s.id === c.shiftId)?.facilityId ?? null;
      lines.push(c.premiumHours && c.multiplier ? { code: 'SCHEDULE_CHANGE_PREMIUM', positionId: c.positionId, hours: dec(c.premiumHours), rate, multiplier: dec(c.multiplier).minus(1), amount: new Decimal(amount) } : { code: 'SCHEDULE_CHANGE_PREMIUM', positionId: c.positionId, hours: ZERO, rate: ZERO, multiplier: ZERO, amount: new Decimal(amount) });
    }
    const mine = onCall.filter((o) => o.userId === u.id);
    for (const deptId of [...new Set(mine.map((o) => o.departmentId))]) {
      const s = effectiveWorkRules(workRules, deptId).standby;
      const deptPositions = positions.filter((p) => p.departmentId === deptId).map((p) => p.id);
      const rate = deptPositions.map((p) => rateOn(p, x.periodStart)).find((r) => r) ?? rateOn(null, x.periodStart) ?? ZERO;
      const pay = standbyPay(mine.filter((o) => o.departmentId === deptId).map((o) => ({ start: o.startsAt, end: o.endsAt })), from, to, s, Number(rate));
      if (pay.amount > 0) lines.push({ code: 'STANDBY_PAY', positionId: null, hours: new Decimal(pay.hours), rate: ZERO, multiplier: ZERO, amount: new Decimal(pay.amount) });
    }
    if (!lines.length) continue;
    const f = x.facilities.find((g) => g.id === facilityId) ?? x.facilities[0];
    if (!f) continue;
    const rules = resolveRules(f.province, x.periodStart, overrides);
    out.push({ userId: u.id, facilityId: f.id, employeeNumber: u.employeeNumber, displayName: `${u.firstName} ${u.lastName}`, vacationPercent: vacationPercent(rules, u.hireDate ? wholeYearsBetween(u.hireDate.toISOString().slice(0, 10), x.periodStart) : 0), lines });
  }
  return out;
}
