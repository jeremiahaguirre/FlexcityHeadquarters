import { forgetActive } from '../people/customRoles.js';
/**
 * Retention-aware erasure ("right to be forgotten").
 *
 * Applicable law depends on the employer — this is NOT PIPEDA for municipal staff:
 *   - Municipalities: provincial public-sector acts (BC FOIPPA, ON MFIPPA,
 *     QC Access Act, AB FOIP / ATIA, ...).
 *   - Private employers: BC PIPA, AB PIPA, QC Law 25 (private sector act);
 *     elsewhere employee data has limited statutory coverage.
 * All of them allow — and tax/employment law REQUIRES — keeping payroll records
 * for a period (CRA: 6 years after the tax year). So:
 *
 *   1. On request: restrict processing immediately (no scheduling, no
 *      notifications, excluded from boards) and compute the date the last
 *      payroll record leaves its retention period.
 *   2. On/after that date: anonymize (scrub PII, keep aggregate hours).
 *
 * Hard deletes never happen; FK relations are ON DELETE RESTRICT.
 */
import { type Tx, audit } from '../../lib/db.js';

export function erasureDueDate(lastPayrollActivity: Date | null, retentionYears: number, requestedAt: Date): Date {
  if (!lastPayrollActivity) return requestedAt;
  // Retention runs from the end of the tax year the record relates to.
  const taxYearEnd = new Date(Date.UTC(lastPayrollActivity.getUTCFullYear(), 11, 31));
  const due = new Date(Date.UTC(taxYearEnd.getUTCFullYear() + retentionYears, 11, 31));
  return due > requestedAt ? due : requestedAt;
}

export async function requestErasure(tx: Tx, tenantId: string, actorId: string, userId: string): Promise<{ erasureDueAt: Date }> {
  const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  const last = await tx.timePunch.findFirst({ where: { userId }, orderBy: { clockIn: 'desc' }, select: { clockIn: true } });
  const now = new Date();
  const due = erasureDueDate(last?.clockIn ?? null, tenant.payrollRetentionYears, now);

  await tx.user.update({
    where: { id: userId },
    data: { processingRestrictedAt: now, erasureDueAt: due, status: 'TERMINATED' },
  });
  forgetActive(userId);
  // Remove from future work immediately.
  await tx.shift.updateMany({ where: { userId, startsAt: { gt: now } }, data: { userId: null, conflictReason: 'Staff member left' } });
  await tx.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now } });
  await tx.user.update({ where: { id: userId }, data: { calendarTokenHash: null, calendarTokenAt: null } });
  // Other people's details, kept only for emergencies: no reason to keep them.
  await tx.emergencyContact.deleteMany({ where: { userId } });
  await audit(tx, { tenantId, actorId, action: 'privacy.erasure_requested', entity: 'User', entityId: userId, after: { erasureDueAt: due } });

  if (due <= now) await anonymizeUser(tx, tenantId, actorId, userId);
  return { erasureDueAt: due };
}

/** Scrub direct identifiers. Shifts, punches and pay data remain, attached to an anonymous record. */
export async function anonymizeUser(tx: Tx, tenantId: string, actorId: string | null, userId: string): Promise<void> {
  const tag = userId.slice(0, 8);
  await tx.user.update({
    where: { id: userId },
    data: {
      firstName: 'Former',
      lastName: `Employee ${tag}`,
      email: `anonymized+${userId}@invalid.local`,
      phone: null,
      smsPhone: null,
      smsVerifiedAt: null,
      kioskPinHash: null,
      dateOfBirth: null,
      passwordHash: null,
      anonymizedAt: new Date(),
    },
  });
  await tx.userCertification.updateMany({ where: { userId }, data: { documentUrl: null } });
  await tx.timePunch.updateMany({ where: { userId }, data: { latitude: null, longitude: null, ipAddress: null } });
  await audit(tx, { tenantId, actorId, action: 'privacy.anonymized', entity: 'User', entityId: userId });
  // Object storage (certification documents) is purged by the documents worker on this audit event.
}
