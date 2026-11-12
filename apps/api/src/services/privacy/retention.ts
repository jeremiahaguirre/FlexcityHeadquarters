/**
 * Routine records aren't kept forever. Each organization sets how long; these are the defaults.
 * - In-app notifications: 2 years.
 * - The email log (who was sent which kind of email, never the contents): 90 days.
 * - Families (and the children in them) with no registration or purchase for 3 years: names,
 *   birth dates, contacts and safety notes removed; payment records stay, as "Former family".
 * - Facility booking requests: the requester's contact details, 2 years after the booking.
 * - Working-alone check-in locations: 30 days after the session ended.
 * - Ended sign-in sessions and used or expired one-time links: 30 days (not configurable).
 * - Domain events (lib/outbox.ts): delivered ones 7 days (their contents are cleared on delivery),
 *   dead ones 30 days (not configurable). Pending ones are never removed.
 * - Webhook delivery records (services/integrations/webhooks.ts): 30 days once finished.
 * - Public API Idempotency-Key records (services/integrations/idempotency.ts): 24 hours.
 * - Team messages (services/messaging/records.ts): a conversation 2 years after its last message
 *   (messagesDays), unless a report about it is still open with HR.
 * - Staff surveys (services/surveys): 2 years after a survey closed (surveysDays), with who was asked
 *   and every answer.
 * - Shift bid rankings and outcomes (services/scheduling/bidding.ts): 2 years after the round was
 *   confirmed or cancelled (not configurable); the awards (who works what) stay with the schedule.
 * - Shift preferences (services/scheduling/preferences.ts): of people who left, 90 days after the
 *   last change (not configurable); seasonal staff away keep theirs. Anonymizing deletes them at once.
 * The audit log is kept for the life of the account (it's append-only, and part of the
 * organization's records); offboarding deletes it with everything else.
 */
import type { Tx } from '../../lib/db.js';
import { purgeInactivePreferences } from '../scheduling/preferences.js';
import { purgeOldBids } from '../scheduling/bidding.js';
import { applyMessageRetention } from '../messaging/records.js';
import { applySurveyRetention } from '../surveys/surveys.js';

/** Delivered domain events (ids and type only by then). */
export const EVENT_DELIVERED_DAYS = 7;
/** Job applications that didn't end in a hire. */
export const APPLICATION_DAYS = 365;
export const RETENTION_DEFAULTS = { notificationsDays: 730, emailLogDays: 90, familiesInactiveDays: 1095, bookingsDays: 730, messagesDays: 730, surveysDays: 730 } as const;
export const RETENTION_LIMITS = { notificationsDays: [90, 3650], emailLogDays: [30, 3650], familiesInactiveDays: [365, 3650], bookingsDays: [180, 3650], messagesDays: [180, 3650], surveysDays: [180, 3650] } as const;
export type Retention = { notificationsDays: number; emailLogDays: number; familiesInactiveDays: number; bookingsDays: number; messagesDays: number; surveysDays: number };

export function readRetention(raw: unknown): Retention {
  const r = raw && typeof raw === 'object' ? (raw as Partial<Retention>) : {};
  const pick = (k: keyof Retention) => {
    const v = Number(r[k]);
    const [lo, hi] = RETENTION_LIMITS[k];
    return Number.isFinite(v) && v >= lo && v <= hi ? v : RETENTION_DEFAULTS[k];
  };
  return { notificationsDays: pick('notificationsDays'), emailLogDays: pick('emailLogDays'), familiesInactiveDays: pick('familiesInactiveDays'), bookingsDays: pick('bookingsDays'), messagesDays: pick('messagesDays'), surveysDays: pick('surveysDays') };
}

const ago = (now: Date, days: number) => new Date(now.getTime() - days * 86_400_000);

/** Runs inside one organization's context (the worker calls it for each). Returns rows removed. */
export async function applyRetention(tx: Tx, now = new Date()): Promise<number> {
  const t = await tx.tenant.findFirst({ select: { retentionSettings: true } });
  if (!t) return 0;
  const r = readRetention(t.retentionSettings);
  const n = await tx.notification.deleteMany({ where: { createdAt: { lt: ago(now, r.notificationsDays) } } });
  // Who saw which What's new note: kept as long as notifications.
  await tx.releaseNoteRead.deleteMany({ where: { readAt: { lt: ago(now, r.notificationsDays) } } });
  // Only finished emails: anything still waiting to go out stays.
  const e = await tx.emailOutbox.deleteMany({ where: { createdAt: { lt: ago(now, r.emailLogDays) }, OR: [{ sentAt: { not: null } }, { attempts: { gte: 5 } }] } });
  // Texts and calls follow the email log's period.
  await tx.smsOutbox.deleteMany({ where: { createdAt: { lt: ago(now, r.emailLogDays) }, OR: [{ sentAt: { not: null } }, { attempts: { gte: 5 } }] } });
  const old = ago(now, 30);
  const ev = await tx.eventOutbox.deleteMany({ where: { OR: [{ status: 'DELIVERED', deliveredAt: { lt: ago(now, EVENT_DELIVERED_DAYS) } }, { status: 'DEAD', createdAt: { lt: old } }] } });
  const wh = await tx.webhookDelivery.deleteMany({ where: { status: { not: 'PENDING' }, createdAt: { lt: old } } });
  const ik = await tx.apiIdempotencyKey.deleteMany({ where: { expiresAt: { lt: now } } });
  const s = await tx.refreshToken.deleteMany({ where: { OR: [{ expiresAt: { lt: old } }, { revokedAt: { lt: old } }] } });
  const l = await tx.authToken.deleteMany({ where: { OR: [{ expiresAt: { lt: old } }, { usedAt: { lt: old } }] } });
  // Sign-in codes are useless once expired; kept 30 days only so a wrong-try lockout can be looked into.
  const mc = await tx.mfaCode.deleteMany({ where: { expiresAt: { lt: old } } });
  const g = await tx.loneWorkSession.updateMany({ where: { status: { not: 'ACTIVE' }, lastCheckInAt: { lt: old }, OR: [{ latitude: { not: null } }, { longitude: { not: null } }] }, data: { latitude: null, longitude: null } });
  const b = await tx.bookingRequest.updateMany({ where: { endsAt: { lt: ago(now, r.bookingsDays) }, NOT: { name: 'Former requester' } }, data: { name: 'Former requester', email: '', phone: '', organization: null, notes: null } });
  // Job applicants: kept a year after the last change (public bodies must keep personal information
  // used for a decision at least a year); then removed, or for people hired, the résumé wiped.
  const year = ago(now, APPLICATION_DAYS);
  const ap = await tx.jobApplication.deleteMany({ where: { status: { not: 'HIRED' }, updatedAt: { lt: year } } });
  await tx.jobApplication.updateMany({ where: { status: 'HIRED', updatedAt: { lt: year }, NOT: { ciphertext: null } }, data: { ciphertext: null, iv: null, authTag: null, wrappedKey: null, kekId: null, message: null } });
  const sp = (await purgeInactivePreferences(tx, now)) + (await purgeOldBids(tx, now));
  const msg = await applyMessageRetention(tx, r.messagesDays, now);
  const sv = await applySurveyRetention(tx, r.surveysDays, now);
  return sp + msg + sv + n.count + e.count + ev.count + wh.count + ik.count + s.count + l.count + mc.count + g.count + b.count + ap.count + (await forgetInactiveFamilies(tx, ago(now, r.familiesInactiveDays)));
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
