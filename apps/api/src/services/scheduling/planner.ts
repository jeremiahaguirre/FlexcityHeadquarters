/**
 * The schedule builder's manual planner: the board (people with availability and hours, shifts,
 * usual shift times), a batch eligibility check for drag and drop, and the writes a drop makes
 * (create with people, move/resize/reassign, copy a day or week, bulk assign, cancel for undo).
 *
 * Every status here comes from evaluateCandidate(), the check the Shift Board and the solver use;
 * the browser only colours what this returns, and every write re-checks through assignShift() /
 * updateShift(). Hard rules refuse; overtime needs the person's explicit confirmation; being
 * outside someone's submitted availability is a warning when scheduling by hand.
 *
 * Department scope works like Fill the schedule: one department's positions (or all the person
 * may schedule), people who hold one of them (people from other departments are marked), never
 * anyone outside the person's scope, and every other shift those people have in any department,
 * so no one is double-booked across departments.
 */
import type { Prisma } from '@prisma/client';
import { DateTime } from 'luxon';
import type { AuthContext } from '../../auth/middleware.js';
import { type Tx, audit } from '../../lib/db.js';
import type { DomainEvent } from '../../lib/events.js';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors.js';
import { addDays, dayOfWeek, localDate, localIso, overlaps, startOfLocalDay } from '../../lib/time.js';
import { resolveRules } from '../compliance/provincialRules.js';
import { buildSchoolCalendar } from '../compliance/schoolCalendar.js';
import { blockingItemsForPosition } from '../people/onboarding.js';
import { facilitiesOf, peopleWhere, shiftInScope, shiftsWhere, userInScope } from '../people/scope.js';
import { resolveFeatures } from '../platform/features.js';
import { type CandidateContext, type Evaluation, type PositionSpec, type ShiftSpec, evaluateCandidate, isAvailable, parseHoursOfService } from './eligibility.js';
import { evalOpts, loadAssistantCandidates, loadCandidate, loadShiftBundle } from './eligibilityLoader.js';
import { ALL_DEPARTMENTS, NO_DEPARTMENT, confirmedThrough, schedulableDepartments } from './fillRun.js';
import { assignShift, cancelShift, createShift, updateShift } from './shifts.js';
import { effectiveSettings, parseSolverSettings } from './solverSettings.js';

const H = 3_600_000;
export const MAX_PLANNER_DAYS = 42;

export interface PlannerRange {
  departmentId: string;
  /** Local ISO dates; `to` is exclusive. */
  from: string;
  to: string;
  facilityIds?: string[];
}

async function plannerContext(tx: Tx, a: AuthContext, q: PlannerRange) {
  if (q.to <= q.from) throw badRequest('The range must end after it starts.');
  const days = Math.round((Date.parse(`${q.to}T12:00:00Z`) - Date.parse(`${q.from}T12:00:00Z`)) / 86_400_000);
  if (days > MAX_PLANNER_DAYS) throw badRequest(`Choose a range of up to ${MAX_PLANNER_DAYS} days.`);
  const departments = await schedulableDepartments(tx, a);
  const run = q.departmentId === ALL_DEPARTMENTS ? departments : departments.filter((d) => d.id === q.departmentId);
  if (!run.length) throw notFound('Department');
  const positionIds = [...new Set(run.flatMap((d) => d.positionIds))];
  const allowed = facilitiesOf(a.scope);
  const facilities = await tx.facility.findMany({
    where: { AND: [q.facilityIds?.length ? { id: { in: q.facilityIds } } : {}, allowed ? { id: { in: allowed } } : {}] },
    select: { id: true, name: true, timezone: true, province: true },
    orderBy: { name: 'asc' },
  });
  if (q.facilityIds?.length && facilities.length !== new Set(q.facilityIds).size) throw notFound('Facility');
  if (!facilities.length) throw notFound('Facility');
  const tz = facilities[0]!.timezone;
  const dates = Array.from({ length: days }, (_, i) => addDays(q.from, i));
  return { run, positionIds, facilities, tz, dates, fromI: startOfLocalDay(q.from, tz), toI: startOfLocalDay(q.to, tz) };
}

const peopleFilter = (a: AuthContext, positionIds: string[]): Prisma.UserWhereInput => ({ AND: [peopleWhere(a.scope), { positions: { some: { positionId: { in: positionIds } } } }] });

const hhmm = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const minutesOf = (d: Date, tz: string) => {
  const x = DateTime.fromJSDate(d, { zone: tz });
  return x.hour * 60 + x.minute;
};

