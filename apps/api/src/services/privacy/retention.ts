/**
 * Routine records aren't kept forever. Each organization sets how long; these are the defaults.
 * - In-app notifications: 2 years.
 * - The email log (who was sent which kind of email, never the contents): 90 days.
 * - Families (and the children in them) with no registration or purchase for 3 years: names,
 *   birth dates, contacts and safety notes removed; payment records stay, as "Former family".
 * - Facility booking requests: the requester's contact details, 2 years after the booking.
 * - Working-alone check-in locations: 30 days after the session ended.
 * - Ended sign-in sessions and used or expired one-time links: 30 days (not configurable).
 * The audit log is kept for the life of the account (it's append-only, and part of the
 * organization's records); offboarding deletes it with everything else.
 */
import type { Tx } from '../../lib/db.js';

export const RETENTION_DEFAULTS = { notificationsDays: 730, emailLogDays: 90, familiesInactiveDays: 1095, bookingsDays: 730 } as const;
export const RETENTION_LIMITS = { notificationsDays: [90, 3650], emailLogDays: [30, 3650], familiesInactiveDays: [365, 3650], bookingsDays: [180, 3650] } as const;
export type Retention = { notificationsDays: number; emailLogDays: number; familiesInactiveDays: number; bookingsDays: number };

export function readRetention(raw: unknown): Retention {
  const r = raw && typeof raw === 'object' ? (raw as Partial<Retention>) : {};
  const pick = (k: keyof Retention) => {
    const v = Number(r[k]);
    const [lo, hi] = RETENTION_LIMITS[k];
    return Number.isFinite(v) && v >= lo && v <= hi ? v : RETENTION_DEFAULTS[k];
  };
  return { notificationsDays: pick('notificationsDays'), emailLogDays: pick('emailLogDays'), familiesInactiveDays: pick('familiesInactiveDays'), bookingsDays: pick('bookingsDays') };
}

const ago = (now: Date, days: number) => new Date(now.getTime() - days * 86_400_000);

/** Runs inside one organization's context (the worker calls it for each). Returns rows removed. */
export async function applyRetention(tx: Tx, now = new Date()): Promise<number> {
  const t = await tx.tenant.findFirst({ select: { retentionSettings: true } });
  if (!t) return 0;
  const r = readRetention(t.retentionSettings);
  const n = await tx.notification.deleteMany({ where: { createdAt: { lt: ago(now, r.notificationsDays) } } });
  // Only finished emails: anything still waiting to go out stays.
  const e = await tx.emailOutbox.deleteMany({ where: { createdAt: { lt: ago(now, r.emailLogDays) }, OR: [{ sentAt: { not: null } }, { attempts: { gte: 5 } }] } });
  const old = ago(now, 30);
  const s = await tx.refreshToken.deleteMany({ where: { OR: [{ expiresAt: { lt: old } }, { revokedAt: { lt: old } }] } });
  const l = await tx.authToken.deleteMany({ where: { OR: [{ expiresAt: { lt: old } }, { usedAt: { lt: old } }] } });
  const g = await tx.loneWorkSession.updateMany({ where: { status: { not: 'ACTIVE' }, lastCheckInAt: { lt: old }, OR: [{ latitude: { not: null } }, { longitude: { not: null } }] }, data: { latitude: null, longitude: null } });
  const b = await tx.bookingRequest.updateMany({ where: { endsAt: { lt: ago(now, r.bookingsDays) }, NOT: { name: 'Former requester' } }, data: { name: 'Former requester', email: '', phone: '', organization: null, notes: null } });
  return n.count + e.count + s.count + l.count + g.count + b.count + (await forgetInactiveFamilies(tx, ago(now, r.familiesInactiveDays)));
}

/** Families with no registration or purchase since `before`: their personal details go; their payment records stay. */
async function forgetInactiveFamilies(tx: Tx, before: Date): Promise<number> {
  const stale = await tx.household.findMany({
    where: { createdAt: { lt: before }, NOT: { name: 'Former family' } },
    select: { id: true },
    take: 500,
  });
  let n = 0;
  for (const h of stale) {
    const [recentEnrolment, recentSale] = await Promise.all([
      tx.lessonEnrollment.count({ where: { householdId: h.id, createdAt: { gte: before } } }),
      tx.sale.count({ where: { householdId: h.id, createdAt: { gte: before } } }),
    ]);
    if (recentEnrolment || recentSale) continue;
    await tx.member.updateMany({ where: { householdId: h.id }, data: { firstName: 'Former', lastName: 'member', dateOfBirth: null, email: null, phone: null, safetyNote: null, photoConsent: false } });
    await tx.lessonEnrollment.updateMany({ where: { householdId: h.id }, data: { swimmerName: 'Former member', safetyNote: null } });
    await tx.household.update({ where: { id: h.id }, data: { name: 'Former family', address: null, emergencyName: null, emergencyPhone: null, notes: null } });
    n++;
  }
  return n;
}
