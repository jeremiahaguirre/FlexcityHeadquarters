/**
 * Shift bidding by seniority — only where the organization uses seniority (the `seniority` switch;
 * a department that turned seniority off can't hold a round either). The `shiftBidding` feature needs
 * `seniority` on (features.ts `requires`): with seniority off it is off, its menus are hidden and its
 * routes refuse.
 *
 * A manager opens a round for a set of open draft shifts, or for LINES built from a weekly template
 * over a season (each line = one seat of one template line: the same shift on the same days for the
 * whole range). Staff holding one of the round's positions rank items until the close; they see their
 * own place in the seniority order and how awarding works, never anyone else's choices.
 *
 * At the close (worker, every minute) awards are proposed in seniority order:
 *  - order: by the round's basis — DATE: seniority date (earliest first), then seniority hours (most
 *    first); HOURS: hours, then date — then hire date (earliest first), then a recorded deterministic
 *    tie-break (SHA-256 of the round and the person, lowest first). The basis defaults to the
 *    organization's setting and can be set per round (collective agreements differ).
 *  - award order (the organization's default, settable per round; collective agreements differ):
 *    ROUND_ROBIN ("one at a time in seniority order", the default): in pass 1 each person, most
 *    senior first, gets their highest-ranked choice still open that they can work; pass 2 gives a
 *    second award the same way, up to the round's maximum per person (configurable, default 1).
 *    SENIOR_FIRST ("most senior first takes all their awards"): the most senior person gets up to
 *    the maximum of their ranked choices (highest first, each one they can work), then the next
 *    person, and so on. An award's `pass` is then its number within that person's turn.
 *    With a maximum of 1 the two orders give the same result.
 *  - "can work" is the Shift Board's check: evaluateCandidate() (position, certifications through
 *    the shift, onboarding, age and young-worker limits, time off, overlap, rest, daily/weekly rest,
 *    days in a row, hours a day, weekly caps, restrictions) against the person's other shifts plus
 *    what they've already won in this round, no overtime, and travel time between facilities.
 *    Availability isn't required: bidding on a shift is saying you'll work it.
 *  - every choice gets an outcome: AWARDED, TAKEN_BY_SENIOR (a more senior colleague chose it),
 *    TAKEN_EARLIER_PASS (taken in an earlier pass by someone after them in the order), NOT_ELIGIBLE
 *    (with the rule's code, e.g. MISSING_CERTIFICATION), LIMIT_REACHED (they already had their
 *    maximum), OVERRIDDEN (a manager gave it to someone else) or CHANGED (the shift changed before
 *    confirmation).
 * The manager reviews, may change any award with a required reason (audited; the new person must
 * pass the same check), then confirms: awarded shifts are assigned and published (re-checked under
 * the usual locks), every other shift in the round is published and posted on the Shift Board,
 * and everyone who bid is told what they got and why not. Union stewards (bidding.observe) can read
 * the order, outcomes and override reasons once a round has closed; nothing else.
 */
import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import type { AuthContext } from '../../auth/middleware.js';
import { announceChange } from '../../lib/changes.js';
import { type Tx, audit } from '../../lib/db.js';
import { HttpError, badRequest, conflict, notFound } from '../../lib/errors.js';
import type { DomainEvent } from '../../lib/events.js';
import { type NotificationDraft, notify, usersWithPermission } from '../notifications/notifier.js';
import { peopleWhere, shiftInScope } from '../people/scope.js';
import { resolveFeatures } from '../platform/features.js';
import { postOffer } from '../shiftboard/offers.js';
import { tooLittleTravel } from './assistant.js';
import { type CandidateContext, evaluateCandidate } from './eligibility.js';
import { type BundleCache, type ShiftBundle, evalOpts, loadAssistantCandidates, loadCandidate, loadShiftBundle } from './eligibilityLoader.js';
import { schedulableDepartments } from './fillRun.js';
import { lockForAssignment } from './locks.js';
import { applyTemplate } from './shiftTemplates.js';
import { effectiveSettings, parseSolverSettings } from './solverSettings.js';

export type Basis = 'DATE' | 'HOURS';
export type AwardOrder = 'ROUND_ROBIN' | 'SENIOR_FIRST';
export type Outcome = 'AWARDED' | 'TAKEN_BY_SENIOR' | 'TAKEN_EARLIER_PASS' | 'NOT_ELIGIBLE' | 'LIMIT_REACHED' | 'OVERRIDDEN' | 'CHANGED';
export interface ChoiceOutcome { itemId: string; rank: number | null; result: Outcome; code?: string; pass?: number }

/** Bid choices and outcomes of rounds finished this long ago are deleted (the awards, i.e. who works what, stay). */
export const BID_RETENTION_DAYS = 730;
export const MAX_CHOICES = 60;

// ------------------------------------------------------------------------- pure parts

export interface Standing { userId: string; seniorityDate: string | null; seniorityHours: number; hireDate: string | null; tiebreak: string }

/** The recorded last tie-break: deterministic per round and person, unrelated to names or ids' order. */
export const tiebreakOf = (roundId: string, userId: string) => createHash('sha256').update(`${roundId}:${userId}`).digest('hex').slice(0, 16);

