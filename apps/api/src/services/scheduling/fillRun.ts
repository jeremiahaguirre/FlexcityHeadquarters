/**
 * "Fill the schedule" against the database: which departments a person may fill, loading one
 * week of a department's open draft shifts and people, running the solver, and accepting or
 * undoing proposals. Nothing is written until someone accepts, and then only as draft
 * assignments: publishing stays the existing step.
 *
 * Department level: a run covers one department's positions (or all the person may schedule),
 * proposes only people who hold one of those positions (people from other departments who hold
 * a position here are included and marked), never anyone outside the person's scope, and sees
 * every other shift those people have — drafts and published, in any department — so a person
 * shared by two departments is never double-booked.
 */
import type { Prisma, Province } from '../../generated/prisma/client.js';
import { DateTime } from 'luxon';
import type { AuthContext } from '../../auth/middleware.js';
import { type Tx, audit, withTenant } from '../../lib/db.js';
import { badRequest, forbidden, notFound } from '../../lib/errors.js';
import { addDays, dayOfWeek, localDate, localIso, payWeekStart, startOfLocalDay } from '../../lib/time.js';
import { resolveRules } from '../compliance/provincialRules.js';
import { holidaysTouching, organizationDay, statutoryDay } from '../payroll/holidayRules.js';
import { buildSchoolCalendar } from '../compliance/schoolCalendar.js';
import { blockingItemsForPosition } from '../people/onboarding.js';
import { facilitiesOf, peopleWhere, shiftInScope, userInScope } from '../people/scope.js';
import { resolveFeatures } from '../platform/features.js';
import { tooLittleTravel } from './assistant.js';
import { type PositionSpec, evaluateCandidate, parseHoursOfService, wallClock } from './eligibility.js';
import { type BundleCache, evalOpts, loadAssistantCandidates, loadCandidate, loadShiftBundle } from './eligibilityLoader.js';
import { lockForAssignment } from './locks.js';
import { chargeOvertime, parsePolicy, periodStart, reverseOvertime } from './overtime.js';
import { createShift } from './shifts.js';
import { type StatedPreferences, loadPreferences } from './preferences.js';
import { type CoverageNeed, type SolverPerson, type SolverSlot, orderKey, solve } from './solver.js';
import { breakAfterHoursFor, breakMinutesOf, effectiveWorkRules, paidIntervals, parseWorkRules, premiumPieces } from './workRules.js';
import { isNeverAlone } from './twoPerson.js';
import { type EffectiveSettings, type HorizonWeeks, type SolverToggles, type SolverWeights, effectiveSettings, parseSolverSettings, withSolverSettings } from './solverSettings.js';

/** Pseudo-departments: positions that belong to none, and everything the person may schedule. */
export const NO_DEPARTMENT = 'none';
export const ALL_DEPARTMENTS = 'all';

export interface DepartmentOption { id: string; name: string; nameFr: string | null; positionIds: string[]; own: boolean; planAheadWeeks: HorizonWeeks; useSeniority: boolean }

/** The departments this person may fill: every one for an unscoped scheduler, else those their scope reaches. */
export async function schedulableDepartments(tx: Tx, a: AuthContext): Promise<DepartmentOption[]> {
  const [departments, loose, mine, tenant] = await Promise.all([
    tx.department.findMany({ include: { positions: { select: { id: true } } }, orderBy: { name: 'asc' } }),
    tx.position.findMany({ where: { departmentId: null }, select: { id: true } }),
    tx.userPosition.findMany({ where: { userId: a.userId }, select: { position: { select: { departmentId: true } } } }),
    tx.tenant.findFirstOrThrow({ select: { overtimePolicy: true, features: true } }),
  ]);
  const settings = parseSolverSettings(tenant.overtimePolicy);
  const orgSeniority = resolveFeatures(tenant.features).seniority;
  const limit = a.scope?.positionIds.length ? new Set(a.scope.positionIds) : null;
  const ownIds = new Set(mine.map((m) => m.position.departmentId ?? NO_DEPARTMENT));
  const out: DepartmentOption[] = [];
  for (const d of [...departments.map((d) => ({ id: d.id, name: d.name, nameFr: d.nameFr, positions: d.positions.map((p) => p.id) })), { id: NO_DEPARTMENT, name: '', nameFr: null, positions: loose.map((p) => p.id) }]) {
    const positionIds = d.positions.filter((p) => !limit || limit.has(p));
    if (!positionIds.length) continue;
    const eff = effectiveSettings(settings, d.id === NO_DEPARTMENT ? null : d.id, orgSeniority);
    out.push({ id: d.id, name: d.name, nameFr: d.nameFr, positionIds, own: ownIds.has(d.id), planAheadWeeks: eff.planAheadWeeks, useSeniority: eff.useSeniority });
  }
  return out;
}

export interface FillRequest {
  departmentId: string;
  facilityIds?: string[];
  /** Local ISO date the week starts (the first day of the pay week). */
  weekStart: string;
  /** Where the horizon started, and which week of it this is (0-based). */
  horizonStart: string;
  weekIndex: number;
  horizonWeeks: HorizonWeeks;
  /** Proposals from earlier weeks of this horizon (not yet accepted), carried forward. New (forecast) shifts carry their times. */
  carry: Array<CarryItem>;
  /**
   * Shifts the forecast suggests, not yet created: proposed like any open draft, and created
   * only when the scheduler accepts them (the run itself writes nothing).
   */
  newShifts?: NewShift[];
  toggles?: Partial<SolverToggles>;
  weights?: Partial<SolverWeights>;
  seed?: number;
}

