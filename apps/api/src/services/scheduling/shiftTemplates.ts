/**
 * Weekly shift templates: a department's standard week ("Summer", "School year"), each line a set of
 * weekdays, a start and end, a position at a facility and how many people. "Apply" turns a template
 * into DRAFT shifts for a week or a range of weeks; nothing is ever published by it, and Fill the
 * schedule, the planner or a bid round then fills the drafts.
 *
 *  - wall-clock times on every date (DST-correct: 07:00–15:00 is 07:00–15:00 on a changeover day);
 *  - idempotent: an occurrence already made by the same template line (not cancelled) counts against
 *    its headcount, so applying twice makes nothing new, and applying a longer range only adds the
 *    missing days;
 *  - statutory holidays: facilities the organization closes on them (Fill settings) get nothing that
 *    day (HOLIDAY_CLOSED); at other facilities the draft is made and flagged (STAT_HOLIDAY, paid at the
 *    province's holiday rate);
 *  - facility hours: a facility with opening hours and none on that weekday is closed, nothing is made
 *    (FACILITY_CLOSED); a line outside the day's opening hours is made and flagged (OUTSIDE_HOURS) — set-up
 *    and closing shifts often are;
 *  - the template's own dates (validFrom/validTo) bound what it makes;
 *  - every application is recorded and can be undone as a whole: its drafts still in DRAFT are cancelled
 *    (overtime they carried comes off the ledger); anything published since is kept and counted.
 *  - optionally (organization setting, default off) the worker keeps each template's next N weeks drafted.
 */
import type { Prisma, Province } from '@prisma/client';
import { z } from 'zod';
import type { AuthContext } from '../../auth/middleware.js';
import { type Tx, audit } from '../../lib/db.js';
import { badRequest, forbidden, notFound } from '../../lib/errors.js';
import { addDays, dayOfWeek, localDate } from '../../lib/time.js';
import { holidaysTouching, organizationDay, statutoryDay } from '../payroll/holidayRules.js';
import { shiftInScope } from '../people/scope.js';
import { resolveFeatures } from '../platform/features.js';
import { wallClock } from './eligibility.js';
import { schedulableDepartments } from './fillRun.js';
import { reverseOvertime } from './overtime.js';
import { parseSolverSettings } from './solverSettings.js';

/** The longest range one Apply covers (13 weeks, the longest Plan ahead). */
export const MAX_APPLY_DAYS = 91;
/** Longest template line, as for any shift. */
const MAX_SLOT_MINUTES = 16 * 60;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const slotBody = z
  .object({
    daysOfWeek: z.array(z.number().int().min(0).max(6)).min(1).max(7),
    startMinute: z.number().int().min(0).max(1439),
    endMinute: z.number().int().min(1).max(1440 + MAX_SLOT_MINUTES),
    facilityId: z.string().uuid(),
    positionId: z.string().uuid(),
    headcount: z.number().int().min(1).max(50),
    unpaidBreakMinutes: z.number().int().min(0).max(240).nullable().optional(),
  })
  .refine((s) => s.endMinute > s.startMinute && s.endMinute - s.startMinute <= MAX_SLOT_MINUTES, { message: 'A line must end after it starts, and last at most 16 hours.', path: ['endMinute'] });
export const templateBody = z
  .object({
    name: z.string().trim().min(2).max(80),
    departmentId: z.string().uuid().nullable().optional(),
    validFrom: isoDate.nullable().optional(),
    validTo: isoDate.nullable().optional(),
    active: z.boolean().default(true),
    autoWeeksAhead: z.number().int().min(0).max(8).default(0),
    slots: z.array(slotBody).min(1).max(200),
  })
  .refine((t) => !t.validFrom || !t.validTo || t.validTo >= t.validFrom, { message: 'The end date must be on or after the start date.', path: ['validTo'] });
export type TemplateInput = z.infer<typeof templateBody>;
export type SlotInput = z.infer<typeof slotBody>;

export type TemplateRow = Prisma.ShiftTemplateGetPayload<{ include: { slots: true } }>;
type Slot = Pick<TemplateRow['slots'][number], 'id' | 'daysOfWeek' | 'startMinute' | 'endMinute' | 'facilityId' | 'positionId' | 'headcount'>;

export interface Occurrence { slotId: string; date: string; start: Date; end: Date }

