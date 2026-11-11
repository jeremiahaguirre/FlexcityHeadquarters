/**
 * Per-shift and per-person advisory locks for every write that assigns someone: manual assign,
 * the Shift Board, Fill accept, the planner, trades and call-outs. Two writers can then never
 * both pass the eligibility check for the same person (e.g. two departments filling at once and
 * double-booking someone they share).
 *
 * Order is always: shifts (sorted), then people (sorted). Locks are transaction-scoped and
 * re-entrant within a transaction, so taking them again further down (assignShift inside the
 * planner) is harmless.
 */
import { type Tx, advisoryLock } from '../../lib/db.js';

export async function lockForAssignment(tx: Tx, keys: { shiftIds?: ReadonlyArray<string | null | undefined>; userIds?: ReadonlyArray<string | null | undefined> }): Promise<void> {
  const uniq = (xs: ReadonlyArray<string | null | undefined> = []) => [...new Set(xs.filter((x): x is string => !!x))].sort();
  for (const id of uniq(keys.shiftIds)) await advisoryLock(tx, `shift:${id}`);
  for (const id of uniq(keys.userIds)) await advisoryLock(tx, `user:${id}`);
}
