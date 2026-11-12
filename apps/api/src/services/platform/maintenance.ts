/**
 * Maintenance notices (docs/RELEASES.md). The Dev console schedules a window (start, end, a message
 * in English and French, all or some organizations). Informational only: nothing is switched off.
 * - Everyone signed in sees a short heads-up banner in the day before (they can dismiss it) and a
 *   banner during the window; the sign-in page shows them too.
 * - HR admins of each organization are told in-app and by email when it's scheduled, and again a
 *   day before. The worker sends both; each organization's notices are checked before sending, so
 *   a retry never repeats them.
 * Live: scheduling, changing or cancelling one updates open screens at once ('updates' topic).
 */
import type { MaintenanceWindow, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { type Tx, db, tenantIds as allTenantIds, withTenant } from '../../lib/db.js';
import { announceChange } from '../../lib/changes.js';
import { notify, usersWithRoles } from '../notifications/notifier.js';
import { cleanText } from './releaseNotes.js';

const HOUR = 3_600_000;
/** The heads-up banner and the HR reminder: this long before the start. */
export const HEADS_UP_MS = 24 * HOUR;

const message = z.string().transform(cleanText).pipe(z.string().min(2).max(600));
export const maintenanceBody = z
  .object({
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
    messageEn: message,
    messageFr: message,
    tenantIds: z.array(z.string().uuid()).max(5000).default([]),
    ringIds: z.array(z.string().uuid()).max(20).default([]),
  })
  .refine((b) => b.endsAt > b.startsAt, { message: 'The end must be after the start', path: ['endsAt'] })
  .refine((b) => b.endsAt.getTime() - b.startsAt.getTime() <= 72 * HOUR, { message: 'At most 72 hours', path: ['endsAt'] });

export type MaintenanceStatus = 'upcoming' | 'active' | 'ended' | 'cancelled';
export function maintenanceStatus(w: Pick<MaintenanceWindow, 'startsAt' | 'endsAt' | 'cancelledAt'>, now = new Date()): MaintenanceStatus {
  if (w.cancelledAt) return 'cancelled';
  if (w.endsAt <= now) return 'ended';
  return w.startsAt <= now ? 'active' : 'upcoming';
}

/** The live signal to every organization it's for. */
export async function announceMaintenance(prisma: PrismaClient, w: Pick<MaintenanceWindow, 'tenantIds'>): Promise<void> {
  const targets = w.tenantIds.length ? w.tenantIds : await allTenantIds(prisma);
  await prisma.$transaction(async (tx) => {
    for (const t of targets) await announceChange(tx as Tx, t, 'updates');
  });
}

/** What a banner shows: windows for this organization that are on now or start within a day. */
export async function bannersFor(tx: Tx, tenantId: string, now = new Date()) {
  const rows = await tx.maintenanceWindow.findMany({
    where: { cancelledAt: null, endsAt: { gt: now }, startsAt: { lte: new Date(now.getTime() + HEADS_UP_MS) }, OR: [{ tenantIds: { isEmpty: true } }, { tenantIds: { has: tenantId } }] },
    orderBy: { startsAt: 'asc' },
    take: 3,
  });
  return rows.map((w) => ({ id: w.id, startsAt: w.startsAt.toISOString(), endsAt: w.endsAt.toISOString(), message: { en: w.messageEn, fr: w.messageFr }, status: maintenanceStatus(w, now) as 'upcoming' | 'active' }));
}

/** Upcoming windows for this organization (the What's new page), the next two weeks. */
export async function upcomingFor(tx: Tx, tenantId: string, now = new Date()) {
  const rows = await tx.maintenanceWindow.findMany({
    where: { cancelledAt: null, endsAt: { gt: now }, startsAt: { lte: new Date(now.getTime() + 14 * 24 * HOUR) }, OR: [{ tenantIds: { isEmpty: true } }, { tenantIds: { has: tenantId } }] },
    orderBy: { startsAt: 'asc' },
    take: 10,
  });
  return rows.map((w) => ({ id: w.id, startsAt: w.startsAt.toISOString(), endsAt: w.endsAt.toISOString(), message: { en: w.messageEn, fr: w.messageFr }, status: maintenanceStatus(w, now) }));
}

async function orgTimezone(tx: Tx): Promise<string> {
  return (await tx.facility.findFirst({ orderBy: { createdAt: 'asc' }, select: { timezone: true } }))?.timezone ?? 'America/Toronto';
}
/** "November 14, 2026, 10:00 p.m. – 11:30 p.m. EST", in the organization's time zone. */
export function windowText(w: Pick<MaintenanceWindow, 'startsAt' | 'endsAt'>, locale: string, timeZone: string): string {
  const f = new Intl.DateTimeFormat(locale, { timeZone, dateStyle: 'long', timeStyle: 'short' });
  const sameDay = new Intl.DateTimeFormat('en-CA', { timeZone, dateStyle: 'short' }).format(w.startsAt) === new Intl.DateTimeFormat('en-CA', { timeZone, dateStyle: 'short' }).format(w.endsAt);
  const end = sameDay ? new Intl.DateTimeFormat(locale, { timeZone, timeStyle: 'short' }).format(w.endsAt) : f.format(w.endsAt);
  const zone = new Intl.DateTimeFormat(locale, { timeZone, timeZoneName: 'short' }).formatToParts(w.startsAt).find((p) => p.type === 'timeZoneName')?.value ?? '';
  return `${f.format(w.startsAt)} – ${end}${zone ? ` ${zone}` : ''}`;
}

/** One organization's HR admins, once per kind of notice. */
async function tellOrganization(prisma: PrismaClient, w: MaintenanceWindow, tenantId: string, type: 'maintenance_scheduled' | 'maintenance_soon'): Promise<number> {
  return withTenant(
    tenantId,
    async (tx) => {
      const already = await tx.notification.findFirst({ where: { type, params: { path: ['windowId'], equals: w.id } }, select: { id: true } });
      if (already) return 0;
      const tz = await orgTimezone(tx);
      const params = { windowId: w.id, whenEn: windowText(w, 'en-CA', tz), whenFr: windowText(w, 'fr-CA', tz), messageEn: w.messageEn, messageFr: w.messageFr };
      const hr = await usersWithRoles(tx, ['HR_ADMIN']);
      if (!hr.length) return 0;
      return notify(tx, tenantId, hr.map((userId) => ({ userId, type, params, link: '/whats-new', email: type })));
    },
    { prisma },
  );
}

/** Worker: the notice when a window is scheduled, then the reminder a day before. */
export async function maintenanceNotices(prisma: PrismaClient = db(), now = new Date()): Promise<number> {
  let sent = 0;
  const open = await prisma.maintenanceWindow.findMany({ where: { cancelledAt: null, endsAt: { gt: now }, OR: [{ noticeSentAt: null }, { reminderSentAt: null }] } });
  for (const w of open) {
    const targets = w.tenantIds.length ? w.tenantIds : await allTenantIds(prisma);
    // Scheduled within a day of its start: the first notice is the reminder.
    const soon = w.startsAt.getTime() - now.getTime() <= HEADS_UP_MS;
    if (!w.noticeSentAt && !soon) {
      for (const t of targets) sent += await tellOrganization(prisma, w, t, 'maintenance_scheduled');
      await prisma.maintenanceWindow.update({ where: { id: w.id }, data: { noticeSentAt: now } });
    }
    if (!w.reminderSentAt && soon) {
      for (const t of targets) sent += await tellOrganization(prisma, w, t, 'maintenance_soon');
      await prisma.maintenanceWindow.update({ where: { id: w.id }, data: { reminderSentAt: now, noticeSentAt: w.noticeSentAt ?? now } });
    }
  }
  return sent;
}

/**
 * The banner's live signals: open screens refetch when a heads-up starts (a day before), when the
 * window starts and when it ends. The worker sends them on the minute those moments pass.
 */
export async function maintenanceEdges(prisma: PrismaClient = db(), now = new Date(), lastRun: Date): Promise<number> {
  const rows = await prisma.maintenanceWindow.findMany({
    where: {
      cancelledAt: null,
      OR: [
        { startsAt: { gt: lastRun, lte: now } },
        { endsAt: { gt: lastRun, lte: now } },
        { startsAt: { gt: new Date(lastRun.getTime() + HEADS_UP_MS), lte: new Date(now.getTime() + HEADS_UP_MS) } },
      ],
    },
    select: { tenantIds: true },
  });
  for (const w of rows) await announceMaintenance(prisma, w);
  return rows.length;
}
