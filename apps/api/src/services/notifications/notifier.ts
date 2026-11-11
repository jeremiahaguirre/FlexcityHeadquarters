/**
 * Turns domain events into per-person notifications (and queued emails).
 *
 * Notifications are written inside a tenant transaction and announced with
 * pg_notify, which Postgres delivers only on COMMIT — so live streams on every
 * API instance see a notification exactly when it becomes durable.
 */
import { createHash } from 'node:crypto';
import type { AccessRole, Prisma, PrismaClient } from '@prisma/client';
import { type Tx, withTenant } from '../../lib/db.js';
import type { DomainEvent } from '../../lib/events.js';
import { type Permission, ROLE_PERMISSIONS } from '../../auth/permissions.js';
import { resolveFeatures } from '../platform/features.js';
import { parseOverrides, rolePermissions } from '../platform/roleOverrides.js';
import { approversFor } from '../people/reporting.js';

export const NOTIFY_CHANNEL = 'fh_notifications';
/** Open shifts starting this soon also go out by text to people who asked. */
export const URGENT_SHIFT_MS = 24 * 3_600_000;

export interface NotificationDraft {
  userId: string;
  type: string;
  params?: Record<string, unknown>;
  link?: string;
  /** Also queue an email using this template. */
  email?: string;
  /** Urgent: also text (or call and text) people who confirmed a mobile number, where the city has text alerts on. Template = type unless smsTemplate. */
  sms?: 'text' | 'call';
  smsTemplate?: string;
}

/**
 * Store notifications (and queue their emails and texts) in the caller's transaction.
 * With `eventId` (the event outbox's delivery), each one carries a dedupe key, and any already
 * written for that event are skipped with their emails and texts: redelivery never repeats them.
 */
export async function notify(tx: Tx, tenantId: string, drafts: NotificationDraft[], opts: { eventId?: string } = {}): Promise<number> {
  let unique = dedupe(drafts);
  const keyOf = (d: NotificationDraft) => (opts.eventId ? `${opts.eventId}:${createHash('sha256').update(draftKey(d)).digest('base64url').slice(0, 22)}` : null);
  if (opts.eventId && unique.length) {
    const done = new Set((await tx.notification.findMany({ where: { dedupeKey: { startsWith: `${opts.eventId}:` } }, select: { dedupeKey: true } })).map((n) => n.dedupeKey));
    unique = unique.filter((d) => !done.has(keyOf(d)));
  }
  if (unique.length === 0) return 0;
  const wantEmail = unique.some((d) => d.email);
  // Notification emails (not invites or password resets) follow the organization's switch.
  const emailOn = wantEmail && resolveFeatures((await tx.tenant.findUnique({ where: { id: tenantId }, select: { features: true } }))?.features).emailNotifications;
  const emailUsers = emailOn ? unique.filter((d) => d.email).map((d) => d.userId) : [];
  const wantSms = unique.some((d) => d.sms);
  const smsOn = wantSms && resolveFeatures((await tx.tenant.findUnique({ where: { id: tenantId }, select: { features: true } }))?.features).textAlerts;
  const texted = smsOn
    ? await tx.user.findMany({ where: { id: { in: unique.filter((d) => d.sms).map((d) => d.userId) }, status: 'ACTIVE', anonymizedAt: null, smsVerifiedAt: { not: null }, smsPhone: { not: null } }, select: { id: true, smsPhone: true, locale: true } })
    : [];
  const people = emailUsers.length
    ? await tx.user.findMany({ where: { id: { in: emailUsers }, status: 'ACTIVE', anonymizedAt: null }, select: { id: true, email: true, locale: true } })
    : [];

  for (const d of unique) {
    const n = await tx.notification.create({
      data: { tenantId, userId: d.userId, type: d.type, params: (d.params ?? {}) as Prisma.InputJsonValue, link: d.link ?? null, dedupeKey: keyOf(d) },
    });
    await tx.$executeRaw`SELECT pg_notify(${NOTIFY_CHANNEL}, ${JSON.stringify({ tenantId, userId: d.userId, id: n.id })})`;
    const person = d.email && emailOn ? people.find((p) => p.id === d.userId) : undefined;
    if (person) {
      await tx.emailOutbox.create({
        data: {
          tenantId,
          toEmail: person.email,
          template: d.email!,
          params: (d.params ?? {}) as Prisma.InputJsonValue,
          locale: person.locale,
        },
      });
    }
    const phone = d.sms ? texted.find((p) => p.id === d.userId) : undefined;
    if (phone) {
      const base = { tenantId, userId: d.userId, toPhone: phone.smsPhone!, template: d.smsTemplate ?? d.type, params: (d.params ?? {}) as Prisma.InputJsonValue, locale: phone.locale };
      // A call can go unanswered: the text follows it so the words are on the phone.
      if (d.sms === 'call') await tx.smsOutbox.create({ data: { ...base, kind: 'CALL' } });
      await tx.smsOutbox.create({ data: { ...base, kind: 'TEXT' } });
    }
  }
  return unique.length;
}

export async function usersWithRoles(tx: Tx, roles: AccessRole[], exclude: string[] = []): Promise<string[]> {
  const users = await tx.user.findMany({
    where: { roles: { hasSome: roles }, status: 'ACTIVE', anonymizedAt: null, id: { notIn: exclude } },
    select: { id: true },
  });
  return users.map((u) => u.id);
}