export interface NewShift { key: string; facilityId: string; positionId: string; startsAt: Date; endsAt: Date }
export interface CarryItem { shiftId: string; userId: string; startsAt?: Date; endsAt?: Date; positionId?: string; facilityId?: string }
/** Slot id of a forecast shift that doesn't exist yet. */
export const newSlotId = (key: string) => `new:${key}`;

const H = 3_600_000;

/** Runs one week of a horizon. Read-only apart from the audit row (and the remembered horizon). */
export async function runFillWeek(tx: Tx, a: AuthContext, req: FillRequest) {
  const departments = await schedulableDepartments(tx, a);
  const runDepartments = req.departmentId === ALL_DEPARTMENTS ? departments : departments.filter((d) => d.id === req.departmentId);
  if (!runDepartments.length) throw notFound('Department');
  const positionIds = [...new Set(runDepartments.flatMap((d) => d.positionIds))];

  const tenant = await tx.tenant.findFirstOrThrow({ include: { ruleOverrides: true } });
  const orgSeniority = resolveFeatures(tenant.features).seniority;
  const stored = parseSolverSettings(tenant.overtimePolicy);
  const deptForSettings = runDepartments.length === 1 && runDepartments[0]!.id !== NO_DEPARTMENT ? runDepartments[0]!.id : null;
  const base = effectiveSettings(stored, deptForSettings, orgSeniority);
  // "All my departments": seniority only if every one of them uses it.
  const useSeniority = runDepartments.every((d) => d.useSeniority) && base.useSeniority;
  const toggles = { ...base.toggles, ...(req.toggles ?? {}) };
  const weights = { ...base.weights, ...(req.weights ?? {}), ...(useSeniority ? {} : { seniority: 0 }) };
  if (!toggles.spreadWeekends) weights.spread = 0;
  if (!toggles.sameFacility) weights.continuity = Math.min(weights.continuity, 1);

  const allowedFacilities = facilitiesOf(a.scope);
  const facilities = await tx.facility.findMany({
    where: { ...(req.facilityIds?.length ? { id: { in: req.facilityIds } } : {}), ...(allowedFacilities ? { id: { in: allowedFacilities } } : {}) },
    orderBy: { name: 'asc' },
  });
  if (req.facilityIds?.length && facilities.length !== new Set(req.facilityIds).size) throw notFound('Facility');
  if (!facilities.length) throw notFound('Facility');
  const tz = facilities[0]!.timezone;
  const from = startOfLocalDay(req.weekStart, tz);
  const to = startOfLocalDay(addDays(req.weekStart, 7), tz);
  const horizonFrom = startOfLocalDay(req.horizonStart, tz);

  // Open drafts in this department's positions (and, when not keeping them, drafts already assigned).
  const shifts = await tx.shift.findMany({
    where: {
      status: 'DRAFT',
      positionId: { in: positionIds },
      facilityId: { in: facilities.map((f) => f.id) },
      startsAt: { gte: from, lt: to },
      ...(toggles.keepAssigned ? { userId: null } : {}),
    },
    include: { position: { include: { requirements: { include: { certification: { include: { prerequisites: true } } } } } } },
    orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
  });
  const inScope = shifts.filter((s) => shiftInScope(a.scope, s));
  const facilityIdSet = new Set(facilities.map((f) => f.id));
  const proposedNew = (req.newShifts ?? []).filter((n) => facilityIdSet.has(n.facilityId) && positionIds.includes(n.positionId) && shiftInScope(a.scope, n) && n.startsAt >= from && n.startsAt < to && n.endsAt > n.startsAt);

  // Rules per facility and date, the school calendar and blocking onboarding: loaded once.
  const overrides = tenant.ruleOverrides.map((o) => ({ province: o.province, ruleKey: o.ruleKey, value: o.value, effectiveFrom: o.effectiveFrom.toISOString().slice(0, 10), effectiveTo: o.effectiveTo?.toISOString().slice(0, 10) ?? null }));
  const rulesCache = new Map<string, ReturnType<typeof resolveRules>>();
  const facilityById = new Map(facilities.map((f) => [f.id, f]));
  const allPositions = await tx.position.findMany({ where: { id: { in: positionIds } }, include: { requirements: { include: { certification: { include: { prerequisites: true } } } } } });
  const positionRow = new Map(allPositions.map((p) => [p.id, p]));
  // Federally regulated departments schedule under the Canada Labour Code rule set.
  const federalFor = (positionId: string) => effectiveSettings(stored, positionRow.get(positionId)?.departmentId ?? null, orgSeniority).federallyRegulated;
  const rulesFor = (facilityId: string, date: string, positionId: string) => {
    const federal = federalFor(positionId);
    const k = `${facilityId}|${date}|${federal}`;
    if (!rulesCache.has(k)) rulesCache.set(k, resolveRules(facilityById.get(facilityId)!.province, date, overrides, { federal }));
    return rulesCache.get(k)!;
  };
  // Statutory holidays (as the law and the organization observe them), per province.
  const holidayDays = new Map<Province, Set<string>>();
  for (const prov of new Set(facilities.map((f) => f.province))) {
    const rows = await holidaysTouching(tx, prov, req.horizonStart, addDays(req.weekStart, 7));
    holidayDays.set(prov, new Set(rows.flatMap((h) => [h.date, statutoryDay(h), organizationDay(h, tenant.holidayObservance)])));
  }
  const isHoliday = (facilityId: string, date: string) => holidayDays.get(facilityById.get(facilityId)!.province)?.has(date) ?? false;
  const schoolCalendar = buildSchoolCalendar((await tx.schoolCalendarPeriod.findMany()).map((x) => ({ kind: x.kind, startsOn: x.startsOn.toISOString().slice(0, 10), endsOn: x.endsOn.toISOString().slice(0, 10) })));
  const positionSpecs = new Map<string, PositionSpec>();
  for (const pid of new Set([...inScope.map((s) => s.positionId), ...proposedNew.map((n) => n.positionId)])) {
    const pos = positionRow.get(pid)!;
    const prerequisites = new Map<string, string[]>();
    for (const r of pos.requirements) prerequisites.set(r.certificationId, r.certification.prerequisites.map((p) => p.requiresId));
    positionSpecs.set(pid, {
      id: pid,
      minimumAge: pos.minimumAge,
      requiredCertIds: pos.requirements.map((r) => r.certificationId),
      prerequisites,
      blockingOnboarding: await blockingItemsForPosition(tx, pid),
      hoursOfService: parseHoursOfService(pos.hoursOfService),
    });
  }

  // Beyond the availability planning window, a week is tentative.
  const today = localDate(new Date(), tz);
  const windowEnd = addDays(today, base.planAheadWeeks * 7);
  // Work rules: unpaid breaks (paid hours), rule premiums (cost), never-alone shifts.
  const workRules = parseWorkRules(tenant.workRules);
  const slotOf = (s: { id: string; facilityId: string; positionId: string; startsAt: Date; endsAt: Date; userId: string | null; premiumPerHour: Prisma.Decimal | null; unpaidBreakMinutes?: number | null; neverAlone?: boolean | null }): SolverSlot => {
    const ftz = facilityById.get(s.facilityId)!.timezone;
    const date = localDate(s.startsAt, ftz);
    const pos = positionRow.get(s.positionId);
    const wr = effectiveWorkRules(workRules, pos?.departmentId ?? null);
    const breakMinutes = breakMinutesOf(s, pos);
    const rules = rulesFor(s.facilityId, date, s.positionId);
    const paid = paidIntervals({ start: s.startsAt, end: s.endsAt, breakMinutes, breakAfterHours: breakAfterHoursFor(wr.breaks, rules) });
    const paidH = paid.reduce((t, x) => t + (x.end.getTime() - x.start.getTime()) / H, 0) || 1;
    const holidays = holidayDays.get(facilityById.get(s.facilityId)!.province) ?? new Set<string>();
    const rulePieces = wr.premiums.length ? paid.flatMap((x) => premiumPieces(x, wr.premiums, { timezone: ftz, departmentId: pos?.departmentId ?? null, positionId: s.positionId, holidays })) : [];
    return {
      id: s.id,
      shift: { id: s.id, positionId: s.positionId, facilityId: s.facilityId, timezone: ftz, start: s.startsAt, end: s.endsAt, breakMinutes, breakAfterHours: breakAfterHoursFor(wr.breaks, rules) },
      neverAlone: isNeverAlone(s, pos),
      premiumPercent: rulePieces.reduce((t, p) => t + (p.percent ?? 0) * p.hours, 0) / paidH,
      position: positionSpecs.get(s.positionId)!,
      rules,
      schoolCalendar,
      currentUserId: s.userId,
      tentative: date > windowEnd,
      statHoliday: isHoliday(s.facilityId, date),
      premiumPerHour: (s.premiumPerHour ? Number(s.premiumPerHour) : 0) + rulePieces.reduce((t, p) => t + (p.perHour ?? 0) * p.hours, 0) / paidH,
    };
  };
  const slots: SolverSlot[] = [
    ...inScope.map(slotOf),
    ...proposedNew.map((n) => slotOf({ id: newSlotId(n.key), facilityId: n.facilityId, positionId: n.positionId, startsAt: n.startsAt, endsAt: n.endsAt, userId: null, premiumPerHour: null })),
  ];

  // People: anyone in scope who holds one of these positions.
  const candidates = await loadAssistantCandidates(tx, from, to, { AND: [peopleWhere(a.scope), { positions: { some: { positionId: { in: positionIds } } } }] });
  const userIds = candidates.map((c) => c.userId);
  const carryIds = req.carry.map((c) => c.shiftId).filter((id) => !id.startsWith('new:'));
  const [userRows, rates, ledger, confirmations, priorShifts, carried, positions] = await Promise.all([
    tx.user.findMany({ where: { id: { in: userIds } }, select: { id: true, firstName: true, lastName: true, positions: { select: { positionId: true, approvedAt: true } } } }),
    tx.payRate.findMany({ where: { userId: { in: userIds }, effectiveFrom: { lte: to }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: from } }] }, orderBy: { effectiveFrom: 'desc' } }),
    tx.overtimeEntry.findMany({ where: { userId: { in: userIds }, occurredAt: { gte: periodStart(new Date(), parsePolicy(tenant.overtimePolicy).periodStartMonth) } } }),
    confirmedThrough(tx, userIds),
    tx.shift.findMany({ where: { userId: { in: userIds }, status: { not: 'CANCELLED' }, startsAt: { gte: horizonFrom, lt: from }, facilityId: { in: facilities.map((f) => f.id) } }, select: { userId: true, startsAt: true, endsAt: true, facilityId: true } }),
    carryIds.length ? tx.shift.findMany({ where: { id: { in: carryIds }, status: 'DRAFT', startsAt: { lt: from } }, select: { id: true, startsAt: true, endsAt: true, positionId: true, facilityId: true } }) : Promise.resolve([]),
    tx.position.findMany({ select: { id: true, departmentId: true, department: { select: { name: true, nameFr: true } } } }),
  ]);
  const policy = parsePolicy(tenant.overtimePolicy);
  // Stated shift preferences (where the organization uses them): soft weights only.
  const prefs = resolveFeatures(tenant.features).shiftPreferences ? await loadPreferences(tx, userIds) : new Map<string, StatedPreferences>();
  const deptOfPosition = new Map(positions.map((p) => [p.id, p]));
  const runDeptIds = new Set(runDepartments.map((d) => d.id));
  const carryById = new Map<string, { id: string; startsAt: Date; endsAt: Date; positionId: string; facilityId: string }>(carried.map((c) => [c.id, c]));
  // Forecast shifts proposed in earlier weeks don't exist yet: they carry their own times.
  for (const c of req.carry) if (c.shiftId.startsWith('new:') && c.startsAt && c.endsAt && c.positionId && c.facilityId && c.startsAt < from) carryById.set(c.shiftId, { id: c.shiftId, startsAt: c.startsAt, endsAt: c.endsAt, positionId: c.positionId, facilityId: c.facilityId });

  const people: SolverPerson[] = candidates.map((c) => {
    const u = userRows.find((x) => x.id === c.userId)!;
    const primary = [...u.positions].sort((x, y) => x.approvedAt.getTime() - y.approvedAt.getTime())[0]?.positionId ?? null;
    const mineCarried = req.carry.filter((x) => x.userId === c.userId).map((x) => carryById.get(x.shiftId)).filter((x) => !!x);
    const before = [...priorShifts.filter((s) => s.userId === c.userId).map((s) => ({ start: s.startsAt, end: s.endsAt })), ...mineCarried.map((s) => ({ start: s.startsAt, end: s.endsAt }))];
    const weekend = (d: Date) => [0, 6].includes(dayOfWeek(localDate(d, tz)));
    const evening = (x: { start: Date; end: Date }) => {
      const e = DateTime.fromJSDate(x.end, { zone: tz });
      return e.hour * 60 + e.minute > 19 * 60 || localDate(x.start, tz) !== localDate(new Date(x.end.getTime() - 1), tz);
    };
    const draftsHeld = new Set(slots.filter((s) => s.currentUserId === c.userId).map((s) => s.id));
    const rateBy = new Map<string, number>();
    for (const r of rates.filter((x) => x.userId === c.userId)) if (!rateBy.has(r.positionId)) rateBy.set(r.positionId, Number(r.hourlyRate));
    const mineLedger = ledger.filter((e) => e.userId === c.userId);
    const charged = mineLedger.filter((e) => e.kind === 'ACCEPTED' || policy.countRefusals).reduce((s, e) => s + Number(e.hours), 0);
    const ftTarget = c.employmentStatus === 'FULL_TIME' ? base.targetHours : null;
    return {
      ...c,
      // A draft this run may change isn't "already working" for its current assignee.
      // (matched by shift id: two identical drafts are two shifts).
      existingShifts: [...c.existingShifts.filter((s) => !(s.id && draftsHeld.has(s.id))), ...mineCarried.map((s) => ({ start: s.startsAt, end: s.endsAt, positionId: s.positionId, facilityId: s.facilityId }))],
      seniorityDate: useSeniority ? c.seniorityDate : null,
      seniorityHours: useSeniority ? Number(c.seniorityHours) : 0,
      targetHours: c.weeklyMinHours ? Number(c.weeklyMinHours) : ftTarget,
      primaryPositionId: primary,
      rates: rateBy,
      overtimeCharged: charged,
      prior: {
        hours: before.reduce((s, x) => s + (x.end.getTime() - x.start.getTime()) / H, 0),
        weekends: before.filter((x) => weekend(x.start)).length,
        evenings: before.filter(evening).length,
        holidays: [...priorShifts.filter((s) => s.userId === c.userId), ...mineCarried].filter((x) => isHoliday(x.facilityId, localDate(x.startsAt, tz))).length,
        weeks: req.weekIndex,
      },
      confirmedThrough: confirmations.get(c.userId)?.through ?? null,
      preferences: prefs.get(c.userId),
    };
  });

  // Required coverage at these facilities, with what other people already cover.
  const rules = await tx.coverageRule.findMany({ where: { active: true, facilityId: { in: facilities.map((f) => f.id) } } });
  const coverage: CoverageNeed[] = [];
  for (const r of rules) {
    const ftz = facilityById.get(r.facilityId)!.timezone;
    const windows = [];
    // Wall-clock windows (DST-correct), including the night before the week that runs past
    // midnight into it, and a last-day window that runs past midnight into the next week.
    for (let i = -1; i < 7; i++) {
      const d = addDays(req.weekStart, i);
      if (!r.daysOfWeek.includes(dayOfWeek(d))) continue;
      const start = wallClock(d, r.startMinute, ftz);
      const end = wallClock(d, r.endMinute, ftz);
      if (end <= from) continue;
      windows.push({ start: start < from ? from : start, end });
    }
    if (!windows.length) continue;
    const lastEnd = new Date(Math.max(to.getTime(), ...windows.map((w) => w.end.getTime())));
    const others = await tx.shift.findMany({
      where: { facilityId: r.facilityId, status: { not: 'CANCELLED' }, userId: { notIn: userIds, not: null }, startsAt: { lt: lastEnd }, endsAt: { gt: from } },
      select: { startsAt: true, endsAt: true, user: { select: { certifications: { where: { certificationId: r.certificationId, verifiedAt: { not: null } }, select: { expiryDate: true } } } } },
    });
    // A holder's certificate counts on each shift's own date.
    const valid = (s: (typeof others)[number]) => s.user?.certifications.some((c) => !c.expiryDate || c.expiryDate.toISOString().slice(0, 10) >= localDate(new Date(s.endsAt.getTime() - 1), ftz));
    coverage.push({ id: r.id, name: r.name, facilityId: r.facilityId, certificationId: r.certificationId, minCount: r.minCount, windows, covered: others.filter(valid).map((s) => ({ start: s.startsAt, end: s.endsAt })) });
  }

  // Never-alone shifts: the second person can be someone outside this run already working there.
  const companions: NonNullable<Parameters<typeof solve>[0]['companions']> = [];
  if (slots.some((x) => x.neverAlone)) {
    const rows = await tx.shift.findMany({
      where: { facilityId: { in: facilities.map((f) => f.id) }, status: { not: 'CANCELLED' }, userId: { notIn: userIds, not: null }, startsAt: { lt: new Date(to.getTime() + 86_400_000) }, endsAt: { gt: new Date(from.getTime() - 86_400_000) } },
      select: { id: true, userId: true, facilityId: true, positionId: true, startsAt: true, endsAt: true, user: { select: { positions: { select: { positionId: true } } } } },
    });
    for (const r of rows) companions.push({ id: r.id, userId: r.userId!, facilityId: r.facilityId, positionId: r.positionId, start: r.startsAt, end: r.endsAt, qualifiedPositionIds: new Set(r.user?.positions.map((x) => x.positionId) ?? []) });
    // A soft goal too: the solver prefers filling a second qualified person alongside.
    for (const sl of slots.filter((x) => x.neverAlone)) {
      coverage.push({
        id: `two-person:${sl.id}`,
        name: 'TWO_PERSON',
        facilityId: sl.shift.facilityId,
        certificationId: '',
        positionId: sl.shift.positionId,
        minCount: 2,
        windows: [{ start: sl.shift.start, end: sl.shift.end }],
        covered: companions.filter((c) => c.facilityId === sl.shift.facilityId && c.qualifiedPositionIds.has(sl.shift.positionId)).map((c) => ({ start: c.start, end: c.end })),
      });
    }
  }

  const budget = req.horizonWeeks <= 2 ? 3000 : req.horizonWeeks <= 4 ? 2000 : 1000;
  const seed = req.seed ?? orderKey(0, `${req.departmentId}|${req.weekStart}`) % 100_000;
  const result = solve({
    slots,
    people,
    coverage,
    companions,
    options: {
      weights,
      useSeniority,
      avoidOvertime: toggles.avoidOvertime,
      payWeekStartDay: tenant.payWeekStartDay,
      travelMinutes: base.travelMinutes,
      facilityTimezones: new Map((await tx.facility.findMany({ select: { id: true, timezone: true } })).map((f) => [f.id, f.timezone])),
      maxConsecutiveDays: base.limits.maxConsecutiveDays,
      maxDailyHours: base.limits.maxDailyHours,
      windowStart: from,
      windowEnd: to,
      seed,
      timeBudgetMs: budget,
    },
  });

  if (req.weekIndex === 0 && stored.lastHorizonWeeks !== req.horizonWeeks) {
    await tx.tenant.update({ where: { id: a.tenantId }, data: { overtimePolicy: withSolverSettings(tenant.overtimePolicy, { ...stored, lastHorizonWeeks: req.horizonWeeks }) as Prisma.InputJsonValue } });
  }
  await audit(tx, {
    tenantId: a.tenantId,
    actorId: a.userId,
    action: 'schedule.fill.run',
    entity: 'Department',
    entityId: req.departmentId,
    // `reproducible: false` = the time budget ended the search; the same seed may give a different answer.
    after: { weekStart: req.weekStart, weekIndex: req.weekIndex, horizonWeeks: req.horizonWeeks, toggles, useSeniority, ...result.summary, coverageGaps: result.coverageGaps.length, newShifts: proposedNew.length },
  });

  // Names only for people in the result, with their home department when it isn't this one.
  const named = new Set([...result.proposals.flatMap((p) => [p.userId, ...p.alternatives.map((x) => x.userId)]), ...result.unfilled.flatMap((u) => (u.overtimeOption ? [u.overtimeOption.userId] : []))]);
  const peopleOut: Record<string, { name: string; fromDepartment: { name: string; nameFr: string | null } | null }> = {};
  for (const u of userRows.filter((x) => named.has(x.id))) {
    const primary = [...u.positions].sort((x, y) => x.approvedAt.getTime() - y.approvedAt.getTime())[0];
    const home = primary ? deptOfPosition.get(primary.positionId) : undefined;
    const homeId = home?.departmentId ?? NO_DEPARTMENT;
    peopleOut[u.id] = { name: `${u.firstName} ${u.lastName}`, fromDepartment: home?.department && !runDeptIds.has(homeId) ? { name: home.department.name, nameFr: home.department.nameFr } : null };
  }
  const slotOut = [
    ...inScope.map((s) => ({ id: s.id, version: s.version, facilityId: s.facilityId, positionId: s.positionId, customTitle: s.customTitle, startsAt: s.startsAt, endsAt: s.endsAt, userId: s.userId, newShift: null as null | { startsAt: string; endsAt: string } })),
    ...proposedNew.map((n) => ({ id: newSlotId(n.key), version: 0, facilityId: n.facilityId, positionId: n.positionId, customTitle: null, startsAt: n.startsAt, endsAt: n.endsAt, userId: null, newShift: { startsAt: n.startsAt.toISOString(), endsAt: n.endsAt.toISOString() } })),
  ].map((s) => {
    const f = facilityById.get(s.facilityId)!;
    const pos = positionRow.get(s.positionId)!;
    const sl = slots.find((x) => x.id === s.id)!;
    return {
      id: s.id,
      version: s.version,
      facilityId: s.facilityId,
      facilityName: f.name,
      positionId: s.positionId,
      position: { name: pos.name, nameFr: pos.nameFr },
      customTitle: s.customTitle,
      localStartsAt: localIso(s.startsAt, f.timezone),
      localEndsAt: localIso(s.endsAt, f.timezone),
      // Paid hours (unpaid meal break out).
      hours: (s.endsAt.getTime() - s.startsAt.getTime()) / H - (sl.shift.breakMinutes ?? 0) / 60,
      unpaidBreakMinutes: sl.shift.breakMinutes ?? 0,
      neverAlone: sl.neverAlone ?? false,
      currentUserId: s.userId,
      tentative: sl.tentative ?? false,
      statHoliday: sl.statHoliday ?? false,
      /** A forecast shift not created yet: accepting creates it. */
      newShift: s.newShift,
    };
  });
  return {
    week: { start: req.weekStart, index: req.weekIndex, tentative: addDays(req.weekStart, 6) > windowEnd, beyondWindowFrom: windowEnd },
    settings: { useSeniority, toggles, planAheadWeeks: base.planAheadWeeks },
    summary: result.summary,
    proposals: result.proposals,
    unfilled: result.unfilled,
    // Two-person needs are a soft goal inside the solver; a shift left alone is reported in `unfilled` (TWO_PERSON).
    coverageGaps: result.coverageGaps.filter((g) => !g.needId.startsWith('two-person:')),
    slots: slotOut,
    people: peopleOut,
    /** Shifts of this week proposed, to send back as `carry` for the next week. */
    carry: result.proposals.map((p) => {
      const n = p.slotId.startsWith('new:') ? proposedNew.find((x) => newSlotId(x.key) === p.slotId) : undefined;
      return n ? { shiftId: p.slotId, userId: p.userId, startsAt: n.startsAt.toISOString(), endsAt: n.endsAt.toISOString(), positionId: n.positionId, facilityId: n.facilityId } : { shiftId: p.slotId, userId: p.userId };
    }),
  };
}