/** Every shift time a template's lines ask for in [from, to) (local dates), wall-clock in each facility's zone. */
export function templateOccurrences(slots: Slot[], from: string, to: string, tzOf: (facilityId: string) => string): Occurrence[] {
  const out: Occurrence[] = [];
  for (let d = from; d < to; d = addDays(d, 1)) {
    const dow = dayOfWeek(d);
    for (const s of slots) {
      if (!s.daysOfWeek.includes(dow)) continue;
      const tz = tzOf(s.facilityId);
      out.push({ slotId: s.id, date: d, start: wallClock(d, s.startMinute, tz), end: wallClock(d, s.endMinute, tz) });
    }
  }
  return out;
}

/** The part of [from, to) inside a template's own dates (validTo is inclusive). */
export function clampRange(from: string, to: string, validFrom: string | null, validTo: string | null): { from: string; to: string } | null {
  const f = validFrom && validFrom > from ? validFrom : from;
  const t = validTo && addDays(validTo, 1) < to ? addDays(validTo, 1) : to;
  return f < t ? { from: f, to: t } : null;
}

export type OccurrenceCode = 'HOLIDAY_CLOSED' | 'FACILITY_CLOSED' | 'OUTSIDE_HOURS' | 'STAT_HOLIDAY';
interface HoursBlock { dayOfWeek: number; opensMinute: number; closesMinute: number }

/**
 * What to do with one occurrence: skip it (closed) or make it, perhaps with a flag. Pure.
 * `hours` are the facility's opening blocks (none at all = no opening hours kept: always open).
 */
export function classify(slot: Pick<Slot, 'startMinute' | 'endMinute'>, date: string, opts: { holiday: boolean; closedOnHolidays: boolean; hours: HoursBlock[] }): { skip: boolean; code: OccurrenceCode | null } {
  if (opts.holiday && opts.closedOnHolidays) return { skip: true, code: 'HOLIDAY_CLOSED' };
  if (opts.hours.length) {
    const today = opts.hours.filter((h) => h.dayOfWeek === dayOfWeek(date));
    if (!today.length) return { skip: true, code: 'FACILITY_CLOSED' };
    const inside = today.some((h) => slot.startMinute >= h.opensMinute && slot.endMinute <= h.closesMinute);
    if (!inside) return { skip: false, code: 'OUTSIDE_HOURS' };
  }
  return { skip: false, code: opts.holiday ? 'STAT_HOLIDAY' : null };
}

const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
const dateOrNull = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

/** Who may use a template: schedulers of every line's position and facility (department scope). */
export async function assertTemplateInScope(tx: Tx, a: AuthContext, t: { departmentId?: string | null; slots: Array<{ facilityId: string; positionId: string }> }): Promise<string | null> {
  const departments = await schedulableDepartments(tx, a);
  const allowed = new Set(departments.flatMap((d) => d.positionIds));
  for (const s of t.slots) {
    if (!allowed.has(s.positionId) || !shiftInScope(a.scope, s)) throw forbidden('This template has a line outside your department.');
  }
  const positions = await tx.position.findMany({ where: { id: { in: [...new Set(t.slots.map((s) => s.positionId))] } }, select: { id: true, departmentId: true } });
  if (positions.length !== new Set(t.slots.map((s) => s.positionId)).size) throw notFound('Position');
  const facilityIds = [...new Set(t.slots.map((s) => s.facilityId))];
  if ((await tx.facility.count({ where: { id: { in: facilityIds } } })) !== facilityIds.length) throw notFound('Facility');
  const depts = new Set(positions.map((p) => p.departmentId));
  if (t.departmentId && [...depts].some((d) => d !== t.departmentId)) throw badRequest('Every line’s position must be in the template’s department.');
  // A template whose positions are all in one department belongs to it.
  return t.departmentId ?? (depts.size === 1 ? ([...depts][0] ?? null) : null);
}

/** Templates this person may see: every line inside their scope. */
export async function visibleTemplates(tx: Tx, a: AuthContext) {
  const departments = await schedulableDepartments(tx, a);
  const allowed = new Set(departments.flatMap((d) => d.positionIds));
  const rows = await tx.shiftTemplate.findMany({ include: { slots: { orderBy: { sortOrder: 'asc' } } }, orderBy: { name: 'asc' } });
  return rows.filter((t) => t.slots.every((s) => allowed.has(s.positionId) && shiftInScope(a.scope, s)));
}

export function templateView(t: TemplateRow) {
  return {
    id: t.id,
    name: t.name,
    departmentId: t.departmentId,
    validFrom: dateOrNull(t.validFrom),
    validTo: dateOrNull(t.validTo),
    active: t.active,
    autoWeeksAhead: t.autoWeeksAhead,
    slots: t.slots.map((s) => ({ id: s.id, daysOfWeek: s.daysOfWeek, startMinute: s.startMinute, endMinute: s.endMinute, facilityId: s.facilityId, positionId: s.positionId, headcount: s.headcount, unpaidBreakMinutes: s.unpaidBreakMinutes })),
    updatedAt: t.updatedAt.toISOString(),
  };
}