/** Windows of one day in minutes after local midnight, from weekly availability. */
function availabilityOn(rows: CandidateContext['availability'], date: string): Array<[number, number]> {
  const dow = dayOfWeek(date);
  return rows
    .filter((w) => w.dayOfWeek === dow && w.effectiveFrom <= date && (w.effectiveTo === null || w.effectiveTo >= date))
    .map((w) => [w.startMinute, Math.min(w.endMinute, 1440)] as [number, number])
    .sort((x, y) => x[0] - y[0]);
}

/** Pieces of intervals falling on one local day, in minutes. */
function piecesOn(intervals: Array<{ start: Date; end: Date }>, date: string, tz: string): Array<[number, number]> {
  const ds = startOfLocalDay(date, tz).getTime();
  const de = startOfLocalDay(addDays(date, 1), tz).getTime();
  return intervals
    .filter((i) => i.start.getTime() < de && i.end.getTime() > ds)
    .map((i) => [Math.round((Math.max(i.start.getTime(), ds) - ds) / 60_000), Math.round((Math.min(i.end.getTime(), de) - ds) / 60_000)] as [number, number]);
}

/** The most common start–end times per position, for prefilling a new shift. */
function usualTimes(rows: Array<{ positionId: string; startsAt: Date; endsAt: Date }>, tz: string) {
  const counts = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const k = `${hhmm(minutesOf(r.startsAt, tz))}-${hhmm(minutesOf(r.endsAt, tz))}`;
    const m = counts.get(r.positionId) ?? new Map<string, number>();
    m.set(k, (m.get(k) ?? 0) + 1);
    counts.set(r.positionId, m);
  }
  const out: Record<string, Array<{ start: string; end: string; count: number }>> = {};
  for (const [p, m] of counts) {
    out[p] = [...m]
      .sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))
      .slice(0, 3)
      .map(([k, count]) => ({ start: k.slice(0, 5), end: k.slice(6), count }));
  }
  return out;
}

const shiftSelect = {
  facility: { select: { id: true, name: true, timezone: true } },
  position: { select: { id: true, name: true, nameFr: true } },
  user: { select: { id: true, firstName: true, lastName: true } },
} as const;

type BoardShift = Prisma.ShiftGetPayload<{ include: typeof shiftSelect }>;
export function plannerShiftView(s: BoardShift) {
  return {
    id: s.id,
    facilityId: s.facilityId,
    positionId: s.positionId,
    userId: s.userId,
    localStartsAt: localIso(s.startsAt, s.facility.timezone),
    localEndsAt: localIso(s.endsAt, s.facility.timezone),
    status: s.status,
    shiftType: s.shiftType,
    customTitle: s.customTitle,
    conflictReason: s.conflictReason,
    version: s.version,
    hours: (s.endsAt.getTime() - s.startsAt.getTime()) / H,
    facility: { id: s.facility.id, name: s.facility.name, timezone: s.facility.timezone },
    position: { id: s.position.id, name: s.position.name, nameFr: s.position.nameFr },
    assignee: s.user ? { id: s.user.id, name: `${s.user.firstName} ${s.user.lastName}` } : null,
  };
}