/** Latest availability confirmation (or update) per person: confirmed through which date. */
export async function confirmedThrough(tx: Tx, userIds: string[]): Promise<Map<string, { through: string; at: Date }>> {
  if (!userIds.length) return new Map();
  const rows = await tx.auditLog.findMany({ where: { action: { in: ['availability.confirm', 'availability.update'] }, entity: 'User', entityId: { in: userIds } }, orderBy: { at: 'desc' }, select: { entityId: true, after: true, at: true } });
  const out = new Map<string, { through: string; at: Date }>();
  for (const r of rows) {
    const through = (r.after as { through?: unknown } | null)?.through;
    if (r.entityId && !out.has(r.entityId) && typeof through === 'string') out.set(r.entityId, { through, at: r.at });
  }
  return out;
}

export interface AcceptItem {
  /** An existing draft, or (with `newShift`) a forecast shift to create. */
  shiftId?: string;
  newShift?: { facilityId: string; positionId: string; startsAt: Date; endsAt: Date };
  /** The client's id for a new shift (its slot id), echoed in `skipped` and `created`. */
  key?: string;
  /** null only for a new shift left open (created without anyone). */
  userId: string | null;
  expectedVersion: number;
  previousUserId: string | null;
}
interface AppliedItem { shiftId: string; userId: string | null; previousUserId: string | null; version: number; created: boolean; overtimeHours: string }

