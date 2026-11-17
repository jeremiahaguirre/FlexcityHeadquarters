/**
 * Pay that has been approved or paid is fixed: a regular pay run that is APPROVED or PAID has put
 * its hours, rates and leave on pay statements. Changing what it used (a rate, a punch, leave)
 * would make the record disagree with what was paid, so such corrections go through a one-time
 * item on a later run instead.
 */
import type { Tx } from '../../lib/db.js';
import { conflict } from '../../lib/errors.js';

/**
 * The approved or paid regular run covering any day from `first` to `last` (YYYY-MM-DD) that paid this
 * person (a statement for them), or that covers them now (city-wide, or one of their departments).
 */
export async function paidRunCovering(tx: Tx, userId: string, first: string, last: string) {
  if (last < first) return null;
  const departments = (await tx.userPosition.findMany({ where: { userId }, select: { position: { select: { departmentId: true } } } })).map((p) => p.position.departmentId).filter((d): d is string => !!d);
  return tx.payRun.findFirst({
    where: {
      kind: 'REGULAR',
      status: { in: ['APPROVED', 'PAID'] },
      periodStart: { lte: new Date(`${last}T00:00:00Z`) },
      periodEnd: { gte: new Date(`${first}T00:00:00Z`) },
      // A statement for them is the record of having paid them, even after they moved department.
      OR: [{ statements: { some: { userId } } }, { departmentId: null }, ...(departments.length ? [{ departmentId: { in: departments } }] : [])],
    },
    select: { id: true, periodStart: true, periodEnd: true },
  });
}

/** Refuses with 409 PERIOD_PAID when a paid or approved run covers those days. */
export async function assertNotPaid(tx: Tx, userId: string, first: string, last: string) {
  const run = await paidRunCovering(tx, userId, first, last);
  if (run) throw conflict('PERIOD_PAID', 'This is in a pay period that was already approved or paid. Correct it with a one-time item on the next pay run.', { payRunId: run.id });
}
