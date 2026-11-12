/**
 * Working alone. Provincial OHS rules (e.g. BC OHS Regulation 4.21, Alberta
 * OHS Code Part 28, Saskatchewan OHS Regulations s. 3-25, Ontario's guidance
 * for municipal workers) expect a procedure to check on people who work alone
 * at set intervals and to get help to them when a check is missed.
 *
 * Here: the worker checks in on a timer. A missed check-in alerts the worker
 * and everyone who monitors lone workers; after a grace period it escalates to
 * HR too, by email. "I need help" alerts everyone at once.
 */
import { announceChange } from '../../lib/changes.js';
import type { LoneWorkSession, Prisma } from '../../generated/prisma/client.js';
import type { Tx } from '../../lib/db.js';
import { notify, usersWithPermission } from '../notifications/notifier.js';
import { onCallForWorker } from '../scheduling/onCall.js';

export const INTERVALS = [15, 30, 60, 90, 120] as const;
/** After a missed check-in, how long before it escalates. */
export const GRACE_MINUTES = 15;

const minutes = (n: number) => n * 60_000;

/** Who is alerted: the person on call for the worker's department first, then everyone who monitors. */
async function monitors(tx: Tx, s: LoneWorkSession, now = new Date()) {
  const first = await onCallForWorker(tx, s.userId, now);
  return [...new Set([...first, ...(await usersWithPermission(tx, s.tenantId, 'lonework.monitor', [s.userId]))])];
}

async function workerName(tx: Tx, userId: string) {
  const u = await tx.user.findUnique({ where: { id: userId }, select: { firstName: true, lastName: true } });
  return u ? `${u.firstName} ${u.lastName}` : '';
}

/** How long before a check-in is due the worker gets a reminder on their phone. */
export const REMIND_MINUTES = 5;

/** Minutely: remind before a check-in is due, flag missed check-ins, then escalate the ones still unanswered. */
export async function loneWorkChecks(tx: Tx, now = new Date()): Promise<number> {
  let changed = 0;
  const soon = await tx.loneWorkSession.findMany({ where: { status: 'ACTIVE', nextDueAt: { gt: now, lte: new Date(now.getTime() + minutes(REMIND_MINUTES)) } } });
  for (const s of soon) {
    // Once per interval: a check-in moves lastCheckInAt past the last reminder.
    if (s.remindedAt && s.remindedAt >= s.lastCheckInAt) continue;
    const claimed = await tx.loneWorkSession.updateMany({ where: { id: s.id, status: 'ACTIVE', lastCheckInAt: s.lastCheckInAt }, data: { remindedAt: now } });
    if (!claimed.count) continue;
    await notify(tx, s.tenantId, [{ userId: s.userId, type: 'lonework_due_soon', params: { location: s.location }, link: '/alone' }]);
  }
  const missed = await tx.loneWorkSession.findMany({ where: { status: 'ACTIVE', nextDueAt: { lte: now } } });
  for (const s of missed) {
    const claimed = await tx.loneWorkSession.updateMany({ where: { id: s.id, status: 'ACTIVE' }, data: { status: 'OVERDUE', overdueAt: now } });
    if (!claimed.count) continue;
    await announceChange(tx, s.tenantId, 'lonework');
    const params = { name: await workerName(tx, s.userId), location: s.location };
    await notify(tx, s.tenantId, [
      { userId: s.userId, type: 'lonework_check_in_now', params, link: '/alone', sms: 'text' as const },
      ...(await monitors(tx, s)).map((userId) => ({ userId, type: 'lonework_overdue', params, link: '/manage/lone-work', sms: 'text' as const })),
    ]);
    changed++;
  }
  const late = await tx.loneWorkSession.findMany({ where: { status: 'OVERDUE', overdueAt: { lte: new Date(now.getTime() - minutes(GRACE_MINUTES)) } } });
  for (const s of late) {
    const claimed = await tx.loneWorkSession.updateMany({ where: { id: s.id, status: 'OVERDUE' }, data: { status: 'ESCALATED', escalatedAt: now } });
    if (!claimed.count) continue;
    await announceChange(tx, s.tenantId, 'lonework');
    const params = { name: await workerName(tx, s.userId), location: s.location };
    const hr = await usersWithPermission(tx, s.tenantId, 'accommodation.manage', [s.userId]);
    const to = [...new Set([...(await monitors(tx, s)), ...hr])];
    await notify(tx, s.tenantId, to.map((userId) => ({ userId, type: 'lonework_escalated', params, link: '/manage/lone-work', email: 'lonework_escalated', sms: 'call' as const })));
    changed++;
  }
  return changed;
}

export async function raiseHelp(tx: Tx, s: LoneWorkSession, note: string | null, now = new Date()) {
  await tx.loneWorkSession.update({ where: { id: s.id }, data: { status: 'HELP', helpAt: now, helpNote: note } });
  await announceChange(tx, s.tenantId, 'lonework');
  const params = { name: await workerName(tx, s.userId), location: s.location, note: note ?? '' };
  const hr = await usersWithPermission(tx, s.tenantId, 'accommodation.manage', [s.userId]);
  const to = [...new Set([...(await monitors(tx, s)), ...hr])];
  await notify(tx, s.tenantId, to.map((userId) => ({ userId, type: 'lonework_help', params, link: '/manage/lone-work', email: 'lonework_help', sms: 'call' as const })));
}

export function view(s: LoneWorkSession & { user?: { firstName: string; lastName: string; phone: string | null } | null; responder?: string | null }) {
  return {
    id: s.id,
    userId: s.userId,
    person: s.user ? `${s.user.firstName} ${s.user.lastName}` : undefined,
    phone: s.user?.phone ?? null,
    facilityId: s.facilityId,
    location: s.location,
    task: s.task,
    intervalMinutes: s.intervalMinutes,
    status: s.status,
    startedAt: s.startedAt,
    lastCheckInAt: s.lastCheckInAt,
    nextDueAt: s.nextDueAt,
    overdueAt: s.overdueAt,
    escalatedAt: s.escalatedAt,
    helpAt: s.helpAt,
    helpNote: s.helpNote,
    shareLocation: s.shareLocation,
    locationAt: s.locationAt,
    latitude: s.latitude === null ? null : Number(s.latitude),
    longitude: s.longitude === null ? null : Number(s.longitude),
    responder: s.responder ?? null,
    respondingAt: s.respondingAt,
    endedAt: s.endedAt,
  };
}

export const position = (lat?: number | null, lng?: number | null): Prisma.LoneWorkSessionUpdateInput =>
  lat != null && lng != null ? { latitude: lat, longitude: lng, locationAt: new Date() } : {};