/**
 * Accepts proposals as DRAFT assignments, one week per transaction (a 13-week horizon never
 * runs as one long transaction). Each item is re-checked now with the full rule set every other
 * path uses (the world may have changed since the run): eligibility with the organization's
 * limits, weekly rest, availability, travel time and overtime; under per-person locks, so two
 * departments accepting at once can never double-book a person they share. Overtime accepted
 * is charged to the ledger. Returns what was applied and skipped, and one undo id per week.
 */
export async function acceptFillChunked(a: AuthContext, items: AcceptItem[], opts: { allowOvertime: boolean }) {
  // Preload start times once, to group by pay week.
  const ids = items.map((i) => i.shiftId).filter((x): x is string => !!x);
  const { starts, payWeekStartDay, tz } = await withTenant(a.tenantId, async (tx) => {
    const rows = ids.length ? await tx.shift.findMany({ where: { id: { in: ids } }, select: { id: true, startsAt: true, facility: { select: { timezone: true } } } }) : [];
    const t = await tx.tenant.findFirstOrThrow({ select: { payWeekStartDay: true } });
    return { starts: new Map(rows.map((r) => [r.id, { at: r.startsAt, tz: r.facility.timezone }])), payWeekStartDay: t.payWeekStartDay, tz: rows[0]?.facility.timezone ?? 'America/Toronto' };
  });
  const weekOf = (it: AcceptItem) => {
    const s = it.shiftId ? starts.get(it.shiftId) : null;
    const at = s?.at ?? it.newShift?.startsAt ?? new Date(0);
    return payWeekStart(localDate(at, s?.tz ?? tz), payWeekStartDay);
  };
  const groups = new Map<string, AcceptItem[]>();
  for (const it of items) groups.set(weekOf(it), [...(groups.get(weekOf(it)) ?? []), it]);
  let applied = 0;
  const skipped: Array<{ shiftId: string; code: string }> = [];
  const undoIds: string[] = [];
  const created: Array<{ key: string; shiftId: string }> = [];
  for (const week of [...groups.keys()].sort()) {
    const r = await withTenant(a.tenantId, (tx) => acceptFill(tx, a, groups.get(week)!, opts));
    applied += r.applied;
    skipped.push(...r.skipped);
    created.push(...r.created);
    if (r.undoId) undoIds.push(r.undoId);
  }
  return { applied, skipped, undoIds, undoId: undoIds.at(-1) ?? null, created };
}