/** Everything the planner draws: people (availability, time off, hours), shifts and usual times. */
export async function plannerBoard(tx: Tx, a: AuthContext, q: PlannerRange) {
  const c = await plannerContext(tx, a, q);
  const { tz, fromI, toI, positionIds } = c;
  const facilityIds = c.facilities.map((f) => f.id);
  const tenant = await tx.tenant.findFirstOrThrow({ select: { overtimePolicy: true, features: true } });
  const stored = parseSolverSettings(tenant.overtimePolicy);
  const deptForSettings = c.run.length === 1 && c.run[0]!.id !== NO_DEPARTMENT ? c.run[0]!.id : null;
  const settings = effectiveSettings(stored, deptForSettings, resolveFeatures(tenant.features).seniority);
  const [positions, shifts, users, history, allPositions] = await Promise.all([
    tx.position.findMany({ where: { id: { in: positionIds } }, select: { id: true, name: true, nameFr: true }, orderBy: { name: 'asc' } }),
    tx.shift.findMany({
      where: { AND: [shiftsWhere(a.scope), { status: { not: 'CANCELLED' }, positionId: { in: positionIds }, facilityId: { in: facilityIds }, startsAt: { gte: fromI, lt: toI } }] },
      include: shiftSelect,
      orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
    }),
    tx.user.findMany({
      where: { status: 'ACTIVE', anonymizedAt: null, processingRestrictedAt: null, ...peopleFilter(a, positionIds) },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        employmentStatus: true,
        weeklyMinHours: true,
        positions: { select: { positionId: true, approvedAt: true } },
        certifications: { where: { verifiedAt: { not: null }, OR: [{ expiryDate: null }, { expiryDate: { gte: fromI } }] }, select: { certification: { select: { id: true, name: true, nameFr: true } } } },
        availability: true,
        timeOffRequests: { where: { status: 'APPROVED', startsAt: { lt: toI }, endsAt: { gt: fromI } }, select: { startsAt: true, endsAt: true, type: true } },
        shifts: { where: { status: { not: 'CANCELLED' }, startsAt: { lt: toI }, endsAt: { gt: fromI } }, select: { startsAt: true, endsAt: true } },
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    }),
    tx.shift.findMany({ where: { status: { not: 'CANCELLED' }, positionId: { in: positionIds }, facilityId: { in: facilityIds }, startsAt: { gte: new Date(fromI.getTime() - 28 * 86_400_000), lt: toI } }, select: { positionId: true, startsAt: true, endsAt: true } }),
    tx.position.findMany({ select: { id: true, departmentId: true, department: { select: { name: true, nameFr: true } } } }),
  ]);
  const conf = await confirmedThrough(tx, users.map((u) => u.id));
  const today = localDate(new Date(), tz);
  const planAhead = Math.min(...c.run.map((d) => d.planAheadWeeks));
  const through = addDays(today, planAhead * 7 - 1);
  const runIds = new Set(c.run.map((d) => d.id));
  const deptOf = new Map(allPositions.map((p) => [p.id, p]));
  const periodWeeks = c.dates.length / 7;

  const people = users.map((u) => {
    const primary = [...u.positions].sort((x, y) => x.approvedAt.getTime() - y.approvedAt.getTime())[0];
    const home = primary ? deptOf.get(primary.positionId) : undefined;
    const homeId = home?.departmentId ?? NO_DEPARTMENT;
    const avail = u.availability.map((w) => ({ dayOfWeek: w.dayOfWeek, startMinute: w.startMinute, endMinute: w.endMinute, effectiveFrom: w.effectiveFrom.toISOString().slice(0, 10), effectiveTo: w.effectiveTo?.toISOString().slice(0, 10) ?? null }));
    const availability: Record<string, Array<[number, number]>> = {};
    const timeOff: Record<string, Array<[number, number]>> = {};
    for (const d of c.dates) {
      const w = availabilityOn(avail, d);
      if (w.length) availability[d] = w;
      const off = piecesOn(u.timeOffRequests.map((r) => ({ start: r.startsAt, end: r.endsAt })), d, tz);
      if (off.length) timeOff[d] = off;
    }
    const scheduled = u.shifts.reduce((s, x) => s + (Math.min(x.endsAt.getTime(), toI.getTime()) - Math.max(x.startsAt.getTime(), fromI.getTime())) / H, 0);
    const weekly = u.weeklyMinHours ? Number(u.weeklyMinHours) : u.employmentStatus === 'FULL_TIME' ? settings.targetHours : null;
    const confirmed = conf.get(u.id)?.through ?? null;
    return {
      id: u.id,
      name: `${u.firstName} ${u.lastName}`,
      initials: `${u.firstName.slice(0, 1)}${u.lastName.slice(0, 1)}`.toUpperCase(),
      employmentStatus: u.employmentStatus,
      positionIds: u.positions.map((p) => p.positionId).filter((p) => positionIds.includes(p)),
      primaryPositionId: primary?.positionId ?? null,
      certifications: u.certifications.map((x) => x.certification),
      fromDepartment: home?.department && !runIds.has(homeId) ? { name: home.department.name, nameFr: home.department.nameFr } : null,
      scheduledHours: Math.round(scheduled * 100) / 100,
      targetHours: weekly === null ? null : Math.round(weekly * periodWeeks * 100) / 100,
      availability,
      timeOff,
      hasAvailability: avail.length > 0,
      confirmedThrough: confirmed,
      availabilityCurrent: !!confirmed && confirmed >= through,
    };
  });

  return {
    range: { from: q.from, to: q.to, timezone: tz, today },
    planAheadThrough: through,
    departments: c.run.map((d) => ({ id: d.id, name: d.name, nameFr: d.nameFr })),
    positions,
    facilities: c.facilities.map((f) => ({ id: f.id, name: f.name, timezone: f.timezone })),
    people,
    shifts: shifts.map(plannerShiftView),
    usual: usualTimes(history, tz),
  };
}

// ------------------------------------------------------------------ Batch eligibility

export interface CellReason { code: string; n?: number[]; at?: string; cert?: string }
export type Status = 'ok' | 'warn' | 'block';
export interface Cells { ok: number[]; warn: Array<[number, CellReason[]]>; block: Array<[number, CellReason[]]> }

