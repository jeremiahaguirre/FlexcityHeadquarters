/**
 * Everything the organization holds about one person, in one file, so it can
 * answer a privacy access request (PIPEDA, PIPA, Law 25) or search and
 * produce records under freedom-of-information law (MFIPPA, FIPPA, FOIP…).
 *
 * Excluded by design and listed in the file: Union Hub content (the union is
 * its controller) and incident-report narratives (sealed; listed by id for
 * separate review, since they name members of the public and may need
 * severing). The employer decides what to release; this gathers it.
 */
import type { Tx } from '../../lib/db.js';
import { moreRecords } from './moreRecords.js';

export async function exportPersonRecords(tx: Tx, userId: string) {
  const user = await tx.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      id: true, firstName: true, lastName: true, email: true, phone: true, locale: true, roles: true, status: true, employmentStatus: true,
      employeeNumber: true, hireDate: true, seniorityDate: true, seniorityHours: true, dateOfBirth: true, unionMember: true, createdAt: true,
    },
  });
  const w = { where: { userId } };
  const [positions, certifications, payRates, availability, timeOff, shifts, punches, reliability, conduct, discipline, onboarding, accommodation, care, overtime, notifications, incidentsReported, auditAbout, documents] = await Promise.all([
    tx.userPosition.findMany({ ...w, include: { position: { select: { name: true } } } }),
    tx.userCertification.findMany({ ...w, include: { certification: { select: { name: true } } } }),
    tx.payRate.findMany(w),
    tx.availability.findMany(w),
    tx.timeOffRequest.findMany(w),
    tx.shift.findMany({ ...w, select: { id: true, startsAt: true, endsAt: true, status: true, positionId: true, facilityId: true } }),
    tx.timePunch.findMany({ ...w, select: { id: true, clockIn: true, clockOut: true, facilityId: true, positionId: true, status: true, locationStatus: true, distanceM: true } }),
    tx.reliabilityEvent.findMany(w),
    tx.conductNote.findMany(w),
    tx.disciplinaryRecord.findMany({ ...w, select: { id: true, issuedAt: true, level: true, summary: true, evidence: true, stewardPresent: true, acknowledgedAt: true, employeeResponse: true, respondedAt: true } }),
    tx.onboardingRecord.findMany({ ...w, include: { item: { select: { name: true } } } }),
    tx.accommodationCase.findMany(w),
    tx.careCheckIn.findMany({ ...w, select: { id: true, incidentId: true, status: true, createdAt: true, completedAt: true } }),
    tx.overtimeEntry.findMany(w),
    tx.notification.findMany({ ...w, select: { type: true, params: true, createdAt: true, readAt: true } }),
    tx.incidentReport.findMany({ where: { reportedById: userId }, select: { id: true, category: true, occurredAt: true, facilityId: true } }),
    tx.auditLog.findMany({ where: { OR: [{ entityId: userId }, { actorId: userId }] }, select: { action: true, entity: true, entityId: true, actorId: true, at: true }, orderBy: { at: 'asc' } }),
    tx.employeeDocument.findMany({ where: { userId, deletedAt: null }, select: { title: true, kind: true, fileName: true, size: true, sha256: true, createdAt: true } }),
  ]);
  const more = await moreRecords(tx, userId);
  return {
    generatedAt: new Date().toISOString(),
    about: 'All records FlexcityHeadquarters holds about this person for the organization. Review before release; severing may be required for third-party information.',
    excluded: [
      'Union Hub discussions and seniority list (held for the union local, its own controller).',
      'Incident report narratives (sealed). Reports this person filed are listed by id; open each with a stated purpose to review for release.',
      'Signature images on discipline acknowledgements (the date signed is included).',
      'The contents of documents on file (each is listed; download them from the person’s record to include them).',
    ],
    person: user,
    positions: positions.map((p) => p.position.name),
    certifications: certifications.map((c) => ({ name: c.certification.name, issueDate: c.issueDate, expiryDate: c.expiryDate, verifiedAt: c.verifiedAt })),
    payRates,
    availability,
    timeOff,
    shifts,
    punches,
    attendanceEvents: reliability,
    conductNotes: conduct,
    disciplineRecords: discipline,
    onboarding: onboarding.map((o) => ({ item: o.item.name, status: o.status, completedOn: o.completedOn, expiresOn: o.expiresOn, note: o.note, waivedReason: o.waivedReason })),
    workRestrictions: accommodation,
    careCheckIns: care,
    overtime,
    notifications,
    incidentReportsFiled: incidentsReported,
    documents,
    auditTrail: auditAbout,
    ...more,
  };
}