/** One transaction's worth of acceptFillChunked (one week). */
export async function acceptFill(tx: Tx, a: AuthContext, items: AcceptItem[], opts: { allowOvertime: boolean }) {
  const applied: AppliedItem[] = [];
  const skipped: Array<{ shiftId: string; code: string }> = [];
  const created: Array<{ key: string; shiftId: string }> = [];
  for (const id of new Set(items.flatMap((it) => [it.userId, it.previousUserId]).filter((x): x is string => !!x))) {
    if (!(await userInScope(tx, a.scope, id))) throw forbidden('This person isn’t in your department.');
  }
  // Locks first, in one order: shifts, then people (sorted), as every other assigning path does.
  await lockForAssignment(tx, { shiftIds: items.map((i) => i.shiftId), userIds: items.flatMap((i) => [i.userId, i.previousUserId]) });
  const cache: BundleCache = {};
  const actor = { userId: a.userId, tenantId: a.tenantId };
  for (const it of items) {
    const label = it.shiftId ?? it.key ?? `new:${it.newShift?.startsAt.toISOString()}`;
    let shiftId = it.shiftId ?? null;
    let isNew = false;
    if (!shiftId) {
      const n = it.newShift;
      if (!n || !shiftInScope(a.scope, n)) throw forbidden('This shift isn’t in your department.');
      // A forecast shift: created now, on confirm, as a draft (open, or for the person accepted).
      const sh = await createShift(tx, actor, { facilityId: n.facilityId, positionId: n.positionId, startsAt: n.startsAt, endsAt: n.endsAt });
      shiftId = sh.id;
      isNew = true;
      created.push({ key: label, shiftId });
      if (!it.userId) {
        applied.push({ shiftId, userId: null, previousUserId: null, version: sh.version, created: true, overtimeHours: '0.00' });
        continue;
      }
    }
    const bundle = await loadShiftBundle(tx, shiftId, cache);
    if (!bundle) {
      skipped.push({ shiftId: label, code: 'NOT_FOUND' });
      continue;
    }
    if (!shiftInScope(a.scope, bundle.shift)) throw forbidden('This shift isn’t in your department.');
    const expected = isNew ? bundle.shift.version : it.expectedVersion;
    if (bundle.shift.status !== 'DRAFT' || bundle.shift.version !== expected || bundle.shift.userId !== (isNew ? null : it.previousUserId)) {
      skipped.push({ shiftId: label, code: 'CHANGED' });
      continue;
    }
    if (!it.userId) {
      skipped.push({ shiftId: label, code: 'NOT_FOUND' });
      continue;
    }
    const c = await loadCandidate(tx, bundle, it.userId);
    const code = !c ? 'NOT_FOUND' : acceptBlock(c, bundle, opts.allowOvertime);
    if (code || !c) {
      skipped.push({ shiftId: label, code: code ?? 'NOT_FOUND' });
      // A forecast shift nobody could take stays as an open draft the scheduler can post.
      if (isNew) applied.push({ shiftId, userId: null, previousUserId: null, version: bundle.shift.version, created: true, overtimeHours: '0.00' });
      continue;
    }
    const e = evaluateCandidate(c, bundle.shift, bundle.position, evalOpts(bundle, true));
    const done = await tx.shift.updateMany({ where: { id: shiftId, version: expected, status: 'DRAFT', userId: isNew ? null : it.previousUserId }, data: { userId: it.userId, version: { increment: 1 }, conflictReason: null } });
    if (!done.count) {
      skipped.push({ shiftId: label, code: 'CHANGED' });
      continue;
    }
    if (!isNew && it.previousUserId && it.previousUserId !== it.userId) await reverseOvertime(tx, a.tenantId, a.userId, it.previousUserId, shiftId, 'Reassigned by Fill the schedule');
    if (e.overtimeHours.gt(0)) await chargeOvertime(tx, a.tenantId, a.userId, it.userId, shiftId, e.overtimeHours.toFixed(2), bundle.shift.positionId);
    applied.push({ shiftId, userId: it.userId, previousUserId: isNew ? null : it.previousUserId, version: expected + 1, created: isNew, overtimeHours: e.overtimeHours.toFixed(2) });
  }
  let undoId: string | null = null;
  if (applied.length) {
    const row = await tx.auditLog.create({ data: { tenantId: a.tenantId, actorId: a.userId, action: 'schedule.fill.accept', entity: 'Shift', after: { applied, skipped } as unknown as Prisma.InputJsonValue } });
    undoId = row.id;
  }
  return { applied: applied.filter((x) => x.userId).length, skipped, undoId, created };
}

