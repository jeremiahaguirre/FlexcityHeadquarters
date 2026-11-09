/**
 * Loads approved punches for a period, runs calculatePay per employee per
 * facility (province + timezone come from the facility), and builds the CSV.
 */
import type { PayCodeKey } from '@prisma/client';
import type { Tx } from '../../lib/db.js';
import { badRequest } from '../../lib/errors.js';
import { Decimal, dec } from '../../lib/money.js';
import { addDays, startOfLocalDay, wholeYearsBetween } from '../../lib/time.js';
import { resolveRules } from '../compliance/provincialRules.js';
import { type ExportEmployee, buildPayrollCsv } from './export.js';
import { type PayResult, calculatePay } from './payCalc.js';

export async function runPayroll(tx: Tx, tenantId: string, periodStart: string, weeks: number) {
  const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, include: { ruleOverrides: true, payCodeMappings: true } });
  const facilities = await tx.facility.findMany();
  const periodEnd = addDays(periodStart, weeks * 7);
  const overrides = tenant.ruleOverrides.map((o) => ({
    province: o.province,
    ruleKey: o.ruleKey,
    value: o.value,
    effectiveFrom: o.effectiveFrom.toISOString().slice(0, 10),
    effectiveTo: o.effectiveTo?.toISOString().slice(0, 10) ?? null,
  }));

  const unapproved = await tx.timePunch.count({
    where: { status: 'PENDING', clockIn: { lt: new Date(startOfLocalDay(periodEnd, 'UTC').getTime() + 86_400_000) }, clockOut: { gt: new Date(startOfLocalDay(periodStart, 'UTC').getTime() - 86_400_000) } },
  });
  const openPunches = await tx.timePunch.count({ where: { clockOut: null } });

  const employees: ExportEmployee[] = [];
  const results: Array<{ userId: string; facilityId: string; result: PayResult }> = [];
  const warnings = new Set<string>();
  if (unapproved) warnings.add(`${unapproved} punch(es) in or near this period are still pending approval and were excluded.`);
  if (openPunches) warnings.add(`${openPunches} punch(es) have no clock-out and were excluded.`);

  for (const f of facilities) {
    const from = startOfLocalDay(periodStart, f.timezone);
    const to = startOfLocalDay(periodEnd, f.timezone);
    const punches = await tx.timePunch.findMany({
      where: { facilityId: f.id, status: 'APPROVED', clockOut: { not: null, gt: from }, clockIn: { lt: to } },
      include: { shift: true, user: { include: { payRates: true } } },
    });
    if (punches.length === 0) continue;

    const holidays = await tx.statutoryHoliday.findMany({
      where: { province: f.province, date: { gte: new Date(periodStart), lt: new Date(periodEnd) } },
    });
    const statSet = new Set(holidays.map((h) => h.date.toISOString().slice(0, 10)));
    const rules = resolveRules(f.province, periodStart, overrides);

    const byUser = new Map<string, typeof punches>();
    for (const p of punches) byUser.set(p.userId, [...(byUser.get(p.userId) ?? []), p]);

    for (const [userId, ps] of byUser) {
      const user = ps[0]!.user;
      const rateFor = (positionId: string, localDate: string): Decimal => {
        const r = user.payRates
          .filter((pr) => pr.positionId === positionId && pr.effectiveFrom.toISOString().slice(0, 10) <= localDate && (!pr.effectiveTo || pr.effectiveTo.toISOString().slice(0, 10) >= localDate))
          .sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime())[0];
        if (!r) throw badRequest(`${user.firstName} ${user.lastName} has no pay rate for position ${positionId} on ${localDate}.`);
        return dec(r.hourlyRate);
      };
      const result = calculatePay({
        intervals: ps.map((p) => ({ start: p.clockIn, end: p.clockOut!, positionId: p.positionId, premiumPerHour: p.shift?.premiumPerHour ? dec(p.shift.premiumPerHour) : null })),
        timezone: f.timezone,
        payWeekStartDay: tenant.payWeekStartDay,
        periodStart,
        weeks,
        rules,
        rateFor,
        statHolidays: statSet,
        completedYearsOfService: user.hireDate ? wholeYearsBetween(user.hireDate.toISOString().slice(0, 10), periodStart) : 0,
        vacationPayMode: tenant.vacationPayMode,
      });
      result.warnings.forEach((w) => warnings.add(w));
      results.push({ userId, facilityId: f.id, result });
      employees.push({
        userId,
        employeeNumber: user.employeeNumber,
        displayName: `${user.firstName} ${user.lastName}`,
        costCenter: f.costCenter,
        lines: result.lines,
      });
    }
  }

  const resolve = (key: PayCodeKey, positionId: string | null) =>
    tenant.payCodeMappings.find((m) => m.key === key && m.positionId === positionId)?.code ??
    tenant.payCodeMappings.find((m) => m.key === key && m.positionId === null)?.code ??
    null;

  const csv = buildPayrollCsv(employees, { resolve }, { start: periodStart, end: addDays(periodEnd, -1) });
  return { csv, results, warnings: [...warnings] };
}
