/**
 * Time in lieu: overtime banked as paid time off instead of paid out, where the
 * city allows it and the person agreed (Ontario ESA s. 22(7), and most municipal
 * collective agreements).
 *
 * Overtime banks at its premium: an hour at time and a half banks 1.5 hours. The
 * bank is worked out from approved and paid pay runs (what each banked, paid as
 * time off, or paid out) plus HR's corrections, so voiding a run takes its
 * banking with it. Time older than the city's limit is flagged to be taken or
 * paid out; a person leaving with banked time is flagged to be paid out.
 *
 * Vacation pay is paid on overtime when it's worked, banked or not, and not again
 * when banked time is taken or paid out.
 */
import type { Tx } from '../../lib/db.js';
import type { PayrollSettings } from './payRuns.js';
import { weekdayLeaveHours } from '../people/leaveHours.js';

export interface LieuPolicy {
  enabled: boolean;
  /** Most hours a person may hold; overtime beyond it is paid. */
  capHours: number;
  /** Banked time older than this is flagged to be taken or paid out (ESA: 3 months, or 12 by agreement). */
  takeWithinMonths: number;
}

export const lieuPolicy = (s: PayrollSettings): LieuPolicy => ({
  enabled: s.lieu?.enabled ?? false,
  capHours: s.lieu?.capHours ?? 80,
  takeWithinMonths: s.lieu?.takeWithinMonths ?? 12,
});

/** What a statement records about the bank. */
export interface StatementLieu { banked: number; otHours: number; taken: number; paidOut: number }

const r2 = (n: number) => Math.round(n * 100) / 100;
export const OT_MULTIPLIER: Record<string, number> = { OVERTIME_1_5: 1.5, OVERTIME_2_0: 2 };

export interface Bank {
  balance: number;
  /** Hours banked, oldest first, still unused (first in, first out). */
  open: Array<{ on: string; hours: number }>;
  history: Array<{ on: string; kind: 'BANKED' | 'TAKEN' | 'PAID_OUT' | 'ADJUSTED'; hours: number; note?: string; payRunId?: string }>;
}

/** Each person's bank from approved and paid runs and HR's corrections. */
export async function banks(tx: Tx, userIds: string[], opts: { excludeRunId?: string } = {}): Promise<Map<string, Bank>> {
  const out = new Map<string, Bank>(userIds.map((u) => [u, { balance: 0, open: [], history: [] }]));
  if (!userIds.length) return out;
  const [statements, adjustments] = await Promise.all([
    tx.payStatement.findMany({
      where: { userId: { in: userIds }, payRun: { status: { in: ['APPROVED', 'PAID'] } }, ...(opts.excludeRunId ? { payRunId: { not: opts.excludeRunId } } : {}) },
      select: { userId: true, payDate: true, payRunId: true, deductions: true },
      orderBy: { payDate: 'asc' },
    }),
    tx.lieuAdjustment.findMany({ where: { userId: { in: userIds } }, orderBy: { createdAt: 'asc' } }),
  ]);
  type Ev = { userId: string; on: string; kind: Bank['history'][number]['kind']; hours: number; note?: string; payRunId?: string };
  const events: Ev[] = [];
  for (const st of statements) {
    const l = (st.deductions as { lieu?: StatementLieu }).lieu;
    if (!l) continue;
    const on = st.payDate.toISOString().slice(0, 10);
    if (l.banked) events.push({ userId: st.userId, on, kind: 'BANKED', hours: l.banked, payRunId: st.payRunId });
    if (l.taken) events.push({ userId: st.userId, on, kind: 'TAKEN', hours: -l.taken, payRunId: st.payRunId });
    if (l.paidOut) events.push({ userId: st.userId, on, kind: 'PAID_OUT', hours: -l.paidOut, payRunId: st.payRunId });
  }
  for (const a of adjustments) events.push({ userId: a.userId, on: a.createdAt.toISOString().slice(0, 10), kind: 'ADJUSTED', hours: Number(a.hours), note: a.note });
  events.sort((x, y) => x.on.localeCompare(y.on));
  for (const e of events) {
    const b = out.get(e.userId)!;
    b.history.push({ on: e.on, kind: e.kind, hours: e.hours, ...(e.note ? { note: e.note } : {}), ...(e.payRunId ? { payRunId: e.payRunId } : {}) });
    b.balance = r2(b.balance + e.hours);
    if (e.hours > 0) b.open.push({ on: e.on, hours: e.hours });
    else {
      // Used hours come out of the oldest banked time first.
      let use = -e.hours;
      while (use > 0 && b.open.length) {
        const first = b.open[0]!;
        const take = Math.min(first.hours, use);
        first.hours = r2(first.hours - take);
        use = r2(use - take);
        if (first.hours <= 0) b.open.shift();
      }
    }
  }
  return out;
}