/** Saves the template and replaces its lines (shifts already made keep their line id; new lines get new ids). */
export async function saveTemplate(tx: Tx, a: AuthContext, input: TemplateInput, id: string | null) {
  const departmentId = await assertTemplateInScope(tx, a, input);
  const data = {
    name: input.name,
    departmentId,
    validFrom: input.validFrom ? new Date(`${input.validFrom}T00:00:00Z`) : null,
    validTo: input.validTo ? new Date(`${input.validTo}T00:00:00Z`) : null,
    active: input.active,
    autoWeeksAhead: input.autoWeeksAhead,
  };
  let before: TemplateRow | null = null;
  let templateId = id;
  if (id) {
    before = await tx.shiftTemplate.findUnique({ where: { id }, include: { slots: true } });
    if (!before) throw notFound('Template');
    await assertTemplateInScope(tx, a, before);
    await tx.shiftTemplate.update({ where: { id }, data });
  } else {
    templateId = (await tx.shiftTemplate.create({ data: { ...data, tenantId: a.tenantId, createdById: a.userId } })).id;
  }
  // Lines that are unchanged keep their id (so a re-apply still recognizes the drafts they made).
  const same = (x: Slot & { unpaidBreakMinutes: number | null }, y: SlotInput) =>
    x.startMinute === y.startMinute && x.endMinute === y.endMinute && x.facilityId === y.facilityId && x.positionId === y.positionId && [...x.daysOfWeek].sort().join() === [...y.daysOfWeek].sort().join();
  const keep = new Set<string>();
  const old = [...(before?.slots ?? [])];
  for (const [i, s] of input.slots.entries()) {
    const match = old.find((x) => !keep.has(x.id) && same(x, s));
    const row = { daysOfWeek: [...new Set(s.daysOfWeek)].sort(), startMinute: s.startMinute, endMinute: s.endMinute, facilityId: s.facilityId, positionId: s.positionId, headcount: s.headcount, unpaidBreakMinutes: s.unpaidBreakMinutes ?? null, sortOrder: i };
    if (match) {
      keep.add(match.id);
      await tx.shiftTemplateSlot.update({ where: { id: match.id }, data: row });
    } else {
      await tx.shiftTemplateSlot.create({ data: { ...row, tenantId: a.tenantId, templateId: templateId! } });
    }
  }
  const gone = old.filter((x) => !keep.has(x.id)).map((x) => x.id);
  if (gone.length) await tx.shiftTemplateSlot.deleteMany({ where: { id: { in: gone } } });
  const saved = await tx.shiftTemplate.findUniqueOrThrow({ where: { id: templateId! }, include: { slots: { orderBy: { sortOrder: 'asc' } } } });
  await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: id ? 'shift_template.update' : 'shift_template.create', entity: 'ShiftTemplate', entityId: saved.id, before: before ? templateView(before) : undefined, after: templateView(saved) });
  return saved;
}

export interface ApplyItem { slotId: string; date: string; startsAt: string; endsAt: string; status: 'create' | 'existing' | 'skipped'; count: number; code: OccurrenceCode | null }
export interface ApplyResult {
  applicationId: string | null;
  created: number;
  existing: number;
  skipped: number;
  flagged: number;
  /** Days of the range outside the template's own dates. */
  outsideDates: number;
  items: ApplyItem[];
  /** Shift ids made (empty for a preview). */
  shiftIds: string[];
}

/**
 * Applies a template to [from, to) (local dates). `a` = a person (checked against their scope);
 * null = the worker's automatic drafts. Preview with dryRun: nothing is written.
 */