/** Flags that don't change what a scheduler should do (shown elsewhere). */
const QUIET_FLAGS = new Set(['RULES_UNVERIFIED']);

/** Numbers in the evaluator's message (hours, limits), for the translated text. */
const numbersIn = (message: string) => [...message.matchAll(/\d+(?:\.\d+)?/g)].map((m) => Number(m[0])).filter((n) => n < 10_000);

/**
 * Maps one evaluation to a cell status. Blocks are refusals; overtime, flags and being outside
 * submitted availability are warnings (assignShift asks to confirm overtime and allows the rest).
 */
export function statusOf(e: Evaluation, ctx: Pick<CandidateContext, 'existingShifts' | 'availability'>, shift: ShiftSpec, certNames: ReadonlyMap<string, string>): { status: Status; reasons: CellReason[] } {
  const tz = shift.timezone;
  const reason = (r: { code: string; message: string }): CellReason => {
    if (r.code === 'OVERLAPPING_SHIFT') {
      const other = ctx.existingShifts.find((s) => overlaps(s, shift));
      return other ? { code: r.code, at: `${hhmm(minutesOf(other.start, tz))}-${hhmm(minutesOf(other.end, tz))}` } : { code: r.code };
    }
    if (r.code === 'MISSING_CERTIFICATION' || r.code === 'CERTIFICATION_EXPIRES') {
      const id = [...certNames.keys()].find((k) => r.message.includes(k));
      return id ? { code: r.code, cert: certNames.get(id)! } : { code: r.code };
    }
    if (r.code === 'OVERTIME') return { code: r.code, n: [Number(e.overtimeHours.toFixed(2))] };
    const n = numbersIn(r.message);
    return n.length ? { code: r.code, n } : { code: r.code };
  };
  if (!e.eligible) return { status: 'block', reasons: e.blocks.map(reason) };
  const warn: CellReason[] = e.flags.filter((f) => !QUIET_FLAGS.has(f.code)).map(reason);
  if (!isAvailable(ctx.availability, shift)) warn.push({ code: 'NOT_AVAILABLE' });
  return warn.length ? { status: 'warn', reasons: warn } : { status: 'ok', reasons: [] };
}

async function ruleInputs(tx: Tx, facilities: Array<{ id: string; province: string; timezone: string }>) {
  const tenant = await tx.tenant.findFirstOrThrow({ include: { ruleOverrides: true } });
  const overrides = tenant.ruleOverrides.map((o) => ({ province: o.province, ruleKey: o.ruleKey, value: o.value, effectiveFrom: o.effectiveFrom.toISOString().slice(0, 10), effectiveTo: o.effectiveTo?.toISOString().slice(0, 10) ?? null }));
  const byId = new Map(facilities.map((f) => [f.id, f]));
  const cache = new Map<string, ReturnType<typeof resolveRules>>();
  const rulesFor = (facilityId: string, date: string) => {
    const k = `${facilityId}|${date}`;
    if (!cache.has(k)) cache.set(k, resolveRules(byId.get(facilityId)!.province as Parameters<typeof resolveRules>[0], date, overrides));
    return cache.get(k)!;
  };
  const schoolCalendar = buildSchoolCalendar((await tx.schoolCalendarPeriod.findMany()).map((x) => ({ kind: x.kind, startsOn: x.startsOn.toISOString().slice(0, 10), endsOn: x.endsOn.toISOString().slice(0, 10) })));
  return { rulesFor, schoolCalendar, payWeekStartDay: tenant.payWeekStartDay };
}

async function positionSpecs(tx: Tx, positionIds: string[]) {
  const rows = await tx.position.findMany({ where: { id: { in: positionIds } }, include: { requirements: { include: { certification: { include: { prerequisites: true } } } } } });
  const specs = new Map<string, PositionSpec>();
  const certNames = new Map<string, string>();
  for (const p of rows) {
    const prerequisites = new Map<string, string[]>();
    for (const r of p.requirements) {
      prerequisites.set(r.certificationId, r.certification.prerequisites.map((x) => x.requiresId));
      certNames.set(r.certificationId, r.certification.name);
    }
    specs.set(p.id, {
      id: p.id,
      minimumAge: p.minimumAge,
      requiredCertIds: p.requirements.map((r) => r.certificationId),
      prerequisites,
      blockingOnboarding: await blockingItemsForPosition(tx, p.id),
      hoursOfService: parseHoursOfService(p.hoursOfService),
    });
  }
  return { specs, certNames };
}