/** Most senior first, by the round's basis; then hire date; then the recorded tie-break. */
export function seniorityOrder<T extends Standing>(people: T[], basis: Basis): T[] {
  const date = (a: T, b: T) => (a.seniorityDate ?? '9999-12-31').localeCompare(b.seniorityDate ?? '9999-12-31');
  const hours = (a: T, b: T) => b.seniorityHours - a.seniorityHours;
  return [...people].sort((a, b) => (basis === 'DATE' ? date(a, b) || hours(a, b) : hours(a, b) || date(a, b)) || (a.hireDate ?? '9999-12-31').localeCompare(b.hireDate ?? '9999-12-31') || a.tiebreak.localeCompare(b.tiebreak));
}

export interface AwardInput {
  /** In seniority order, each with their ranked item ids (best first). */
  entrants: Array<{ userId: string; choices: string[] }>;
  maxAwards: number;
  /** Round robin (default) or most senior first takes all their awards. */
  order?: AwardOrder;
  /** null = can work it, given what they've won already in this round; else the rule's code. */
  check: (userId: string, itemId: string, won: readonly string[]) => string | null;
}
export interface AwardResult {
  awards: Array<{ itemId: string; userId: string; pass: number; choiceRank: number }>;
  outcomes: Map<string, ChoiceOutcome[]>;
}

/** Seniority awarding, round robin or most senior first (see the header). Pure and deterministic. */
export function awardBids(input: AwardInput): AwardResult {
  const takenBy = new Map<string, { userId: string; pass: number; order: number }>();
  const won = new Map<string, string[]>(input.entrants.map((e) => [e.userId, []]));
  const outcome = new Map<string, Map<string, ChoiceOutcome>>(input.entrants.map((e) => [e.userId, new Map()]));
  const awards: AwardResult['awards'] = [];
  const order = new Map(input.entrants.map((e, i) => [e.userId, i]));
  if (input.order === 'SENIOR_FIRST') {
    // Each person's whole turn, most senior first: everything taken before them was taken by someone more senior.
    for (const e of input.entrants) {
      const mine = won.get(e.userId)!;
      const out = outcome.get(e.userId)!;
      for (const [i, itemId] of e.choices.entries()) {
        if (mine.length >= input.maxAwards) break;
        const t = takenBy.get(itemId);
        if (t) {
          out.set(itemId, { itemId, rank: i + 1, result: 'TAKEN_BY_SENIOR', pass: t.pass });
          continue;
        }
        const code = input.check(e.userId, itemId, mine);
        if (code) {
          out.set(itemId, { itemId, rank: i + 1, result: 'NOT_ELIGIBLE', code });
          continue;
        }
        const pass = mine.length + 1;
        takenBy.set(itemId, { userId: e.userId, pass, order: order.get(e.userId)! });
        mine.push(itemId);
        out.set(itemId, { itemId, rank: i + 1, result: 'AWARDED', pass });
        awards.push({ itemId, userId: e.userId, pass, choiceRank: i + 1 });
      }
    }
  }
  for (let pass = 1; input.order !== 'SENIOR_FIRST' && pass <= input.maxAwards; pass++) {
    let any = false;
    for (const e of input.entrants) {
      const mine = won.get(e.userId)!;
      if (mine.length >= pass) continue;
      const out = outcome.get(e.userId)!;
      for (const [i, itemId] of e.choices.entries()) {
        if (mine.includes(itemId)) continue;
        // Already ruled out in an earlier pass (what they've won since only adds constraints).
        if (out.get(itemId)?.result === 'NOT_ELIGIBLE') continue;
        const t = takenBy.get(itemId);
        if (t) {
          if (!out.has(itemId)) out.set(itemId, { itemId, rank: i + 1, result: t.order < order.get(e.userId)! ? 'TAKEN_BY_SENIOR' : 'TAKEN_EARLIER_PASS', pass: t.pass });
          continue;
        }
        const code = input.check(e.userId, itemId, mine);
        if (code) {
          out.set(itemId, { itemId, rank: i + 1, result: 'NOT_ELIGIBLE', code });
          continue;
        }
        takenBy.set(itemId, { userId: e.userId, pass, order: order.get(e.userId)! });
        mine.push(itemId);
        out.set(itemId, { itemId, rank: i + 1, result: 'AWARDED', pass });
        awards.push({ itemId, userId: e.userId, pass, choiceRank: i + 1 });
        any = true;
        break;
      }
    }
    if (!any) break;
  }
  // Choices never reached: someone else got them, or the person already had their maximum.
  const outcomes = new Map<string, ChoiceOutcome[]>();
  for (const e of input.entrants) {
    const out = outcome.get(e.userId)!;
    const full = won.get(e.userId)!.length >= input.maxAwards;
    outcomes.set(
      e.userId,
      e.choices.map((itemId, i) => {
        const o = out.get(itemId);
        if (o) return o;
        // Never reached: they already had their maximum (anything still open would have been tried).
        const t = takenBy.get(itemId);
        if (!full && t && t.userId !== e.userId) return { itemId, rank: i + 1, result: t.order < order.get(e.userId)! ? ('TAKEN_BY_SENIOR' as const) : ('TAKEN_EARLIER_PASS' as const), pass: t.pass };
        return { itemId, rank: i + 1, result: 'LIMIT_REACHED' as const };
      }),
    );
  }
  return { awards, outcomes };
}