export async function applyTemplate(tx: Tx, a: AuthContext | null, tenantId: string, templateId: string, from: string, to: string, opts: { dryRun?: boolean; automatic?: boolean } = {}): Promise<ApplyResult> {
  const days = daysBetween(from, to);
  if (days <= 0) throw badRequest('The range must end after it starts.');
  if (days > MAX_APPLY_DAYS) throw badRequest(`Choose a range of up to ${MAX_APPLY_DAYS} days.`);
  const t = await tx.shiftTemplate.findUnique({ where: { id: templateId }, include: { slots: { orderBy: { sortOrder: 'asc' } } } });
  if (!t) throw notFound('Template');
  if (a) await assertTemplateInScope(tx, a, t);
  const empty: ApplyResult = { applicationId: null, created: 0, existing: 0, skipped: 0, flagged: 0, outsideDates: days, items: [], shiftIds: [] };
  const range = clampRange(from, to, dateOrNull(t.validFrom), dateOrNull(t.validTo));
  if (!range || !t.slots.length) return empty;
  const outsideDates = days - daysBetween(range.from, range.to);

  const facilityIds = [...new Set(t.slots.map((s) => s.facilityId))];
  const [facilities, hours, tenant] = await Promise.all([
    tx.facility.findMany({ where: { id: { in: facilityIds } }, select: { id: true, timezone: true, province: true } }),
    tx.facilityHours.findMany({ where: { facilityId: { in: facilityIds } }, select: { facilityId: true, dayOfWeek: true, opensMinute: true, closesMinute: true } }),
    tx.tenant.findFirstOrThrow({ select: { overtimePolicy: true, holidayObservance: true } }),
  ]);
  const facility = new Map(facilities.map((f) => [f.id, f]));
  const closed = new Set(parseSolverSettings(tenant.overtimePolicy).holidayClosedFacilityIds);
  const holidays = new Map<Province, Set<string>>();
  for (const prov of new Set(facilities.map((f) => f.province))) {
    const rows = await holidaysTouching(tx, prov, range.from, range.to);
    holidays.set(prov, new Set(rows.flatMap((h) => [statutoryDay(h), organizationDay(h, tenant.holidayObservance)])));
  }
  const slots = t.slots.filter((s) => facility.has(s.facilityId));
  const occ = templateOccurrences(slots, range.from, range.to, (f) => facility.get(f)!.timezone);
  const existingRows = occ.length
    ? await tx.shift.findMany({
        where: { templateSlotId: { in: slots.map((s) => s.id) }, status: { not: 'CANCELLED' }, startsAt: { gte: new Date(Math.min(...occ.map((o) => o.start.getTime()))), lte: new Date(Math.max(...occ.map((o) => o.start.getTime()))) } },
        select: { templateSlotId: true, startsAt: true },
      })
    : [];
  const have = new Map<string, number>();
  for (const r of existingRows) {
    const k = `${r.templateSlotId}|${r.startsAt.getTime()}`;
    have.set(k, (have.get(k) ?? 0) + 1);
  }
  const slotById = new Map(slots.map((s) => [s.id, s]));
  const items: ApplyItem[] = [];
  const toCreate: Array<{ slot: (typeof slots)[number]; o: Occurrence; n: number }> = [];
  for (const o of occ) {
    const s = slotById.get(o.slotId)!;
    const f = facility.get(s.facilityId)!;
    const c = classify(s, o.date, { holiday: holidays.get(f.province)?.has(o.date) ?? false, closedOnHolidays: closed.has(s.facilityId), hours: hours.filter((h) => h.facilityId === s.facilityId) });
    const base = { slotId: s.id, date: o.date, startsAt: o.start.toISOString(), endsAt: o.end.toISOString(), code: c.code };
    if (c.skip) {
      items.push({ ...base, status: 'skipped', count: s.headcount });
      continue;
    }
    const already = Math.min(s.headcount, have.get(`${s.id}|${o.start.getTime()}`) ?? 0);
    if (already) items.push({ ...base, status: 'existing', count: already });
    const n = s.headcount - already;
    if (n > 0) {
      items.push({ ...base, status: 'create', count: n });
      toCreate.push({ slot: s, o, n });
    }
  }
  const count = (st: ApplyItem['status']) => items.filter((i) => i.status === st).reduce((x, i) => x + i.count, 0);
  const result: ApplyResult = {
    applicationId: null,
    created: count('create'),
    existing: count('existing'),
    skipped: count('skipped'),
    flagged: items.filter((i) => i.status === 'create' && i.code).reduce((x, i) => x + i.count, 0),
    outsideDates,
    items: items.slice(0, 2000),
    shiftIds: [],
  };
  if (opts.dryRun || !toCreate.length) return result;

  const notes = items.filter((i) => i.code).map((i) => ({ slotId: i.slotId, date: i.date, code: i.code }));
  const app = await tx.shiftTemplateApplication.create({
    data: { tenantId, templateId: t.id, fromDate: new Date(`${range.from}T00:00:00Z`), toDate: new Date(`${range.to}T00:00:00Z`), automatic: !!opts.automatic, createdById: a?.userId ?? null, created: result.created, notes: notes.slice(0, 2000) as Prisma.InputJsonValue },
  });
  const ids: string[] = [];
  for (const { slot, o, n } of toCreate) {
    for (let k = 0; k < n; k++) {
      const flag = items.find((i) => i.slotId === slot.id && i.date === o.date && i.status === 'create')?.code;
      const s = await tx.shift.create({
        data: { tenantId, facilityId: slot.facilityId, positionId: slot.positionId, startsAt: o.start, endsAt: o.end, status: 'DRAFT', unpaidBreakMinutes: slot.unpaidBreakMinutes, templateSlotId: slot.id, templateApplicationId: app.id, conflictReason: flag && flag !== 'STAT_HOLIDAY' ? `Template: ${flag}` : null },
        select: { id: true },
      });
      ids.push(s.id);
    }
  }
  await audit(tx, { tenantId, actorId: a?.userId ?? null, action: opts.automatic ? 'shift_template.auto_apply' : 'shift_template.apply', entity: 'ShiftTemplate', entityId: t.id, after: { applicationId: app.id, from: range.from, to: range.to, created: result.created, existing: result.existing, skipped: result.skipped, flagged: result.flagged } });
  return { ...result, applicationId: app.id, shiftIds: ids };
}