export interface EligibilityQuery extends PlannerRange {
  userIds?: string[];
  shiftIds?: string[];
  /** Also check a typical new shift per person and day (for drops on empty days). */
  days?: boolean;
}

/**
 * Status per person × shift (and per person × day) for the visible period. Only people who hold
 * a shift's position are evaluated; anyone missing from a shift's cells isn't approved for it.
 * Identical shifts (same place, position and times) are evaluated once per person.
 */
export async function plannerEligibility(tx: Tx, a: AuthContext, q: EligibilityQuery) {
  const started = Date.now();
  const c = await plannerContext(tx, a, q);
  const { tz, fromI, toI, positionIds } = c;
  const facilityIds = c.facilities.map((f) => f.id);
  const [people, shifts, { specs, certNames }, rules, usualRows] = await Promise.all([
    loadAssistantCandidates(tx, fromI, toI, { ...peopleFilter(a, positionIds), ...(q.userIds ? { id: { in: q.userIds } } : {}) }),
    tx.shift.findMany({
      where: { AND: [shiftsWhere(a.scope), { status: { not: 'CANCELLED' }, positionId: { in: positionIds }, facilityId: { in: facilityIds }, startsAt: { gte: fromI, lt: toI }, ...(q.shiftIds ? { id: { in: q.shiftIds } } : {}) }] },
      select: { id: true, facilityId: true, positionId: true, startsAt: true, endsAt: true, userId: true },
      orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
    }),
    positionSpecs(tx, positionIds),
    ruleInputs(tx, c.facilities),
    q.days ? tx.shift.findMany({ where: { status: { not: 'CANCELLED' }, positionId: { in: positionIds }, facilityId: { in: facilityIds }, startsAt: { gte: new Date(fromI.getTime() - 28 * 86_400_000), lt: toI } }, select: { positionId: true, startsAt: true, endsAt: true } }) : Promise.resolve([]),
  ]);
  const tzOf = new Map(c.facilities.map((f) => [f.id, f.timezone]));
  const users = people.map((p) => p.userId);
  const empty = (): Cells => ({ ok: [], warn: [], block: [] });
  const put = (cells: Cells, i: number, r: { status: Status; reasons: CellReason[] }) => {
    if (r.status === 'ok') cells.ok.push(i);
    else cells[r.status].push([i, r.reasons]);
  };
  const evaluate = (p: (typeof people)[number], shift: ShiftSpec, ownShiftId: string | null) => {
    const ctx = ownShiftId ? { ...p, existingShifts: p.existingShifts.filter((s) => s.id !== ownShiftId) } : p;
    const date = localDate(shift.start, shift.timezone);
    const e = evaluateCandidate(ctx, shift, specs.get(shift.positionId)!, { rules: rules.rulesFor(shift.facilityId!, date), payWeekStartDay: rules.payWeekStartDay, requireAvailability: false, schoolCalendar: rules.schoolCalendar });
    return statusOf(e, ctx, shift, certNames);
  };

  let evaluations = 0;
  const shiftCells: Record<string, Cells> = {};
  const memo = new Map<string, { status: Status; reasons: CellReason[] }>();
  for (const s of shifts) {
    const cells = empty();
    const spec: ShiftSpec = { id: s.id, positionId: s.positionId, facilityId: s.facilityId, timezone: tzOf.get(s.facilityId)!, start: s.startsAt, end: s.endsAt };
    people.forEach((p, i) => {
      if (!p.qualifiedPositionIds.has(s.positionId)) return;
      const own = s.userId === p.userId;
      const k = `${i}|${s.facilityId}|${s.positionId}|${s.startsAt.getTime()}|${s.endsAt.getTime()}|${own ? s.id : ''}`;
      let r = memo.get(k);
      if (!r) {
        r = evaluate(p, spec, own ? s.id : null);
        evaluations++;
        memo.set(k, r);
      }
      put(cells, i, r);
    });
    shiftCells[s.id] = cells;
  }

  // A typical new shift per person and day: their usual time if it fits their availability.
  const dayCells: Record<string, Cells> = {};
  if (q.days) {
    const usual = usualTimes(usualRows, tz);
    const facilityId = facilityIds[0]!;
    for (const d of c.dates) {
      const cells = empty();
      people.forEach((p, i) => {
        const positionId = positionIds.find((x) => p.qualifiedPositionIds.has(x)) ?? null;
        if (!positionId) return;
        const window = availabilityOn(p.availability, d).sort((x, y) => y[1] - y[0] - (x[1] - x[0]))[0];
        const candidates = (usual[positionId] ?? []).map((u) => [toMin(u.start), toMin(u.end) <= toMin(u.start) ? toMin(u.end) + 1440 : toMin(u.end)] as [number, number]);
        let span = candidates.find(([st, en]) => window && st >= window[0] && en <= window[1]) ?? candidates[0] ?? [9 * 60, 17 * 60];
        if (window && !(span[0] >= window[0] && span[1] <= window[1]) && window[1] - window[0] >= 120 && window[1] - window[0] <= 12 * 60) span = window;
        const base = DateTime.fromISO(d, { zone: tz }).startOf('day');
        const spec: ShiftSpec = { id: `day:${d}`, positionId, facilityId, timezone: tz, start: base.plus({ minutes: span[0] }).toJSDate(), end: base.plus({ minutes: span[1] }).toJSDate() };
        put(cells, i, evaluate(p, spec, null));
        evaluations++;
      });
      dayCells[d] = cells;
    }
  }
  return { users, shifts: shiftCells, days: dayCells, evaluations, ms: Date.now() - started };
}

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