/** Lines from a template's drafts: one per (template line, seat), each shift of that seat across the range. */
export function buildLines(slots: Array<{ id: string; daysOfWeek: number[]; startMinute: number; endMinute: number; positionId: string; facilityId: string }>, shifts: Array<{ id: string; templateSlotId: string | null; startsAt: Date; endsAt: Date }>) {
  const lines: Array<{ slotId: string; seat: number; shiftIds: string[]; positionId: string; facilityId: string; first: Date; last: Date; meta: { daysOfWeek: number[]; startMinute: number; endMinute: number } }> = [];
  for (const s of slots) {
    const byStart = new Map<number, typeof shifts>();
    for (const x of shifts.filter((y) => y.templateSlotId === s.id)) byStart.set(x.startsAt.getTime(), [...(byStart.get(x.startsAt.getTime()) ?? []), x]);
    const seats = new Map<number, typeof shifts>();
    for (const [, group] of [...byStart].sort((a, b) => a[0] - b[0])) {
      group.sort((a, b) => a.id.localeCompare(b.id)).forEach((x, k) => seats.set(k, [...(seats.get(k) ?? []), x]));
    }
    for (const [seat, xs] of [...seats].sort((a, b) => a[0] - b[0])) {
      lines.push({ slotId: s.id, seat, shiftIds: xs.map((x) => x.id), positionId: s.positionId, facilityId: s.facilityId, first: xs[0]!.startsAt, last: xs.at(-1)!.endsAt, meta: { daysOfWeek: s.daysOfWeek, startMinute: s.startMinute, endMinute: s.endMinute } });
    }
  }
  return lines;
}

// ------------------------------------------------------------------------- settings and guards

/** Is bidding usable here? The org's seniority switch and the feature (with its billing lock, if any). */
export async function biddingOn(tx: Tx): Promise<boolean> {
  const t = await tx.tenant.findFirst({ select: { features: true } });
  const f = resolveFeatures(t?.features);
  return f.seniority && f.shiftBidding;
}

export async function defaultBasis(tx: Tx): Promise<Basis> {
  const t = await tx.tenant.findFirstOrThrow({ select: { overtimePolicy: true } });
  return parseSolverSettings(t.overtimePolicy).bidSeniorityBasis;
}

