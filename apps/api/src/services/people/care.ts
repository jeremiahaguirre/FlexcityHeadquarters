/**
 * Care after critical incidents. A rescue, an ambulance call, a staff injury
 * (or any report where emergency services were called) offers everyone
 * involved — the person who reported it and everyone clocked in at that
 * facility at the time — a private check-in, the city's employee assistance
 * details, and the option to ask for time away from the chair. The app
 * records only that care was offered and followed up, never what was said.
 */
import type { Tx } from '../../lib/db.js';
import { notify, usersWithRoles } from '../notifications/notifier.js';

export const SERIOUS = new Set(['RESCUE', 'EMS_CALLED', 'INJURY']);

export function parseCare(stored: unknown): { eap: string | null } {
  const s = stored && typeof stored === 'object' ? (stored as Record<string, unknown>) : {};
  return { eap: typeof s.eap === 'string' && s.eap.trim() ? s.eap.trim() : null };
}

export async function offerCare(tx: Tx, incident: { id: string; tenantId: string; facilityId: string; reportedById: string; occurredAt: Date; category: string }, emsCalled: boolean) {
  if (!SERIOUS.has(incident.category) && !emsCalled) return 0;
  const onDuty = await tx.timePunch.findMany({
    where: { facilityId: incident.facilityId, clockIn: { lte: incident.occurredAt }, OR: [{ clockOut: null }, { clockOut: { gt: incident.occurredAt } }] },
    select: { userId: true },
  });
  const people = [...new Set([incident.reportedById, ...onDuty.map((p) => p.userId)])];
  const dueAt = new Date(Date.now() + 24 * 3_600_000);
  await tx.careCheckIn.createMany({ data: people.map((userId) => ({ tenantId: incident.tenantId, userId, incidentId: incident.id, dueAt })), skipDuplicates: true });
  const leads = (await usersWithRoles(tx, ['AQUATIC_SUPERVISOR', 'HR_ADMIN'])).filter((u) => !people.includes(u));
  await notify(tx, incident.tenantId, [
    ...people.map((userId) => ({ userId, type: 'care_offered', link: '/today' })),
    ...leads.map((userId) => ({ userId, type: 'care_checkins_due', params: { count: people.length }, link: '/manage/care' })),
  ]);
  return people.length;
}