// ------------------------------------------------------------------ Writes

async function assertShiftWritable(tx: Tx, a: AuthContext, shiftId: string) {
  const s = await tx.shift.findUnique({ where: { id: shiftId }, select: { id: true, positionId: true, facilityId: true, status: true, userId: true, version: true, startsAt: true, endsAt: true, shiftType: true, customTitle: true, premiumPerHour: true } });
  if (!s) throw notFound('Shift');
  if (!shiftInScope(a.scope, s)) throw forbidden('This shift isn’t in your department.');
  return s;
}

async function assertPeopleInScope(tx: Tx, a: AuthContext, userIds: string[]) {
  for (const id of new Set(userIds)) if (!(await userInScope(tx, a.scope, id))) throw forbidden('This person isn’t in your department.');
}

export interface CreateInput {
  facilityId: string;
  positionId: string;
  startsAt: Date;
  endsAt: Date;
  shiftType?: 'STANDARD' | 'CUSTOM' | 'MANDATORY';
  customTitle?: string | null;
  /** One draft per person (or one open draft when empty). */
  userIds: string[];
  acknowledgeOvertime: boolean;
}

/** New draft shift(s) from a drop: all or nothing, each person re-checked on the way in. */
export async function plannerCreate(tx: Tx, a: AuthContext, input: CreateInput) {
  if (!shiftInScope(a.scope, input)) throw forbidden('This shift isn’t in your department.');
  await assertPeopleInScope(tx, a, input.userIds);
  const actor = { userId: a.userId, tenantId: a.tenantId };
  const events: DomainEvent[] = [];
  const ids: string[] = [];
  for (const userId of input.userIds.length ? input.userIds : [null]) {
    const s = await createShift(tx, actor, input);
    if (userId) {
      const r = await assignShift(tx, actor, s.id, userId, s.version, input.acknowledgeOvertime);
      events.push(...r.events);
    }
    ids.push(s.id);
  }
  return { ids, events };
}

export interface MoveInput {
  expectedVersion: number;
  startsAt?: Date;
  endsAt?: Date;
  positionId?: string;
  facilityId?: string;
  /** undefined keeps the assignee, null leaves it open, an id reassigns. */
  userId?: string | null;
  /** Leave the original where it is and make a draft copy at the new place. */
  copy: boolean;
  acknowledgeOvertime: boolean;
}

/**
 * Move, resize, reassign or copy one shift. Moving re-checks the person on it (hard rules refuse;
 * new overtime needs confirming); reassigning goes through assignShift. All or nothing.
 */