export async function defaultAwardOrder(tx: Tx): Promise<AwardOrder> {
  const t = await tx.tenant.findFirstOrThrow({ select: { overtimePolicy: true } });
  return parseSolverSettings(t.overtimePolicy).bidAwardOrder;
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const roundBody = z
  .object({
    name: z.string().trim().min(2).max(80),
    kind: z.enum(['SHIFTS', 'LINES']),
    departmentId: z.string().uuid().nullable().default(null),
    positionIds: z.array(z.string().uuid()).min(1).max(20),
    opensAt: z.coerce.date(),
    closesAt: z.coerce.date(),
    maxAwardsPerPerson: z.number().int().min(1).max(20).default(1),
    seniorityBasis: z.enum(['DATE', 'HOURS']).optional(),
    /** Left out: the organization's default. */
    awardOrder: z.enum(['ROUND_ROBIN', 'SENIOR_FIRST']).optional(),
    /** SHIFTS: these drafts, or every open draft of the positions in [from, to). */
    shiftIds: z.array(z.string().uuid()).max(500).optional(),
    /** LINES: the template, applied over [from, to) first (idempotent). */
    templateId: z.string().uuid().optional(),
    from: isoDate.optional(),
    to: isoDate.optional(),
  })
  .refine((b) => b.closesAt > b.opensAt, { message: 'The round must close after it opens.', path: ['closesAt'] })
  .refine((b) => b.kind !== 'LINES' || (b.templateId && b.from && b.to), { message: 'Lines need a template and dates.', path: ['templateId'] })
  .refine((b) => b.kind !== 'SHIFTS' || b.shiftIds?.length || (b.from && b.to), { message: 'Choose shifts or dates.', path: ['shiftIds'] });
export type RoundInput = z.infer<typeof roundBody>;

/** Shifts already in a round that hasn't finished. */
async function shiftsInActiveRounds(tx: Tx): Promise<Set<string>> {
  const items = await tx.bidItem.findMany({ where: { round: { status: { in: ['OPEN', 'REVIEW'] } } }, select: { shiftIds: true } });
  return new Set(items.flatMap((i) => i.shiftIds));
}

/** Positions this manager may run a round for, checked against departments and seniority per department. */
async function assertPositions(tx: Tx, a: AuthContext, positionIds: string[], departmentId: string | null) {
  const departments = await schedulableDepartments(tx, a);
  const allowed = new Set(departments.flatMap((d) => d.positionIds));
  if (positionIds.some((p) => !allowed.has(p))) throw new HttpError(403, 'FORBIDDEN', 'A position isn’t in your department.');
  const rows = await tx.position.findMany({ where: { id: { in: positionIds } }, select: { departmentId: true } });
  if (rows.length !== new Set(positionIds).size) throw notFound('Position');
  if (departmentId && rows.some((r) => r.departmentId !== departmentId)) throw badRequest('Every position must be in the round’s department.');
  const tenant = await tx.tenant.findFirstOrThrow({ select: { overtimePolicy: true, features: true } });
  const settings = parseSolverSettings(tenant.overtimePolicy);
  for (const d of new Set(rows.map((r) => r.departmentId))) {
    if (!effectiveSettings(settings, d, resolveFeatures(tenant.features).seniority).useSeniority) throw new HttpError(409, 'SENIORITY_OFF', 'This department doesn’t use seniority, so it can’t hold a bid round.');
  }
  return departmentId ?? (new Set(rows.map((r) => r.departmentId)).size === 1 ? (rows[0]!.departmentId ?? null) : null);
}

/** Opens a round (it accepts rankings from opensAt). Items must start after the close. */
export async function createRound(tx: Tx, a: AuthContext, b: RoundInput) {
  if (b.closesAt <= new Date()) throw badRequest('The close must be in the future.');
  const departmentId = await assertPositions(tx, a, b.positionIds, b.departmentId);
  const busy = await shiftsInActiveRounds(tx);
  const basis = b.seniorityBasis ?? (await defaultBasis(tx));
  const awardOrder = b.awardOrder ?? (await defaultAwardOrder(tx));
  type NewItem = { shiftIds: string[]; positionId: string; facilityId: string; first: Date; last: Date; meta: Prisma.InputJsonValue };
  let items: NewItem[] = [];
  if (b.kind === 'SHIFTS') {
    const shifts = await tx.shift.findMany({
      where: { status: 'DRAFT', userId: null, positionId: { in: b.positionIds }, ...(b.shiftIds?.length ? { id: { in: b.shiftIds } } : { startsAt: { gte: new Date(`${b.from}T00:00:00Z`), lt: new Date(`${b.to}T23:59:59Z`) } }) },
      orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
    });
    if (b.shiftIds?.length && shifts.length !== new Set(b.shiftIds).size) throw badRequest('Only open draft shifts of the round’s positions can be bid on.');
    items = shifts.filter((s) => shiftInScope(a.scope, s) && !busy.has(s.id)).map((s) => ({ shiftIds: [s.id], positionId: s.positionId, facilityId: s.facilityId, first: s.startsAt, last: s.endsAt, meta: {} }));
  } else {
    await applyTemplate(tx, a, a.tenantId, b.templateId!, b.from!, b.to!);
    const tpl = await tx.shiftTemplate.findUniqueOrThrow({ where: { id: b.templateId! }, include: { slots: true } });
    const slots = tpl.slots.filter((s) => b.positionIds.includes(s.positionId));
    const shifts = await tx.shift.findMany({ where: { templateSlotId: { in: slots.map((s) => s.id) }, status: 'DRAFT', userId: null, startsAt: { gte: new Date(`${b.from}T00:00:00Z`), lt: new Date(`${b.to}T23:59:59Z`) } }, select: { id: true, templateSlotId: true, startsAt: true, endsAt: true, facilityId: true } });
    const free = shifts.filter((s) => !busy.has(s.id));
    items = buildLines(slots, free).map((l) => ({ shiftIds: l.shiftIds, positionId: l.positionId, facilityId: l.facilityId, first: l.first, last: l.last, meta: l.meta }));
  }
  if (!items.length) throw badRequest('There are no open draft shifts to bid on.');
  if (items.some((i) => i.first <= b.closesAt)) throw badRequest('Every shift must start after the round closes.');
  const round = await tx.bidRound.create({
    data: {
      tenantId: a.tenantId,
      name: b.name,
      kind: b.kind,
      departmentId,
      positionIds: b.positionIds,
      opensAt: b.opensAt,
      closesAt: b.closesAt,
      maxAwardsPerPerson: b.maxAwardsPerPerson,
      seniorityBasis: basis,
      awardOrder,
      templateId: b.templateId ?? null,
      rangeFrom: b.from ? new Date(`${b.from}T00:00:00Z`) : null,
      rangeTo: b.to ? new Date(`${b.to}T00:00:00Z`) : null,
      createdById: a.userId,
    },
  });
  await tx.bidItem.createMany({ data: items.map((i, k) => ({ tenantId: a.tenantId, roundId: round.id, shiftIds: i.shiftIds, positionId: i.positionId, facilityId: i.facilityId, firstStartsAt: i.first, lastEndsAt: i.last, meta: i.meta, sortOrder: k })) });
  await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'bid.round.create', entity: 'BidRound', entityId: round.id, after: { name: b.name, kind: b.kind, items: items.length, opensAt: b.opensAt, closesAt: b.closesAt, maxAwardsPerPerson: b.maxAwardsPerPerson, seniorityBasis: basis, awardOrder } });
  await announceChange(tx, a.tenantId, 'bids');
  return round;
}

// ------------------------------------------------------------------------- who may bid, and rank

const eligibleWhere = (positionIds: string[]): Prisma.UserWhereInput => ({ status: 'ACTIVE', anonymizedAt: null, processingRestrictedAt: null, positions: { some: { positionId: { in: positionIds } } } });