/**
 * Undoes one application: its drafts still in DRAFT are cancelled (whoever Fill or the planner put
 * on them since; the overtime they carried comes off the ledger). Published ones are kept.
 */
export async function undoApplication(tx: Tx, a: AuthContext, applicationId: string) {
  const app = await tx.shiftTemplateApplication.findUnique({ where: { id: applicationId }, include: { template: { include: { slots: true } } } });
  if (!app) throw notFound('Application');
  await assertTemplateInScope(tx, a, app.template);
  if (app.undoneAt) throw badRequest('This was already undone.');
  const shifts = await tx.shift.findMany({ where: { templateApplicationId: applicationId, status: { not: 'CANCELLED' } }, select: { id: true, status: true, userId: true } });
  let cancelled = 0;
  for (const s of shifts.filter((x) => x.status === 'DRAFT')) {
    const r = await tx.shift.updateMany({ where: { id: s.id, status: 'DRAFT' }, data: { status: 'CANCELLED', version: { increment: 1 }, conflictReason: 'Template application undone' } });
    if (!r.count) continue;
    cancelled++;
    await tx.shiftOffer.updateMany({ where: { shiftId: s.id, status: { in: ['OPEN', 'PENDING_APPROVAL'] } }, data: { status: 'CANCELLED' } });
    if (s.userId) await reverseOvertime(tx, a.tenantId, a.userId, s.userId, s.id, 'Template application undone');
  }
  const kept = shifts.length - cancelled;
  await tx.shiftTemplateApplication.update({ where: { id: applicationId }, data: { undoneAt: new Date(), undoneById: a.userId } });
  await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'shift_template.undo', entity: 'ShiftTemplateApplication', entityId: applicationId, after: { cancelled, kept } });
  return { cancelled, kept };
}

export function applicationView(x: Prisma.ShiftTemplateApplicationGetPayload<object>) {
  return {
    id: x.id,
    templateId: x.templateId,
    from: x.fromDate.toISOString().slice(0, 10),
    to: x.toDate.toISOString().slice(0, 10),
    automatic: x.automatic,
    created: x.created,
    notes: Array.isArray(x.notes) ? x.notes.length : 0,
    undoneAt: x.undoneAt?.toISOString() ?? null,
    createdAt: x.createdAt.toISOString(),
  };
}

/**
 * Worker: with the organization's automatic drafts on, keeps each active template's next
 * `autoWeeksAhead` weeks drafted (from tomorrow). Idempotent: only missing days are made.
 */
export async function autoDraftTemplates(tx: Tx, now = new Date()): Promise<number> {
  const tenant = await tx.tenant.findFirst({ select: { id: true, overtimePolicy: true, features: true } });
  if (!tenant || !resolveFeatures(tenant.features).shiftTemplates || !parseSolverSettings(tenant.overtimePolicy).templateAutoCreate) return 0;
  const templates = await tx.shiftTemplate.findMany({ where: { active: true, autoWeeksAhead: { gt: 0 } }, include: { slots: { select: { facilityId: true }, take: 1 } } });
  let made = 0;
  for (const t of templates) {
    const f = t.slots[0] ? await tx.facility.findUnique({ where: { id: t.slots[0].facilityId }, select: { timezone: true } }) : null;
    if (!f) continue;
    const from = addDays(localDate(now, f.timezone), 1);
    const r = await applyTemplate(tx, null, tenant.id, t.id, from, addDays(from, Math.min(MAX_APPLY_DAYS, t.autoWeeksAhead * 7)), { automatic: true });
    made += r.created;
  }
  return made;
}