/** The first reason this person can't take this shift now, or null: every hard rule, availability, travel and (unless allowed) overtime. */
function acceptBlock(c: NonNullable<Awaited<ReturnType<typeof loadCandidate>>>, bundle: NonNullable<Awaited<ReturnType<typeof loadShiftBundle>>>, allowOvertime: boolean): string | null {
  const e = evaluateCandidate(c, bundle.shift, bundle.position, evalOpts(bundle, true));
  if (!e.eligible) return e.blocks[0]!.code;
  if (e.overtimeHours.gt(0) && !allowOvertime) return 'OVERTIME';
  if (tooLittleTravel(c, bundle.shift, bundle.travelMinutes * 60_000)) return 'TRAVEL';
  return null;
}

/**
 * Undoes an accept: each shift goes back to who had it, if no one has changed it since and they
 * can still work it (re-checked now; otherwise it's left open and counted). Shifts the accept
 * created from the forecast are cancelled. Overtime charged by the accept comes off the ledger.
 */
export async function undoFill(tx: Tx, a: AuthContext, undoId: string) {
  const row = await tx.auditLog.findUnique({ where: { id: undoId } });
  if (!row || row.action !== 'schedule.fill.accept' || row.actorId !== a.userId) throw notFound('Accepted proposals');
  const done = await tx.auditLog.findFirst({ where: { action: 'schedule.fill.undo', entityId: undoId } });
  if (done) throw badRequest('These proposals were already undone.');
  const applied = ((row.after as { applied?: Array<Partial<AppliedItem> & { shiftId: string; version: number; userId: string | null; previousUserId: string | null }> } | null)?.applied ?? []);
  await lockForAssignment(tx, { shiftIds: applied.map((x) => x.shiftId), userIds: applied.flatMap((x) => [x.userId, x.previousUserId]) });
  let restored = 0;
  let leftOpen = 0;
  const cache: BundleCache = {};
  for (const x of applied) {
    if (x.created) {
      const r = await tx.shift.updateMany({ where: { id: x.shiftId, version: x.version, status: 'DRAFT', userId: x.userId }, data: { status: 'CANCELLED', version: { increment: 1 }, conflictReason: 'Undone in Fill the schedule' } });
      if (r.count && x.userId) await reverseOvertime(tx, a.tenantId, a.userId, x.userId, x.shiftId, 'Fill accept undone');
      restored += r.count;
      continue;
    }
    let back = x.previousUserId;
    if (back) {
      const bundle = await loadShiftBundle(tx, x.shiftId, cache);
      const c = bundle && (await loadCandidate(tx, bundle, back));
      const e = bundle && c ? evaluateCandidate(c, bundle.shift, bundle.position, evalOpts(bundle)) : null;
      if (!e || !e.eligible) {
        back = null;
        leftOpen++;
      }
    }
    const r = await tx.shift.updateMany({ where: { id: x.shiftId, version: x.version, status: 'DRAFT', userId: x.userId }, data: { userId: back, version: { increment: 1 } } });
    if (r.count && x.userId) await reverseOvertime(tx, a.tenantId, a.userId, x.userId, x.shiftId, 'Fill accept undone');
    restored += r.count;
  }
  await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'schedule.fill.undo', entity: 'AuditLog', entityId: undoId, after: { restored, of: applied.length, leftOpen } });
  return { restored, of: applied.length, leftOpen };
}