/** Everyone who may bid in a round, most senior first (live, before the close; a snapshot after). */
export async function liveOrder(tx: Tx, round: { id: string; positionIds: string[]; seniorityBasis: Basis }) {
  const users = await tx.user.findMany({ where: eligibleWhere(round.positionIds), select: { id: true, firstName: true, lastName: true, seniorityDate: true, seniorityHours: true, hireDate: true } });
  return seniorityOrder(
    users.map((u) => ({ userId: u.id, name: `${u.firstName} ${u.lastName}`, seniorityDate: u.seniorityDate?.toISOString().slice(0, 10) ?? null, seniorityHours: Number(u.seniorityHours), hireDate: u.hireDate?.toISOString().slice(0, 10) ?? null, tiebreak: tiebreakOf(round.id, u.id) })),
    round.seniorityBasis,
  );
}

/** Replaces a person's ranking (only while the round is open, only items of positions they hold). */
export async function saveChoices(tx: Tx, a: AuthContext, roundId: string, itemIds: string[]) {
  const round = await tx.bidRound.findUnique({ where: { id: roundId }, include: { items: { select: { id: true, positionId: true } } } });
  if (!round || round.status === 'CANCELLED') throw notFound('Bid round');
  const holds = new Set((await tx.userPosition.findMany({ where: { userId: a.userId }, select: { positionId: true } })).map((p) => p.positionId));
  if (!round.positionIds.some((p) => holds.has(p))) throw notFound('Bid round');
  const now = new Date();
  if (round.status !== 'OPEN' || now < round.opensAt || now >= round.closesAt) throw conflict('BID_CLOSED', 'This round isn’t taking choices now.');
  if (new Set(itemIds).size !== itemIds.length || itemIds.length > MAX_CHOICES) throw badRequest('Rank each choice once.');
  const byId = new Map(round.items.map((i) => [i.id, i]));
  for (const id of itemIds) {
    const it = byId.get(id);
    if (!it) throw badRequest('That isn’t part of this round.');
    if (!holds.has(it.positionId)) throw badRequest('You can only rank shifts in positions you hold.');
  }
  await tx.bidChoice.deleteMany({ where: { roundId, userId: a.userId } });
  if (itemIds.length) await tx.bidChoice.createMany({ data: itemIds.map((itemId, i) => ({ tenantId: a.tenantId, roundId, userId: a.userId, itemId, rank: i + 1 })) });
  await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'bid.choices', entity: 'BidRound', entityId: roundId, after: { count: itemIds.length } });
  await announceChange(tx, a.tenantId, 'bids');
  return { count: itemIds.length };
}

// ------------------------------------------------------------------------- the check

interface Checker {
  check: (userId: string, itemId: string, won: readonly string[]) => string | null;
}

/** The Shift Board's check for every person × item, loaded once for the round. */
async function checker(tx: Tx, items: Array<{ id: string; shiftIds: string[] }>, userIds: string[]): Promise<Checker> {
  const cache: BundleCache = {};
  const bundles = new Map<string, ShiftBundle>();
  for (const id of new Set(items.flatMap((i) => i.shiftIds))) {
    const b = await loadShiftBundle(tx, id, cache);
    if (b) bundles.set(id, b);
  }
  const all = [...bundles.values()];
  const from = new Date(Math.min(...all.map((b) => b.shift.start.getTime())));
  const to = new Date(Math.max(...all.map((b) => b.shift.end.getTime())));
  const people = all.length ? await loadAssistantCandidates(tx, from, to, { id: { in: userIds } }) : [];
  const ctxOf = new Map<string, CandidateContext>(people.map((p) => [p.userId, p]));
  const itemShifts = new Map(items.map((i) => [i.id, i.shiftIds.map((s) => bundles.get(s)).filter((b): b is ShiftBundle => !!b)]));
  const memo = new Map<string, string | null>();
  return {
    check(userId, itemId, won) {
      const key = `${userId}|${itemId}|${won.join(',')}`;
      if (memo.has(key)) return memo.get(key)!;
      const base = ctxOf.get(userId);
      const shifts = itemShifts.get(itemId) ?? [];
      let code: string | null = !base ? 'NOT_ACTIVE' : shifts.length ? null : 'CHANGED';
      if (base && !code) {
        const extra = won.flatMap((w) => (itemShifts.get(w) ?? []).map((b) => ({ start: b.shift.start, end: b.shift.end, positionId: b.shift.positionId, facilityId: b.shift.facilityId, breakMinutes: b.shift.breakMinutes ?? 0 })));
        const ctx: CandidateContext = { ...base, existingShifts: [...base.existingShifts, ...extra] };
        for (const b of shifts) {
          const e = evaluateCandidate(ctx, b.shift, b.position, evalOpts(b));
          if (!e.eligible) code = e.blocks[0]!.code;
          else if (e.overtimeHours.gt(0)) code = 'OVERTIME';
          else if (tooLittleTravel(ctx, b.shift, b.travelMinutes * 60_000)) code = 'TRAVEL';
          if (code) break;
          ctx.existingShifts = [...ctx.existingShifts, { start: b.shift.start, end: b.shift.end, positionId: b.shift.positionId, facilityId: b.shift.facilityId, breakMinutes: b.shift.breakMinutes ?? 0 }];
        }
      }
      memo.set(key, code);
      return code;
    },
  };
}

// ------------------------------------------------------------------------- close, review, confirm