/** Banked hours older than the city's limit on a date. */
export function expiredHours(b: Bank, policy: LieuPolicy, asOf: string): number {
  const limit = new Date(`${asOf}T00:00:00Z`);
  limit.setUTCMonth(limit.getUTCMonth() - policy.takeWithinMonths);
  const cutoff = limit.toISOString().slice(0, 10);
  return r2(b.open.filter((o) => o.on < cutoff).reduce((a, o) => a + o.hours, 0));
}

/**
 * Takes overtime lines out of pay and into the bank, up to the cap. A line that
 * would pass the cap is split: the part that fits is banked, the rest is paid.
 */
export function bankOvertime<L extends { code: string; hours: number; rate: number; amount: number }>(lines: L[], room: number): { lines: L[]; banked: number; otHours: number } {
  let left = Math.max(0, room);
  let banked = 0;
  let otHours = 0;
  const out: L[] = [];
  for (const l of lines) {
    const m = OT_MULTIPLIER[l.code];
    if (!m || left <= 0 || l.hours <= 0) {
      out.push(l);
      continue;
    }
    const fits = Math.min(l.hours, left / m);
    const h = r2(fits);
    banked = r2(banked + h * m);
    otHours = r2(otHours + h);
    left = r2(left - h * m);
    const rest = r2(l.hours - h);
    if (rest > 0) out.push({ ...l, hours: rest, amount: r2((l.amount * rest) / l.hours) });
  }
  return { lines: out, banked, otHours };
}

/** The person's regular hourly rate on a date: for the given position if they have one, else their most recent. */
export async function regularRate(tx: Tx, userId: string, onDate: string, positionId?: string | null): Promise<number | null> {
  const d = new Date(onDate);
  const rates = await tx.payRate.findMany({ where: { userId, effectiveFrom: { lte: d }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: d } }] }, orderBy: { effectiveFrom: 'desc' } });
  const r = (positionId ? rates.find((x) => x.positionId === positionId) : undefined) ?? rates[0];
  return r ? Number(r.hourlyRate) : null;
}

/**
 * Hours a person can still ask for: their bank, less time off from it that's approved or
 * pending but not yet paid in an approved run (the pay run checks again when it's built).
 */
export async function lieuAvailable(tx: Tx, userId: string, ignoreRequestId?: string): Promise<number> {
  const bank = (await banks(tx, [userId])).get(userId)!;
  const last = await tx.payRun.findFirst({ where: { kind: 'REGULAR', status: { in: ['APPROVED', 'PAID'] }, statements: { some: { userId } } }, orderBy: { periodEnd: 'desc' }, select: { periodEnd: true } });
  const after = last ? new Date(last.periodEnd.getTime() + 86_400_000) : new Date(0);
  const reqs = await tx.timeOffRequest.findMany({ where: { userId, type: 'LIEU', status: { in: ['APPROVED', 'PENDING'] }, startsAt: { gte: after }, ...(ignoreRequestId ? { id: { not: ignoreRequestId } } : {}) } });
  const committed = reqs.reduce((a, r) => a + (r.chargedHours != null ? Number(r.chargedHours) : weekdayLeaveHours(r.startsAt, r.endsAt)), 0);
  return r2(bank.balance - committed);
}