/** The availability planning window for a person: from their main position's department. */
export async function availabilityWindow(tx: Tx, userId: string, now = new Date()) {
  const [tenant, mine, conf, facility] = await Promise.all([
    tx.tenant.findFirstOrThrow({ select: { overtimePolicy: true, features: true } }),
    tx.userPosition.findMany({ where: { userId }, orderBy: { approvedAt: 'asc' }, select: { position: { select: { departmentId: true } } } }),
    confirmedThrough(tx, [userId]),
    tx.facility.findFirst({ select: { timezone: true }, orderBy: { name: 'asc' } }),
  ]);
  const s = parseSolverSettings(tenant.overtimePolicy);
  const eff: EffectiveSettings = effectiveSettings(s, mine[0]?.position.departmentId ?? null, resolveFeatures(tenant.features).seniority);
  const today = localDate(now, facility?.timezone ?? 'America/Toronto');
  const c = conf.get(userId);
  const through = addDays(today, eff.planAheadWeeks * 7 - 1);
  return { planAheadWeeks: eff.planAheadWeeks, through, confirmedThrough: c?.through ?? null, confirmedAt: c?.at ?? null, current: !!c && c.through >= through };
}

/** Records "still available as usual" (or an availability update) through the window's end. */
export async function confirmAvailability(tx: Tx, tenantId: string, userId: string, action: 'availability.confirm' | 'availability.update') {
  const w = await availabilityWindow(tx, userId);
  await audit(tx, { tenantId, actorId: userId, action, entity: 'User', entityId: userId, after: { through: w.through } });
  return { ...w, confirmedThrough: w.through, current: true };
}