/** Closes a round: snapshot of the order, proposed awards and every choice's outcome. Status → REVIEW. */
export async function closeRound(tx: Tx, roundId: string, now = new Date()) {
  const round = await tx.bidRound.findUnique({ where: { id: roundId }, include: { items: true, choices: { orderBy: { rank: 'asc' } } } });
  if (!round || round.status !== 'OPEN') return null;
  const bidders = [...new Set(round.choices.map((c) => c.userId))];
  const users = await tx.user.findMany({ where: { id: { in: bidders }, ...eligibleWhere(round.positionIds) }, select: { id: true, seniorityDate: true, seniorityHours: true, hireDate: true } });
  const standing = seniorityOrder(
    users.map((u) => ({ userId: u.id, seniorityDate: u.seniorityDate?.toISOString().slice(0, 10) ?? null, seniorityHours: Number(u.seniorityHours), hireDate: u.hireDate?.toISOString().slice(0, 10) ?? null, tiebreak: tiebreakOf(round.id, u.id) })),
    round.seniorityBasis,
  );
  const c = await checker(tx, round.items, standing.map((s) => s.userId));
  const result = awardBids({ entrants: standing.map((s) => ({ userId: s.userId, choices: round.choices.filter((x) => x.userId === s.userId).map((x) => x.itemId) })), maxAwards: round.maxAwardsPerPerson, order: round.awardOrder, check: c.check });
  await tx.bidEntrant.deleteMany({ where: { roundId } });
  await tx.bidAward.deleteMany({ where: { roundId } });
  for (const [i, s] of standing.entries()) {
    await tx.bidEntrant.create({ data: { tenantId: round.tenantId, roundId, userId: s.userId, seniorityRank: i + 1, seniorityDate: s.seniorityDate ? new Date(`${s.seniorityDate}T00:00:00Z`) : null, seniorityHours: s.seniorityHours, hireDate: s.hireDate ? new Date(`${s.hireDate}T00:00:00Z`) : null, tiebreak: s.tiebreak, outcomes: (result.outcomes.get(s.userId) ?? []) as unknown as Prisma.InputJsonValue } });
  }
  if (result.awards.length) await tx.bidAward.createMany({ data: result.awards.map((x) => ({ tenantId: round.tenantId, roundId, itemId: x.itemId, userId: x.userId, pass: x.pass, choiceRank: x.choiceRank })) });
  await tx.bidRound.update({ where: { id: roundId }, data: { status: 'REVIEW', closedAt: now } });
  await audit(tx, { tenantId: round.tenantId, actorId: null, action: 'bid.round.close', entity: 'BidRound', entityId: roundId, after: { entrants: standing.length, awards: result.awards.length, items: round.items.length, basis: round.seniorityBasis, awardOrder: round.awardOrder } });
  // The round's creator (and whoever else can manage bids) is told the awards are ready to review.
  const managers = new Set([round.createdById, ...(await usersWithPermission(tx, round.tenantId, 'bidding.manage'))].filter((id) => id));
  await notify(tx, round.tenantId, [...managers].slice(0, 50).map((userId) => ({ userId, type: 'bid_round_review', params: { round: round.name }, link: `/manage/bids?round=${roundId}` })));
  await announceChange(tx, round.tenantId, 'bids');
  return { entrants: standing.length, awards: result.awards.length };
}

/** A manager gives an item to someone else (or nobody) before confirming. The reason is required and audited. */
export async function overrideAward(tx: Tx, a: AuthContext, roundId: string, itemId: string, userId: string | null, reason: string) {
  const round = await loadManaged(tx, a, roundId);
  if (round.status !== 'REVIEW') throw conflict('BID_NOT_IN_REVIEW', 'Awards can only be changed while the round is in review.');
  const item = round.items.find((i) => i.id === itemId);
  if (!item) throw notFound('Item');
  const current = await tx.bidAward.findUnique({ where: { roundId_itemId: { roundId, itemId } } });
  if (userId) {
    const ok = await tx.user.count({ where: { id: userId, ...eligibleWhere(round.positionIds), ...peopleWhere(a.scope) } });
    if (!ok) throw notFound('Person');
    const won = (await tx.bidAward.findMany({ where: { roundId, userId, NOT: { itemId } }, select: { itemId: true } })).map((x) => x.itemId);
    const code = (await checker(tx, round.items, [userId])).check(userId, itemId, won);
    if (code) throw new HttpError(422, 'NOT_ELIGIBLE', 'This person can’t work it.', { blocks: [{ code, message: code }] });
  }
  if (current) await tx.bidAward.delete({ where: { id: current.id } });
  if (userId) await tx.bidAward.create({ data: { tenantId: a.tenantId, roundId, itemId, userId, pass: current?.pass ?? 1, choiceRank: null, overridden: true, overrideReason: reason, overriddenById: a.userId, previousUserId: current?.userId ?? null } });
  // Outcomes: the previous winner's choice is now OVERRIDDEN; the new one's AWARDED.
  const touched = [current?.userId, userId].filter((x): x is string => !!x);
  for (const uid of touched) {
    const ent = await tx.bidEntrant.findUnique({ where: { roundId_userId: { roundId, userId: uid } } });
    const list = (ent?.outcomes as unknown as ChoiceOutcome[] | undefined) ?? [];
    const mine = list.find((o) => o.itemId === itemId);
    const result: Outcome = uid === userId ? 'AWARDED' : 'OVERRIDDEN';
    const next = mine ? list.map((o) => (o.itemId === itemId ? { ...o, result, code: undefined } : o)) : [...list, { itemId, rank: null, result }];
    if (ent) await tx.bidEntrant.update({ where: { id: ent.id }, data: { outcomes: next as unknown as Prisma.InputJsonValue } });
    else {
      const u = await tx.user.findUniqueOrThrow({ where: { id: uid }, select: { seniorityDate: true, seniorityHours: true, hireDate: true } });
      const last = await tx.bidEntrant.count({ where: { roundId } });
      await tx.bidEntrant.create({ data: { tenantId: a.tenantId, roundId, userId: uid, seniorityRank: last + 1, seniorityDate: u.seniorityDate, seniorityHours: u.seniorityHours, hireDate: u.hireDate, tiebreak: tiebreakOf(roundId, uid), outcomes: next as unknown as Prisma.InputJsonValue } });
    }
  }
  await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'bid.award.override', entity: 'BidRound', entityId: roundId, before: { itemId, userId: current?.userId ?? null }, after: { itemId, userId, reason } });
  await announceChange(tx, a.tenantId, 'bids');
  return { itemId, userId };
}