/**
 * Everyone active who holds a permission: through a built-in role (after the
 * organization's Dev console overrides) or a custom role.
 */
export async function usersWithPermission(tx: Tx, tenantId: string, permission: Permission, exclude: string[] = []): Promise<string[]> {
  const t = await tx.tenant.findUnique({ where: { id: tenantId }, select: { roleOverrides: true } });
  const overrides = parseOverrides(t?.roleOverrides);
  const roles = (Object.keys(ROLE_PERMISSIONS) as AccessRole[]).filter((r) => rolePermissions(r, overrides).has(permission));
  const custom = await tx.userCustomRole.findMany({ where: { customRole: { permissions: { has: permission } } }, select: { userId: true } });
  const users = await tx.user.findMany({
    where: {
      status: 'ACTIVE',
      anonymizedAt: null,
      id: { notIn: exclude },
      OR: [{ roles: { hasSome: roles } }, { id: { in: custom.map((c) => c.userId) } }],
    },
    select: { id: true },
  });
  return users.map((u) => u.id);
}

/** Who hears about what. Pure mapping except for role lookups. */
export async function draftsFor(tx: Tx, e: DomainEvent): Promise<NotificationDraft[]> {
  switch (e.type) {
    case 'shift.offer.posted': {
      const drafts: NotificationDraft[] = e.eligibleUserIds.map((userId) => ({ userId, type: 'shift_available', params: { shiftId: e.shiftId, offerId: e.offerId }, link: '/board' }));
      // Starting within a day: a text too, for people who asked for those.
      const shift = await tx.shift.findUnique({ where: { id: e.shiftId }, select: { startsAt: true, facility: { select: { name: true, timezone: true } }, position: { select: { name: true } } } });
      if (!shift || shift.startsAt.getTime() - Date.now() > URGENT_SHIFT_MS || shift.startsAt.getTime() < Date.now()) return drafts;
      const wants = new Set((await tx.user.findMany({ where: { id: { in: e.eligibleUserIds }, smsUrgentShifts: true }, select: { id: true } })).map((u) => u.id));
      const sms = { position: shift.position.name, facility: shift.facility.name, startsAt: shift.startsAt.toISOString(), tz: shift.facility.timezone };
      return drafts.map((d) => (wants.has(d.userId) ? { ...d, sms: 'text' as const, smsTemplate: 'shift_urgent', params: { ...d.params, ...sms } } : d));
    }
    case 'shift.offer.completed': {
      const out: NotificationDraft[] = [
        { userId: e.toUserId, type: 'shift_assigned', params: { shiftId: e.shiftId }, link: '/schedule', email: 'shift_assigned' },
      ];
      if (e.fromUserId) out.push({ userId: e.fromUserId, type: 'shift_covered', params: { shiftId: e.shiftId }, link: '/schedule' });
      return out;
    }
    case 'shift.offer.pending_approval': {
      // The claimant's manager first (services/people/reporting.ts), else everyone who approves claims.
      const sups = (await approversFor(tx, e.tenantId, [e.claimantId], 'shiftboard.approve')).to;
      return [
        ...sups.map((userId) => ({
          userId,
          type: 'claim_needs_approval',
          params: { offerId: e.offerId, claimantId: e.claimantId, overtimeHours: e.overtimeHours },
          link: '/manage/approvals',
          email: 'claim_needs_approval',
        })),
        { userId: e.claimantId, type: 'claim_pending', params: { offerId: e.offerId, overtimeHours: e.overtimeHours }, link: '/board' },
      ];
    }
    case 'shift.offer.denied':
      return [{ userId: e.claimantId, type: 'claim_denied', params: { offerId: e.offerId }, link: '/board' }];
    case 'pool.closure_recommended': {
      const ids = await usersWithRoles(tx, ['HEAD_LIFEGUARD', 'AQUATIC_SUPERVISOR']);
      return ids.map((userId) => ({ userId, type: 'closure_recommended', params: { poolBodyId: e.poolBodyId, reasons: e.reasons }, link: '/ops' }));
    }
    case 'pool.status_changed':
      return [];
    case 'frontdesk.page': {
      const ids = await usersWithRoles(tx, ['HEAD_LIFEGUARD'], [e.fromUserId]);
      return ids.map((userId) => ({ userId, type: 'front_desk_page', params: { message: e.message, facilityId: e.facilityId }, link: '/notifications' }));
    }
    case 'notify':
      return e.drafts;
    default:
      // Webhook events (lib/events.ts PUBLIC_EVENT_TYPES) notify nobody in the app.
      return [];
  }
}

/** The event outbox's handler (lib/outbox.ts): runs in the transaction that marks the event delivered. */
export async function handleDomainEvent(tx: Tx, e: DomainEvent, eventId: string): Promise<number> {
  return notify(tx, e.tenantId, await draftsFor(tx, e), { eventId });
}

/** One event, outside the outbox (tests and scripts). */
export async function handleEvent(e: DomainEvent, prisma?: PrismaClient): Promise<number> {
  return withTenant(e.tenantId, async (tx) => notify(tx, e.tenantId, await draftsFor(tx, e)), { prisma });
}

const draftKey = (d: NotificationDraft) => `${d.userId}|${d.type}|${JSON.stringify(d.params ?? {})}`;

function dedupe(drafts: NotificationDraft[]): NotificationDraft[] {
  const seen = new Set<string>();
  return drafts.filter((d) => {
    const k = draftKey(d);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
