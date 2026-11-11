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
import type { Prisma } from '@prisma/client';
import { DateTime } from 'luxon';
import type { AuthContext } from '../../auth/middleware.js';
import { type Tx, audit } from '../../lib/db.js';
import { badRequest, forbidden, notFound } from '../../lib/errors.js';
import { addDays, dayOfWeek, localDate, localIso, startOfLocalDay } from '../../lib/time.js';
import { resolveRules } from '../compliance/provincialRules.js';
import { buildSchoolCalendar } from '../compliance/schoolCalendar.js';
import { blockingItemsForPosition } from '../people/onboarding.js';
import { facilitiesOf, peopleWhere, shiftInScope, userInScope } from '../people/scope.js';
import { resolveFeatures } from '../platform/features.js';
import { tooLittleTravel } from './assistant.js';
import { type PositionSpec, evaluateCandidate, parseHoursOfService } from './eligibility.js';
import { evalOpts, loadAssistantCandidates, loadCandidate, loadShiftBundle } from './eligibilityLoader.js';
import { parsePolicy, periodStart } from './overtime.js';
import { type CoverageNeed, type SolverPerson, type SolverSlot, orderKey, solve } from './solver.js';
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
  /** Proposals from earlier weeks of this horizon (not yet accepted), carried forward. */
  carry: Array<{ shiftId: string; userId: string }>;
  toggles?: Partial<SolverToggles>;
  weights?: Partial<SolverWeights>;
  seed?: number;
}

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

  // Rules per facility and date, the school calendar and blocking onboarding: loaded once.
  const overrides = tenant.ruleOverrides.map((o) => ({ province: o.province, ruleKey: o.ruleKey, value: o.value, effectiveFrom: o.effectiveFrom.toISOString().slice(0, 10), effectiveTo: o.effectiveTo?.toISOString().slice(0, 10) ?? null }));
  const rulesCache = new Map<string, ReturnType<typeof resolveRules>>();
  const facilityById = new Map(facilities.map((f) => [f.id, f]));
  const rulesFor = (facilityId: string, date: string) => {
    const k = `${facilityId}|${date}`;
    if (!rulesCache.has(k)) rulesCache.set(k, resolveRules(facilityById.get(facilityId)!.province, date, overrides));
    return rulesCache.get(k)!;
  };
  const schoolCalendar = buildSchoolCalendar((await tx.schoolCalendarPeriod.findMany()).map((x) => ({ kind: x.kind, startsOn: x.startsOn.toISOString().slice(0, 10), endsOn: x.endsOn.toISOString().slice(0, 10) })));
  const positionSpecs = new Map<string, PositionSpec>();
  for (const s of inScope) {
    if (positionSpecs.has(s.positionId)) continue;
    const prerequisites = new Map<string, string[]>();
    for (const r of s.position.requirements) prerequisites.set(r.certificationId, r.certification.prerequisites.map((p) => p.requiresId));
    positionSpecs.set(s.positionId, {
      id: s.positionId,
      minimumAge: s.position.minimumAge,
      requiredCertIds: s.position.requirements.map((r) => r.certificationId),
      prerequisites,
      blockingOnboarding: await blockingItemsForPosition(tx, s.positionId),
      hoursOfService: parseHoursOfService(s.position.hoursOfService),
    });
  }

  // Beyond the availability planning window, a week is tentative.
  const today = localDate(new Date(), tz);
  const windowEnd = addDays(today, base.planAheadWeeks * 7);
  const slots: SolverSlot[] = inScope.map((s) => {
    const ftz = facilityById.get(s.facilityId)!.timezone;
    return {
      id: s.id,
      shift: { id: s.id, positionId: s.positionId, facilityId: s.facilityId, timezone: ftz, start: s.startsAt, end: s.endsAt },
      position: positionSpecs.get(s.positionId)!,
      rules: rulesFor(s.facilityId, localDate(s.startsAt, ftz)),
      schoolCalendar,
      currentUserId: s.userId,
      tentative: localDate(s.startsAt, ftz) > windowEnd,
    };
  });

  // People: anyone in scope who holds one of these positions.
  const candidates = await loadAssistantCandidates(tx, from, to, { AND: [peopleWhere(a.scope), { positions: { some: { positionId: { in: positionIds } } } }] });
  const userIds = candidates.map((c) => c.userId);
  const carryIds = req.carry.map((c) => c.shiftId);
  const [userRows, rates, ledger, confirmations, priorShifts, carried, positions] = await Promise.all([
    tx.user.findMany({ where: { id: { in: userIds } }, select: { id: true, firstName: true, lastName: true, positions: { select: { positionId: true, approvedAt: true } } } }),
    tx.payRate.findMany({ where: { userId: { in: userIds }, effectiveFrom: { lte: to }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: from } }] }, orderBy: { effectiveFrom: 'desc' } }),
    tx.overtimeEntry.findMany({ where: { userId: { in: userIds }, occurredAt: { gte: periodStart(new Date(), parsePolicy(tenant.overtimePolicy).periodStartMonth) } } }),
    confirmedThrough(tx, userIds),
    tx.shift.findMany({ where: { userId: { in: userIds }, status: { not: 'CANCELLED' }, startsAt: { gte: horizonFrom, lt: from } }, select: { userId: true, startsAt: true, endsAt: true } }),
    carryIds.length ? tx.shift.findMany({ where: { id: { in: carryIds }, status: 'DRAFT', startsAt: { lt: from } }, select: { id: true, startsAt: true, endsAt: true, positionId: true, facilityId: true } }) : Promise.resolve([]),
    tx.position.findMany({ select: { id: true, departmentId: true, department: { select: { name: true, nameFr: true } } } }),
  ]);
  const policy = parsePolicy(tenant.overtimePolicy);
  const deptOfPosition = new Map(positions.map((p) => [p.id, p]));
  const runDeptIds = new Set(runDepartments.map((d) => d.id));
  const carryById = new Map(carried.map((c) => [c.id, c]));

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
    const draftsHeld = slots.filter((s) => s.currentUserId === c.userId);
    const rateBy = new Map<string, number>();
    for (const r of rates.filter((x) => x.userId === c.userId)) if (!rateBy.has(r.positionId)) rateBy.set(r.positionId, Number(r.hourlyRate));
    const mineLedger = ledger.filter((e) => e.userId === c.userId);
    const charged = mineLedger.filter((e) => e.kind === 'ACCEPTED' || policy.countRefusals).reduce((s, e) => s + Number(e.hours), 0);
    const ftTarget = c.employmentStatus === 'FULL_TIME' ? base.targetHours : null;
    return {
      ...c,
      // A draft this run may change isn't "already working" for its current assignee.
      existingShifts: [...c.existingShifts.filter((s) => !draftsHeld.some((d) => d.shift.start.getTime() === s.start.getTime() && d.shift.end.getTime() === s.end.getTime() && d.shift.positionId === s.positionId)), ...mineCarried.map((s) => ({ start: s.startsAt, end: s.endsAt, positionId: s.positionId, facilityId: s.facilityId }))],
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
        weeks: req.weekIndex,
      },
      confirmedThrough: confirmations.get(c.userId)?.through ?? null,
    };
  });

  // Required coverage at these facilities, with what other people already cover.
  const rules = await tx.coverageRule.findMany({ where: { active: true, facilityId: { in: facilities.map((f) => f.id) } } });
  const coverage: CoverageNeed[] = [];
  for (const r of rules) {
    const ftz = facilityById.get(r.facilityId)!.timezone;
    const windows = [];
    for (let i = 0; i < 7; i++) {
      const d = addDays(req.weekStart, i);
      if (!r.daysOfWeek.includes(dayOfWeek(d))) continue;
      const day = DateTime.fromISO(d, { zone: ftz }).startOf('day');
      windows.push({ start: day.plus({ minutes: r.startMinute }).toJSDate(), end: day.plus({ minutes: r.endMinute }).toJSDate() });
    }
    if (!windows.length) continue;
    const others = await tx.shift.findMany({
      where: { facilityId: r.facilityId, status: { not: 'CANCELLED' }, userId: { notIn: userIds, not: null }, startsAt: { lt: to }, endsAt: { gt: from }, user: { certifications: { some: { certificationId: r.certificationId, verifiedAt: { not: null }, OR: [{ expiryDate: null }, { expiryDate: { gte: from } }] } } } },
      select: { startsAt: true, endsAt: true },
    });
    coverage.push({ id: r.id, name: r.name, facilityId: r.facilityId, certificationId: r.certificationId, minCount: r.minCount, windows, covered: others.map((s) => ({ start: s.startsAt, end: s.endsAt })) });
  }

  const budget = req.horizonWeeks <= 2 ? 3000 : req.horizonWeeks <= 4 ? 2000 : 1000;
  const seed = req.seed ?? orderKey(0, `${req.departmentId}|${req.weekStart}`) % 100_000;
  const result = solve({
    slots,
    people,
    coverage,
    options: {
      weights,
      useSeniority,
      avoidOvertime: toggles.avoidOvertime,
      payWeekStartDay: tenant.payWeekStartDay,
      travelMinutes: 30,
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
    after: { weekStart: req.weekStart, weekIndex: req.weekIndex, horizonWeeks: req.horizonWeeks, toggles, useSeniority, ...result.summary, coverageGaps: result.coverageGaps.length },
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
  const slotOut = inScope.map((s) => {
    const f = facilityById.get(s.facilityId)!;
    return {
      id: s.id,
      version: s.version,
      facilityId: s.facilityId,
      facilityName: f.name,
      positionId: s.positionId,
      position: { name: s.position.name, nameFr: s.position.nameFr },
      customTitle: s.customTitle,
      localStartsAt: localIso(s.startsAt, f.timezone),
      localEndsAt: localIso(s.endsAt, f.timezone),
      hours: (s.endsAt.getTime() - s.startsAt.getTime()) / H,
      currentUserId: s.userId,
      tentative: slots.find((x) => x.id === s.id)!.tentative ?? false,
    };
  });
  return {
    week: { start: req.weekStart, index: req.weekIndex, tentative: addDays(req.weekStart, 6) > windowEnd, beyondWindowFrom: windowEnd },
    settings: { useSeniority, toggles, planAheadWeeks: base.planAheadWeeks },
    summary: result.summary,
    proposals: result.proposals,
    unfilled: result.unfilled,
    coverageGaps: result.coverageGaps,
    slots: slotOut,
    people: peopleOut,
    /** Shifts of this week proposed, to send back as `carry` for the next week. */
    carry: result.proposals.map((p) => ({ shiftId: p.slotId, userId: p.userId })),
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

export interface AcceptItem { shiftId: string; userId: string; expectedVersion: number; previousUserId: string | null }

/**
 * Accepts proposals as DRAFT assignments. Each is re-checked now with the shared evaluator
 * (the world may have changed since the run), in order, so accepting a whole week can never
 * double-book anyone. Returns what was applied and what was skipped, with the audit id to undo.
 */
export async function acceptFill(tx: Tx, a: AuthContext, items: AcceptItem[], opts: { allowOvertime: boolean }) {
  const applied: Array<AcceptItem & { version: number }> = [];
  const skipped: Array<{ shiftId: string; code: string }> = [];
  for (const it of items) {
    const bundle = await loadShiftBundle(tx, it.shiftId);
    if (!bundle) {
      skipped.push({ shiftId: it.shiftId, code: 'NOT_FOUND' });
      continue;
    }
    if (!shiftInScope(a.scope, bundle.shift)) throw forbidden('This shift isn’t in your department.');
    if (bundle.shift.status !== 'DRAFT' || bundle.shift.version !== it.expectedVersion || bundle.shift.userId !== it.previousUserId) {
      skipped.push({ shiftId: it.shiftId, code: 'CHANGED' });
      continue;
    }
    if (!(await userInScope(tx, a.scope, it.userId))) throw forbidden('This person isn’t in your department.');
    const c = await loadCandidate(tx, bundle, it.userId);
    if (!c) {
      skipped.push({ shiftId: it.shiftId, code: 'NOT_FOUND' });
      continue;
    }
    const e = evaluateCandidate(c, bundle.shift, bundle.position, evalOpts(bundle, true));
    if (!e.eligible) {
      skipped.push({ shiftId: it.shiftId, code: e.blocks[0]!.code });
      continue;
    }
    if (e.overtimeHours.gt(0) && !opts.allowOvertime) {
      skipped.push({ shiftId: it.shiftId, code: 'OVERTIME' });
      continue;
    }
    if (tooLittleTravel(c, bundle.shift, 30 * 60_000)) {
      skipped.push({ shiftId: it.shiftId, code: 'TRAVEL' });
      continue;
    }
    const done = await tx.shift.updateMany({ where: { id: it.shiftId, version: it.expectedVersion, status: 'DRAFT', userId: it.previousUserId }, data: { userId: it.userId, version: { increment: 1 }, conflictReason: null } });
    if (!done.count) skipped.push({ shiftId: it.shiftId, code: 'CHANGED' });
    else applied.push({ ...it, version: it.expectedVersion + 1 });
  }
  let undoId: string | null = null;
  if (applied.length) {
    const row = await tx.auditLog.create({ data: { tenantId: a.tenantId, actorId: a.userId, action: 'schedule.fill.accept', entity: 'Shift', after: { applied, skipped } as unknown as Prisma.InputJsonValue } });
    undoId = row.id;
  }
  return { applied: applied.length, skipped, undoId };
}

/** Undoes an accept: each shift goes back to who had it, if no one has changed it since. */
export async function undoFill(tx: Tx, a: AuthContext, undoId: string) {
  const row = await tx.auditLog.findUnique({ where: { id: undoId } });
  if (!row || row.action !== 'schedule.fill.accept' || row.actorId !== a.userId) throw notFound('Accepted proposals');
  const done = await tx.auditLog.findFirst({ where: { action: 'schedule.fill.undo', entityId: undoId } });
  if (done) throw badRequest('These proposals were already undone.');
  const applied = ((row.after as { applied?: Array<AcceptItem & { version: number }> } | null)?.applied ?? []);
  let restored = 0;
  for (const x of applied) {
    const r = await tx.shift.updateMany({ where: { id: x.shiftId, version: x.version, status: 'DRAFT', userId: x.userId }, data: { userId: x.previousUserId, version: { increment: 1 } } });
    restored += r.count;
  }
  await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'schedule.fill.undo', entity: 'AuditLog', entityId: undoId, after: { restored, of: applied.length } });
  return { restored, of: applied.length };
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

