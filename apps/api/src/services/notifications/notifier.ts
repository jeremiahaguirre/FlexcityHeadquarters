/**
 * Turns domain events into per-person notifications (and queued emails).
 *
 * Notifications are written inside a tenant transaction and announced with
 * pg_notify, which Postgres delivers only on COMMIT — so live streams on every
 * API instance see a notification exactly when it becomes durable.
 */
import type { AccessRole, Prisma, PrismaClient } from '@prisma/client';
import { type Tx, withTenant } from '../../lib/db.js';
import type { DomainEvent } from '../../lib/events.js';
import { type Permission, ROLE_PERMISSIONS } from '../../auth/permissions.js';
import { resolveFeatures } from '../platform/features.js';
import { parseOverrides, rolePermissions } from '../platform/roleOverrides.js';

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

export async function notify(tx: Tx, tenantId: string, drafts: NotificationDraft[]): Promise<number> {
  const unique = dedupe(drafts);
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
      data: { tenantId, userId: d.userId, type: d.type, params: (d.params ?? {}) as Prisma.InputJsonValue, link: d.link ?? null },
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
      const sups = await usersWithRoles(tx, ['AQUATIC_SUPERVISOR'], [e.claimantId]);
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
  }
}

export async function handleEvent(e: DomainEvent, prisma?: PrismaClient): Promise<number> {
  return withTenant(e.tenantId, async (tx) => notify(tx, e.tenantId, await draftsFor(tx, e)), { prisma });
}

function dedupe(drafts: NotificationDraft[]): NotificationDraft[] {
  const seen = new Set<string>();
  return drafts.filter((d) => {
    const k = `${d.userId}|${d.type}|${JSON.stringify(d.params ?? {})}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