export async function plannerMove(tx: Tx, a: AuthContext, shiftId: string, m: MoveInput) {
  const s = await assertShiftWritable(tx, a, shiftId);
  if (s.status === 'CANCELLED') throw conflict('SHIFT_CANCELLED', 'This shift was cancelled.');
  if (s.version !== m.expectedVersion) throw conflict('SHIFT_CHANGED', 'Someone else changed this shift. Refresh and try again.');
  const target = { facilityId: m.facilityId ?? s.facilityId, positionId: m.positionId ?? s.positionId };
  if (!shiftInScope(a.scope, target)) throw forbidden('This shift isn’t in your department.');
  const userId = m.userId === undefined ? s.userId : m.userId;
  if (userId && userId !== s.userId) await assertPeopleInScope(tx, a, [userId]);
  const actor = { userId: a.userId, tenantId: a.tenantId };
  const startsAt = m.startsAt ?? s.startsAt;
  const endsAt = m.endsAt ?? s.endsAt;

  if (m.copy) {
    const r = await plannerCreate(tx, a, { ...target, startsAt, endsAt, shiftType: s.shiftType, customTitle: s.customTitle, userIds: userId ? [userId] : [], acknowledgeOvertime: m.acknowledgeOvertime });
    return { id: r.ids[0]!, created: true, events: r.events };
  }

  const events: DomainEvent[] = [];
  const reassigning = userId !== s.userId;
  let version = s.version;
  if (reassigning && s.userId) {
    const r = await assignShift(tx, actor, shiftId, null, version);
    events.push(...r.events);
    version = r.shift.version;
  }
  const changes = startsAt.getTime() !== s.startsAt.getTime() || endsAt.getTime() !== s.endsAt.getTime() || target.positionId !== s.positionId || target.facilityId !== s.facilityId;
  if (changes) {
    const r = await updateShift(tx, actor, shiftId, version, { startsAt, endsAt, positionId: target.positionId, facilityId: target.facilityId });
    events.push(...r.events);
    version = r.shift.version;
    // Same person, new time: new overtime needs the same confirmation as an assignment.
    if (!reassigning && userId) {
      const bundle = (await loadShiftBundle(tx, shiftId))!;
      const cand = await loadCandidate(tx, bundle, userId);
      const e = cand && evaluateCandidate(cand, bundle.shift, bundle.position, evalOpts(bundle));
      if (e && e.overtimeHours.gt(0) && !m.acknowledgeOvertime) throw conflict('OVERTIME_REQUIRES_ACK', `This adds ${e.overtimeHours.toFixed(2)} h of overtime. Confirm to move anyway.`, { overtimeHours: e.overtimeHours.toFixed(2), skipped: [], clause: null });
    }
  }
  if (reassigning && userId) {
    const r = await assignShift(tx, actor, shiftId, userId, version, m.acknowledgeOvertime);
    events.push(...r.events);
  }
  return { id: shiftId, created: false, events };
}

/** Several people onto one shift: the shift itself (if open) and a same-time draft for each other person. */
export async function plannerAssignMany(tx: Tx, a: AuthContext, shiftId: string, expectedVersion: number, userIds: string[], acknowledgeOvertime: boolean) {
  const s = await assertShiftWritable(tx, a, shiftId);
  if (s.status === 'CANCELLED') throw conflict('SHIFT_CANCELLED', 'This shift was cancelled.');
  if (s.version !== expectedVersion) throw conflict('SHIFT_CHANGED', 'Someone else changed this shift. Refresh and try again.');
  await assertPeopleInScope(tx, a, userIds);
  const bundle = (await loadShiftBundle(tx, shiftId))!;
  const actor = { userId: a.userId, tenantId: a.tenantId };
  const results: Array<{ userId: string; shiftId: string | null; code: string | null }> = [];
  const events: DomainEvent[] = [];
  let openHere = !s.userId;
  for (const userId of [...new Set(userIds)]) {
    if (userId === s.userId) {
      results.push({ userId, shiftId, code: null });
      continue;
    }
    const cand = await loadCandidate(tx, bundle, userId);
    if (!cand) {
      results.push({ userId, shiftId: null, code: 'NOT_FOUND' });
      continue;
    }
    // Check against the shift's time; earlier people in this batch are already in the database.
    const e = evaluateCandidate(cand, bundle.shift, bundle.position, evalOpts(bundle));
    if (!e.eligible) {
      results.push({ userId, shiftId: null, code: e.blocks[0]!.code });
      continue;
    }
    if (e.overtimeHours.gt(0) && !acknowledgeOvertime) {
      results.push({ userId, shiftId: null, code: 'OVERTIME' });
      continue;
    }
    if (openHere) {
      const cur = await tx.shift.findUniqueOrThrow({ where: { id: shiftId }, select: { version: true } });
      const r = await assignShift(tx, actor, shiftId, userId, cur.version, acknowledgeOvertime);
      events.push(...r.events);
      results.push({ userId, shiftId, code: null });
      openHere = false;
    } else {
      const r = await plannerCreate(tx, a, { facilityId: s.facilityId, positionId: s.positionId, startsAt: s.startsAt, endsAt: s.endsAt, shiftType: s.shiftType, customTitle: s.customTitle, userIds: [userId], acknowledgeOvertime });
      events.push(...r.events);
      results.push({ userId, shiftId: r.ids[0]!, code: null });
    }
  }
  return { results, events };
}

export interface CopyInput {
  departmentId: string;
  facilityIds?: string[];
  /** Local ISO dates: copy `days` days starting `from` to start on `to`. */
  from: string;
  to: string;
  days: 1 | 7;
  withPeople: boolean;
}

/**
 * Copies a day or a week of a department's shifts as drafts, keeping wall-clock times. With
 * people, each person is re-checked in order and kept only when they can work it without
 * overtime; otherwise the copy is left open and the reason is returned. Shifts already in the
 * target (same place, position, times) aren't copied twice.
 */
