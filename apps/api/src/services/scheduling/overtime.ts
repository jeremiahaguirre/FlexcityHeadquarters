/**
 * Overtime equalization. Most municipal collective agreements say overtime is
 * offered in order: fewest overtime hours charged this period first, then
 * seniority. Refused offers are often charged as if worked. This keeps the
 * ledger and warns before a supervisor skips someone who is next in line.
 */
import { resolveFeatures } from '../platform/features.js';
import type { Tx } from '../../lib/db.js';
import { dec } from '../../lib/money.js';
import { evaluateCandidate } from './eligibility.js';
import { evalOpts, loadCandidate, loadShiftBundle } from './eligibilityLoader.js';
import { effectiveSettings, parseSolverSettings } from './solverSettings.js';

export interface OvertimePolicy { countRefusals: boolean; clause: string | null; periodStartMonth: number }

export function parsePolicy(stored: unknown): OvertimePolicy {
  const s = stored && typeof stored === 'object' ? (stored as Record<string, unknown>) : {};
  const m = Number(s.periodStartMonth);
  return {
    countRefusals: typeof s.countRefusals === 'boolean' ? s.countRefusals : true,
    clause: typeof s.clause === 'string' && s.clause.trim() ? s.clause.trim() : null,
    periodStartMonth: Number.isInteger(m) && m >= 1 && m <= 12 ? m : 1,
  };
}

/** Start of the current equalization period (the most recent occurrence of the start month). */
export function periodStart(now: Date, month: number): Date {
  const y = now.getUTCMonth() + 1 >= month ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  return new Date(Date.UTC(y, month - 1, 1));
}

export interface Standing { userId: string; name: string; chargedHours: number; acceptedHours: number; refusals: number; seniorityDate: string | null; seniorityHours: number }

/** Lower charged hours first; ties go to the more senior person (earlier date, then more hours). */
export function rank(a: Standing, b: Standing): number {
  return a.chargedHours - b.chargedHours || (a.seniorityDate ?? '9999').localeCompare(b.seniorityDate ?? '9999') || b.seniorityHours - a.seniorityHours || a.name.localeCompare(b.name);
}

export async function standings(tx: Tx, positionId: string, now = new Date()) {
  const [tenant, position] = await Promise.all([tx.tenant.findFirstOrThrow({ select: { overtimePolicy: true, features: true } }), tx.position.findUnique({ where: { id: positionId }, select: { departmentId: true } })]);
  const policy = parsePolicy(tenant.overtimePolicy);
  // Organizations (or departments) that don't use seniority: ties go by name, and no seniority is
  // shown. A department's own switch can turn it off where its agreement doesn't use it.
  const useSeniority = effectiveSettings(parseSolverSettings(tenant.overtimePolicy), position?.departmentId ?? null, resolveFeatures(tenant.features).seniority).useSeniority;
  const from = periodStart(now, policy.periodStartMonth);
  const users = await tx.user.findMany({
    where: { status: 'ACTIVE', anonymizedAt: null, positions: { some: { positionId } } },
    select: { id: true, firstName: true, lastName: true, seniorityDate: true, seniorityHours: true },
  });
  const entries = await tx.overtimeEntry.findMany({ where: { userId: { in: users.map((u) => u.id) }, occurredAt: { gte: from } } });
  const rows: Standing[] = users.map((u) => {
    const mine = entries.filter((e) => e.userId === u.id);
    const sum = (k: string) => mine.filter((e) => e.kind === k).reduce((s, e) => s + Number(e.hours), 0);
    const accepted = sum('ACCEPTED');
    return {
      userId: u.id,
      name: `${u.firstName} ${u.lastName}`,
      acceptedHours: accepted,
      chargedHours: accepted + (policy.countRefusals ? sum('REFUSED') + sum('NO_ANSWER') : 0),
      refusals: mine.filter((e) => e.kind !== 'ACCEPTED').length,
      seniorityDate: useSeniority && u.seniorityDate ? u.seniorityDate.toISOString().slice(0, 10) : null,
      seniorityHours: useSeniority ? Number(u.seniorityHours) : 0,
    };
  });
  return { policy, useSeniority, periodFrom: from.toISOString().slice(0, 10), rows: rows.sort(rank) };
}

/**
 * Before giving overtime on a shift to someone: who is ahead of them in line,
 * eligible for this shift, and would be skipped.
 */
export async function fairnessCheck(tx: Tx, shiftId: string, userId: string) {
  const bundle = await loadShiftBundle(tx, shiftId);
  if (!bundle) return null;
  const c = await loadCandidate(tx, bundle, userId);
  if (!c) return null;
  const e = evaluateCandidate(c, bundle.shift, bundle.position, evalOpts(bundle));
  if (!e.overtimeHours.gt(0)) return { overtime: false as const, overtimeHours: '0.00', skipped: [], clause: null };
  const { rows, policy } = await standings(tx, bundle.shift.positionId);
  const me = rows.find((r) => r.userId === userId);
  const ahead = me ? rows.filter((r) => r.userId !== userId && rank(r, me) < 0) : [];
  const skipped: Array<Standing> = [];
  for (const r of ahead) {
    const other = await loadCandidate(tx, bundle, r.userId);
    if (other && evaluateCandidate(other, bundle.shift, bundle.position, evalOpts(bundle)).eligible) skipped.push(r);
    if (skipped.length >= 5) break;
  }
  return { overtime: true as const, overtimeHours: e.overtimeHours.toFixed(2), skipped, clause: policy.clause };
}

/**
 * When an assignment with charged overtime is undone (unassigned, reassigned, cancelled or a Fill
 * accept undone) before it's worked, the charge comes off the ledger: a reversing entry, so the
 * history stays. Refusals and no-answers stay as the agreement counts them.
 */
export async function reverseOvertime(tx: Tx, tenantId: string, actorId: string, userId: string, shiftId: string, note: string) {
  const rows = await tx.overtimeEntry.findMany({ where: { userId, shiftId, kind: 'ACCEPTED' }, select: { hours: true, positionId: true } });
  const net = rows.reduce((s, r) => s.plus(dec(r.hours)), dec(0));
  if (!net.gt(0)) return;
  await tx.overtimeEntry.create({ data: { tenantId, userId, shiftId, positionId: rows[0]?.positionId ?? null, kind: 'ACCEPTED', hours: net.neg().toFixed(2), occurredAt: new Date(), recordedById: actorId, note } });
}

/** Called when overtime is approved or assigned: charge the hours to the person. */
export async function chargeOvertime(tx: Tx, tenantId: string, actorId: string, userId: string, shiftId: string, hours: string, positionId: string) {
  if (!dec(hours).gt(0)) return;
  await tx.overtimeEntry.create({ data: { tenantId, userId, shiftId, positionId, kind: 'ACCEPTED', hours, occurredAt: new Date(), recordedById: actorId } });
}
