/**
 * Recurring jobs. Each one is idempotent: running it twice in a row changes
 * nothing the second time, so overlapping or retried runs are safe.
 */
import type { Tx } from '../../lib/db.js';
import { notify, usersWithRoles } from '../notifications/notifier.js';
import { anonymizeUser } from '../privacy/erasure.js';
import { computeReliability } from '../reliability/score.js';
import { reviewList } from '../people/reviewList.js';
import { overdueRotations } from '../ops/rotation.js';

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

/**
 * Missed shifts: a published shift that ended at least an hour ago with no punch
 * for it, while the person had no time off covering it. Supervisors can excuse
 * a mistaken one (forgot to punch but worked), and punch review can add the punch.
 */
export async function detectNoShows(tx: Tx, now = new Date()): Promise<number> {
  const shifts = await tx.shift.findMany({
    where: { status: 'PUBLISHED', userId: { not: null }, endsAt: { gte: new Date(now.getTime() - 48 * 3_600_000), lte: new Date(now.getTime() - 3_600_000) } },
    select: { id: true, tenantId: true, userId: true, startsAt: true, endsAt: true },
  });
  let created = 0;
  for (const s of shifts) {
    const userId = s.userId!;
    const [already, punch, leave] = await Promise.all([
      tx.reliabilityEvent.findFirst({ where: { userId, sourceId: s.id }, select: { id: true } }),
      tx.timePunch.findFirst({
        where: { userId, OR: [{ shiftId: s.id }, { clockIn: { lt: s.endsAt }, OR: [{ clockOut: null }, { clockOut: { gt: s.startsAt } }] }] },
        select: { id: true },
      }),
      tx.timeOffRequest.findFirst({ where: { userId, status: { in: ['APPROVED', 'PENDING'] }, startsAt: { lt: s.endsAt }, endsAt: { gt: s.startsAt } }, select: { id: true } }),
    ]);
    if (already || punch || leave) continue;
    await tx.reliabilityEvent.create({ data: { tenantId: s.tenantId, userId, type: 'NO_SHOW', occurredAt: s.startsAt, sourceId: s.id } });
    created++;
  }
  return created;
}

/**
 * Flags people for review when their facts cross a threshold, and tells HR and
 * supervisors once (not every night). Clears the flag when things improve.
 */
export async function flagForReview(tx: Tx, now = new Date()): Promise<number> {
  const rows = await reviewList(tx, now);
  const reviewers = await usersWithRoles(tx, ['HR_ADMIN', 'AQUATIC_SUPERVISOR']);
  let flagged = 0;
  for (const r of rows) {
    const substantive = r.review.flags.some((f) => f.code !== 'UNSIGNED_RECORD');
    if (substantive && !r.flaggedSince) {
      await tx.user.update({ where: { id: r.id }, data: { reviewFlaggedAt: now } });
      await notify(
        tx,
        r.tenantId,
        reviewers.filter((id) => id !== r.id).map((userId) => ({ userId, type: 'review_needed', params: { name: r.name }, link: `/manage/staff/person?id=${r.id}` })),
      );
      flagged++;
    } else if (!substantive && r.flaggedSince) {
      await tx.user.update({ where: { id: r.id }, data: { reviewFlaggedAt: null } });
    }
  }
  return flagged;
}

/**
 * Every minute: tell the head guards and supervisors on duty at that facility
 * (or all supervisors if none is clocked in) when a rotation is overdue, and
 * the guard on the chair. Once per rotation.
 */
export async function rotationAlerts(tx: Tx, now = new Date()): Promise<number> {
  const due = await overdueRotations(tx, now);
  for (const log of due) {
    const leads = await tx.timePunch.findMany({
      where: { facilityId: log.facilityId, clockOut: null, user: { roles: { hasSome: ['HEAD_LIFEGUARD', 'AQUATIC_SUPERVISOR'] } } },
      select: { userId: true },
    });
    const to = leads.length ? leads.map((l) => l.userId) : await usersWithRoles(tx, ['AQUATIC_SUPERVISOR']);
    const station = log.stationId ? await tx.deckStation.findUnique({ where: { id: log.stationId }, select: { name: true } }) : null;
    await notify(tx, log.tenantId, [...new Set([...to, log.userId])].map((userId) => ({ userId, type: 'rotation_overdue', params: { station: station?.name ?? '' }, link: '/deck' })));
    await tx.rotationLog.update({ where: { id: log.id }, data: { overdueNotifiedAt: now } });
  }
  return due.length;
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
