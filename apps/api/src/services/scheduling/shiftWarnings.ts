/**
 * Warnings the planner, Fill and the publish check show on shifts (never refusals):
 *  - BREAK_MISSING / BREAK_SHORT: long enough to need a meal break under the province's rule, with
 *    none (or too little) planned. n = [required minutes, planned minutes].
 *  - SHORT_SHIFT: shorter than the minimum call-in pay (it costs the minimum anyway). n = [paid hours, minimum].
 *  - TWO_PERSON: a never-alone shift with stretches where no second qualified person overlaps.
 *    n = [hours alone].
 */
import type { Prisma } from '@prisma/client';
import type { Tx } from '../../lib/db.js';
import { localDate } from '../../lib/time.js';
import { resolveRules } from '../compliance/provincialRules.js';
import { departmentRuleSettings } from './eligibilityLoader.js';
import { isNeverAlone, twoPersonViolations } from './twoPerson.js';
import { breakMinutesOf, breakWarning, effectiveWorkRules, paidHours, parseWorkRules, reportingMinimum } from './workRules.js';

export interface ShiftWarning { code: 'BREAK_MISSING' | 'BREAK_SHORT' | 'SHORT_SHIFT' | 'TWO_PERSON'; n: number[] }

export const warningShiftInclude = {
  facility: { select: { province: true, timezone: true } },
  position: { select: { unpaidBreakMinutes: true, neverAlone: true, departmentId: true } },
} as const;
export type WarningShift = Prisma.ShiftGetPayload<{ include: typeof warningShiftInclude }>;

/** Warnings per shift id (only shifts with at least one). */
export async function shiftWarnings(tx: Tx, shifts: ReadonlyArray<WarningShift>): Promise<Map<string, ShiftWarning[]>> {
  const out = new Map<string, ShiftWarning[]>();
  if (!shifts.length) return out;
  const tenant = await tx.tenant.findFirstOrThrow({ include: { ruleOverrides: true } });
  const overrides = tenant.ruleOverrides.map((o) => ({ province: o.province, ruleKey: o.ruleKey, value: o.value, effectiveFrom: o.effectiveFrom.toISOString().slice(0, 10), effectiveTo: o.effectiveTo?.toISOString().slice(0, 10) ?? null }));
  const workRules = parseWorkRules(tenant.workRules);
  const add = (id: string, w: ShiftWarning) => out.set(id, [...(out.get(id) ?? []), w]);
  for (const s of shifts) {
    if (s.status === 'CANCELLED') continue;
    const dept = s.position.departmentId;
    const federal = departmentRuleSettings(tenant.overtimePolicy, tenant.features, dept).federal;
    const rules = resolveRules(s.facility.province, localDate(s.startsAt, s.facility.timezone), overrides, { federal });
    const wr = effectiveWorkRules(workRules, dept);
    const brk = breakMinutesOf(s, s.position);
    const len = (s.endsAt.getTime() - s.startsAt.getTime()) / 3_600_000;
    const bw = breakWarning(len, brk, rules.mealBreak, wr.breaks);
    if (bw) add(s.id, { code: bw.code, n: [bw.requiredMinutes, bw.plannedMinutes] });
    if (!s.callBack) {
      const paid = paidHours({ start: s.startsAt, end: s.endsAt, breakMinutes: brk });
      const min = reportingMinimum(wr.callIn, rules.reportingPay, paid);
      if (min && paid + 1e-9 < min.minHours) add(s.id, { code: 'SHORT_SHIFT', n: [Math.round(paid * 100) / 100, min.minHours] });
    }
  }
  const alone = shifts.filter((s) => s.userId && s.status !== 'CANCELLED' && isNeverAlone(s, s.position));
  if (alone.length) {
    const lo = new Date(Math.min(...alone.map((s) => s.startsAt.getTime())));
    const hi = new Date(Math.max(...alone.map((s) => s.endsAt.getTime())));
    // Company: anyone working at those facilities then, in any department.
    const company = await tx.shift.findMany({
      where: { facilityId: { in: [...new Set(alone.map((s) => s.facilityId))] }, status: { not: 'CANCELLED' }, userId: { not: null }, startsAt: { lt: hi }, endsAt: { gt: lo } },
      select: { id: true, userId: true, facilityId: true, positionId: true, startsAt: true, endsAt: true, user: { select: { positions: { select: { positionId: true } } } } },
    });
    const qualified = new Map(company.map((c) => [c.userId!, new Set(c.user?.positions.map((p) => p.positionId) ?? [])]));
    const list = [
      ...company.filter((c) => !alone.some((a) => a.id === c.id)).map((c) => ({ id: c.id, userId: c.userId, facilityId: c.facilityId, positionId: c.positionId, start: c.startsAt, end: c.endsAt, neverAlone: false })),
      ...alone.map((s) => ({ id: s.id, userId: s.userId, facilityId: s.facilityId, positionId: s.positionId, start: s.startsAt, end: s.endsAt, neverAlone: true })),
    ];
    for (const v of twoPersonViolations(list, (u, p) => qualified.get(u)?.has(p) ?? false)) add(v.shiftId, { code: 'TWO_PERSON', n: [v.aloneHours] });
  }
  return out;
}