export async function plannerCopy(tx: Tx, a: AuthContext, q: CopyInput) {
  if (q.from === q.to) throw badRequest('Choose a different day to copy to.');
  const c = await plannerContext(tx, a, { departmentId: q.departmentId, facilityIds: q.facilityIds, from: q.from, to: addDays(q.from, q.days) });
  const offset = Math.round((Date.parse(`${q.to}T12:00:00Z`) - Date.parse(`${q.from}T12:00:00Z`)) / 86_400_000);
  const facilityIds = c.facilities.map((f) => f.id);
  const tzOf = new Map(c.facilities.map((f) => [f.id, f.timezone]));
  const source = await tx.shift.findMany({
    where: { AND: [shiftsWhere(a.scope), { status: { not: 'CANCELLED' }, positionId: { in: c.positionIds }, facilityId: { in: facilityIds }, startsAt: { gte: c.fromI, lt: c.toI } }] },
    orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
  });
  const targetFrom = startOfLocalDay(q.to, c.tz);
  const targetTo = startOfLocalDay(addDays(q.to, q.days), c.tz);
  const existing = await tx.shift.findMany({ where: { status: { not: 'CANCELLED' }, positionId: { in: c.positionIds }, facilityId: { in: facilityIds }, startsAt: { gte: targetFrom, lt: targetTo } }, select: { facilityId: true, positionId: true, startsAt: true, endsAt: true } });
  const taken = new Map<string, number>();
  for (const e of existing) {
    const k = `${e.facilityId}|${e.positionId}|${e.startsAt.getTime()}|${e.endsAt.getTime()}`;
    taken.set(k, (taken.get(k) ?? 0) + 1);
  }
  const actor = { userId: a.userId, tenantId: a.tenantId };
  const created: string[] = [];
  const leftOpen: Array<{ shiftId: string; userId: string; code: string }> = [];
  let assigned = 0;
  let skippedExisting = 0;
  for (const s of source) {
    const tz = tzOf.get(s.facilityId)!;
    const startsAt = DateTime.fromJSDate(s.startsAt, { zone: tz }).plus({ days: offset }).toJSDate();
    const endsAt = DateTime.fromJSDate(s.endsAt, { zone: tz }).plus({ days: offset }).toJSDate();
    const k = `${s.facilityId}|${s.positionId}|${startsAt.getTime()}|${endsAt.getTime()}`;
    if ((taken.get(k) ?? 0) > 0) {
      taken.set(k, taken.get(k)! - 1);
      skippedExisting++;
      continue;
    }
    const n = await createShift(tx, actor, { facilityId: s.facilityId, positionId: s.positionId, startsAt, endsAt, shiftType: s.shiftType, customTitle: s.customTitle, premiumPerHour: s.premiumPerHour?.toString() ?? null });
    created.push(n.id);
    if (!q.withPeople || !s.userId) continue;
    const bundle = (await loadShiftBundle(tx, n.id))!;
    const cand = (await userInScope(tx, a.scope, s.userId)) ? await loadCandidate(tx, bundle, s.userId) : null;
    const e = cand && evaluateCandidate(cand, bundle.shift, bundle.position, evalOpts(bundle));
    const code = !e ? 'NOT_FOUND' : !e.eligible ? e.blocks[0]!.code : e.overtimeHours.gt(0) ? 'OVERTIME' : null;
    if (code) {
      leftOpen.push({ shiftId: n.id, userId: s.userId, code });
      continue;
    }
    await assignShift(tx, actor, n.id, s.userId, n.version);
    assigned++;
  }
  await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'schedule.copy', entity: 'Department', entityId: q.departmentId, after: { from: q.from, to: q.to, days: q.days, withPeople: q.withPeople, created: created.length, assigned, leftOpen: leftOpen.length, skippedExisting } });
  return { created, assigned, leftOpen, skippedExisting };
}

/** Cancels drafts made in this session (undo). Published shifts are left alone and reported. */
export async function plannerCancel(tx: Tx, a: AuthContext, shiftIds: string[]) {
  const actor = { userId: a.userId, tenantId: a.tenantId };
  let cancelled = 0;
  const kept: string[] = [];
  for (const id of shiftIds) {
    const s = await assertShiftWritable(tx, a, id);
    if (s.status === 'CANCELLED') continue;
    if (s.status !== 'DRAFT') {
      kept.push(id);
      continue;
    }
    await cancelShift(tx, actor, id, 'Undone in the schedule builder');
    cancelled++;
  }
  return { cancelled, kept };
}