/** Who in a department hasn't confirmed or updated availability through its window. */
export async function availabilityStatus(tx: Tx, a: AuthContext, departmentId: string) {
  const departments = await schedulableDepartments(tx, a);
  const runDepartments = departmentId === ALL_DEPARTMENTS ? departments : departments.filter((d) => d.id === departmentId);
  if (!runDepartments.length) throw notFound('Department');
  const positionIds = [...new Set(runDepartments.flatMap((d) => d.positionIds))];
  const users = await tx.user.findMany({
    where: { status: 'ACTIVE', anonymizedAt: null, AND: [peopleWhere(a.scope), { positions: { some: { positionId: { in: positionIds } } } }] },
    select: { id: true, firstName: true, lastName: true },
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
  });
  const conf = await confirmedThrough(tx, users.map((u) => u.id));
  const facility = await tx.facility.findFirst({ select: { timezone: true }, orderBy: { name: 'asc' } });
  const weeks = Math.min(...runDepartments.map((d) => d.planAheadWeeks)) as HorizonWeeks;
  const through = addDays(localDate(new Date(), facility?.timezone ?? 'America/Toronto'), weeks * 7 - 1);
  return {
    planAheadWeeks: weeks,
    through,
    people: users.map((u) => ({ id: u.id, name: `${u.firstName} ${u.lastName}`, confirmedThrough: conf.get(u.id)?.through ?? null, current: (conf.get(u.id)?.through ?? '') >= through })),
  };
}