/**
 * Confirms: each award re-checked now under the shift and person locks (the world may have changed
 * since the close), assigned and published; every other shift of the round published and posted on
 * the Shift Board; everyone who bid told the result. Returns the board's events to record.
 */
export async function confirmRound(tx: Tx, a: AuthContext, roundId: string): Promise<{ assigned: number; posted: number; dropped: number; events: DomainEvent[] }> {
  const round = await loadManaged(tx, a, roundId);
  if (round.status !== 'REVIEW') throw conflict('BID_NOT_IN_REVIEW', 'Only a round in review can be confirmed.');
  const awards = await tx.bidAward.findMany({ where: { roundId } });
  const itemById = new Map(round.items.map((i) => [i.id, i]));
  const allShiftIds = round.items.flatMap((i) => i.shiftIds);
  await lockForAssignment(tx, { shiftIds: allShiftIds, userIds: awards.map((x) => x.userId) });
  const cache: BundleCache = {};
  let assigned = 0;
  let dropped = 0;
  const done = new Set<string>();
  const changed: Array<{ userId: string; itemId: string }> = [];
  for (const aw of awards) {
    const item = itemById.get(aw.itemId)!;
    // Every shift of the item must still be an open draft the person can work, or none is assigned.
    const plan: Array<{ id: string; version: number; overtime: string; positionId: string }> = [];
    let ok = true;
    for (const sid of item.shiftIds) {
      const b = await loadShiftBundle(tx, sid, cache);
      if (!b || b.shift.status !== 'DRAFT' || b.shift.userId) {
        ok = false;
        break;
      }
      const cand = await loadCandidate(tx, b, aw.userId);
      const e = cand && evaluateCandidate(cand, b.shift, b.position, evalOpts(b));
      if (!cand || !e || !e.eligible || e.overtimeHours.gt(0)) {
        ok = false;
        break;
      }
      plan.push({ id: sid, version: b.shift.version, overtime: e.overtimeHours.toFixed(2), positionId: b.shift.positionId });
    }
    if (ok) {
      for (const p of plan) {
        const r = await tx.shift.updateMany({ where: { id: p.id, version: p.version, status: 'DRAFT', userId: null }, data: { userId: aw.userId, status: 'PUBLISHED', version: { increment: 1 }, conflictReason: null } });
        if (!r.count) ok = false;
      }
    }
    if (!ok) {
      dropped++;
      changed.push({ userId: aw.userId, itemId: aw.itemId });
      await tx.bidAward.delete({ where: { id: aw.id } });
      continue;
    }
    assigned++;
    for (const sid of item.shiftIds) done.add(sid);
  }
  // Everything else in the round goes to the Shift Board.
  const events: DomainEvent[] = [];
  let posted = 0;
  const rest = await tx.shift.findMany({ where: { id: { in: allShiftIds.filter((s) => !done.has(s)) }, status: 'DRAFT', userId: null } });
  if (rest.length) await tx.shift.updateMany({ where: { id: { in: rest.map((s) => s.id) } }, data: { status: 'PUBLISHED', version: { increment: 1 } } });
  for (const s of rest.filter((x) => x.startsAt > new Date())) {
    const r = await postOffer(tx, { userId: a.userId, tenantId: a.tenantId, canPostOpenShifts: true }, s.id);
    events.push(...r.events);
    posted++;
  }
  // Outcomes for awards dropped at confirmation.
  for (const ch of changed) {
    const ent = await tx.bidEntrant.findUnique({ where: { roundId_userId: { roundId, userId: ch.userId } } });
    if (ent) await tx.bidEntrant.update({ where: { id: ent.id }, data: { outcomes: ((ent.outcomes as unknown as ChoiceOutcome[]) ?? []).map((o) => (o.itemId === ch.itemId ? { ...o, result: 'CHANGED' as const } : o)) as unknown as Prisma.InputJsonValue } });
  }
  await tx.bidRound.update({ where: { id: roundId }, data: { status: 'AWARDED', confirmedAt: new Date(), confirmedById: a.userId } });
  const entrants = await tx.bidEntrant.findMany({ where: { roundId } });
  const finalAwards = await tx.bidAward.findMany({ where: { roundId }, select: { userId: true } });
  const drafts: NotificationDraft[] = entrants.map((e) => {
    const n = finalAwards.filter((x) => x.userId === e.userId).length;
    return { userId: e.userId, type: n ? 'bid_awarded' : 'bid_not_awarded', params: { round: round.name, count: n }, link: `/bids?round=${roundId}` };
  });
  await notify(tx, a.tenantId, drafts);
  await tx.bidEntrant.updateMany({ where: { roundId }, data: { notifiedAt: new Date() } });
  await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'bid.round.confirm', entity: 'BidRound', entityId: roundId, after: { assigned, posted, dropped } });
  await announceChange(tx, a.tenantId, 'bids');
  return { assigned, posted, dropped, events };
}

