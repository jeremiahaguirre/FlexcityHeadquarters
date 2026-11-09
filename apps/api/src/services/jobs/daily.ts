/**
 * Recurring jobs. Each one is idempotent: running it twice in a row changes
 * nothing the second time, so overlapping or retried runs are safe.
 */
import type { Tx } from '../../lib/db.js';
import { notify, usersWithRoles } from '../notifications/notifier.js';
import { anonymizeUser } from '../privacy/erasure.js';
import { computeReliability } from '../reliability/score.js';

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const dayStart = (iso: string) => new Date(`${iso}T00:00:00Z`);

/** Nightly: store each active person's advisory reliability score. */
export async function recomputeReliability(tx: Tx, now = new Date()): Promise<number> {
  const users = await tx.user.findMany({ where: { status: 'ACTIVE', anonymizedAt: null }, select: { id: true, reliabilityScore: true } });
  let changed = 0;
  for (const u of users) {
    const [events, leave] = await Promise.all([
      tx.reliabilityEvent.findMany({ where: { userId: u.id, occurredAt: { gte: new Date(now.getTime() - 91 * 86_400_000) } } }),
      tx.timeOffRequest.findMany({ where: { userId: u.id } }),
    ]);
    const { score } = computeReliability(events, leave, now);
    if (score !== u.reliabilityScore) {
      await tx.user.update({ where: { id: u.id }, data: { reliabilityScore: score } });
      changed++;
    }
  }
  return changed;
}

export const REMINDER_DAYS = [90, 60, 30, 7] as const;

/** Certification reminders at 90/60/30/7 days; supervisors hear at 30 and 7. */
export async function certificationReminders(tx: Tx, now = new Date()): Promise<number> {
  let sent = 0;
  const supervisors = await usersWithRoles(tx, ['AQUATIC_SUPERVISOR']);
  for (const days of REMINDER_DAYS) {
    const target = isoDay(new Date(now.getTime() + days * 86_400_000));
    const certs = await tx.userCertification.findMany({
      where: { expiryDate: dayStart(target), verifiedAt: { not: null }, user: { status: 'ACTIVE', anonymizedAt: null } },
      include: { certification: { select: { name: true } }, user: { select: { firstName: true, lastName: true } } },
    });
    for (const c of certs) {
      const already = await tx.notification.findFirst({ where: { userId: c.userId, type: 'cert_expiring', params: { equals: { userCertificationId: c.id, days, certification: c.certification.name, expiryDate: target } } } });
      if (already) continue;
      const params = { userCertificationId: c.id, days, certification: c.certification.name, expiryDate: target };
      await notify(tx, c.tenantId, [
        { userId: c.userId, type: 'cert_expiring', params, link: '/profile', email: 'cert_expiring' },
        ...(days <= 30
          ? supervisors.map((id) => ({ userId: id, type: 'staff_cert_expiring', params: { ...params, name: `${c.user.firstName} ${c.user.lastName}` }, link: '/manage/certifications' }))
          : []),
      ]);
      sent++;
    }
  }
  return sent;
}

/** Nudge anyone still clocked in 14 hours after clocking in (once per punch). */
export async function forgottenClockOuts(tx: Tx, now = new Date()): Promise<number> {
  const open = await tx.timePunch.findMany({ where: { clockOut: null, clockIn: { lt: new Date(now.getTime() - 14 * 3_600_000) } } });
  let n = 0;
  for (const p of open) {
    const already = await tx.notification.findFirst({ where: { userId: p.userId, type: 'forgot_clock_out', params: { equals: { punchId: p.id } } } });
    if (already) continue;
    await notify(tx, p.tenantId, [{ userId: p.userId, type: 'forgot_clock_out', params: { punchId: p.id }, link: '/timeclock' }]);
    n++;
  }
  return n;
}

/** Anonymize people whose payroll retention has ended. */
export async function anonymizeDue(tx: Tx, now = new Date()): Promise<number> {
  const due = await tx.user.findMany({ where: { anonymizedAt: null, erasureDueAt: { lte: dayStart(isoDay(now)) } }, select: { id: true, tenantId: true } });
  for (const u of due) await anonymizeUser(tx, u.tenantId, null, u.id);
  return due.length;
}