export async function cancelRound(tx: Tx, a: AuthContext, roundId: string) {
  const round = await loadManaged(tx, a, roundId);
  if (round.status === 'AWARDED' || round.status === 'CANCELLED') throw conflict('BID_FINISHED', 'This round is already finished.');
  await tx.bidRound.update({ where: { id: roundId }, data: { status: 'CANCELLED', cancelledAt: new Date() } });
  await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'bid.round.cancel', entity: 'BidRound', entityId: roundId });
  await announceChange(tx, a.tenantId, 'bids');
}

/** A round the manager may act on: every position in their scope. */
async function loadManaged(tx: Tx, a: AuthContext, roundId: string) {
  const round = await tx.bidRound.findUnique({ where: { id: roundId }, include: { items: { orderBy: { sortOrder: 'asc' } } } });
  if (!round) throw notFound('Bid round');
  const allowed = new Set((await schedulableDepartments(tx, a)).flatMap((d) => d.positionIds));
  if (!round.positionIds.every((p) => allowed.has(p))) throw notFound('Bid round');
  return round;
}

/** Rounds a manager may see (their departments), or, for an observer (steward), every round once closed. */
export async function visibleRounds(tx: Tx, a: AuthContext) {
  const manage = a.permissions.has('bidding.manage');
  const allowed = manage ? new Set((await schedulableDepartments(tx, a)).flatMap((d) => d.positionIds)) : null;
  const rows = await tx.bidRound.findMany({ orderBy: { closesAt: 'desc' }, take: 100, include: { _count: { select: { items: true, entrants: true } } } });
  return rows.filter((r) => (allowed ? r.positionIds.every((p) => allowed.has(p)) : r.status === 'REVIEW' || r.status === 'AWARDED'));
}

/** Who sees a round's detail: its managers, or an observer once it has closed. */
export async function canSeeRound(tx: Tx, a: AuthContext, round: { positionIds: string[]; status: string }) {
  if (a.permissions.has('bidding.manage')) {
    const allowed = new Set((await schedulableDepartments(tx, a)).flatMap((d) => d.positionIds));
    if (round.positionIds.every((p) => allowed.has(p))) return 'manage' as const;
  }
  if (a.permissions.has('bidding.observe') && (round.status === 'REVIEW' || round.status === 'AWARDED')) return 'observe' as const;
  return null;
}

// ------------------------------------------------------------------------- worker and retention

/** Every minute: tells eligible staff when a round opens, and closes rounds whose time is up. */
export async function bidRoundTick(tx: Tx, now = new Date()): Promise<number> {
  if (!(await biddingOn(tx))) return 0;
  let n = 0;
  const opening = await tx.bidRound.findMany({ where: { status: 'OPEN', openedNotifiedAt: null, opensAt: { lte: now }, closesAt: { gt: now } } });
  for (const r of opening) {
    const people = await tx.user.findMany({ where: eligibleWhere(r.positionIds), select: { id: true } });
    await notify(tx, r.tenantId, people.map((p) => ({ userId: p.id, type: 'bid_round_open', params: { round: r.name, closesAt: r.closesAt.toISOString() }, link: `/bids?round=${r.id}` })));
    await tx.bidRound.update({ where: { id: r.id }, data: { openedNotifiedAt: now } });
    await announceChange(tx, r.tenantId, 'bids');
    n++;
  }
  for (const r of await tx.bidRound.findMany({ where: { status: 'OPEN', closesAt: { lte: now } }, select: { id: true } })) {
    if (await closeRound(tx, r.id, now)) n++;
  }
  return n;
}

/** Retention: rankings and outcomes of rounds finished BID_RETENTION_DAYS ago (awards stay: they are the schedule). */
export async function purgeOldBids(tx: Tx, now = new Date()): Promise<number> {
  const before = new Date(now.getTime() - BID_RETENTION_DAYS * 86_400_000);
  const old = await tx.bidRound.findMany({ where: { OR: [{ confirmedAt: { lt: before } }, { cancelledAt: { lt: before } }] }, select: { id: true } });
  if (!old.length) return 0;
  const ids = old.map((r) => r.id);
  const a = await tx.bidChoice.deleteMany({ where: { roundId: { in: ids } } });
  const b = await tx.bidEntrant.deleteMany({ where: { roundId: { in: ids } } });
  return a.count + b.count;
}
