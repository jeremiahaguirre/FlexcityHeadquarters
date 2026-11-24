/**
 * Turns domain events into per-person notifications (and queued emails).
 *
 * Notifications are written inside a tenant transaction and announced with
 * pg_notify, which Postgres delivers only on COMMIT — so live streams on every
 * API instance see a notification exactly when it becomes durable.
 */
import { createHash, randomUUID } from 'node:crypto';
import type { AccessRole, Prisma, PrismaClient } from '../../generated/prisma/client.js';
import { type Tx, withTenant } from '../../lib/db.js';
import type { DomainEvent } from '../../lib/events.js';
import { type Permission, ROLE_PERMISSIONS } from '../../auth/permissions.js';
import { resolveFeatures } from '../platform/features.js';
import { parseOverrides, rolePermissions } from '../platform/roleOverrides.js';
import { accessOf } from '../../auth/middleware.js';
import type { Scope } from '../people/customRoles.js';
import { approversFor } from '../people/reporting.js';
import { userInScope } from '../people/scope.js';
import { pushEnabled, URGENT as URGENT_PUSH } from './push.js';
import { urgentSoon } from './urgent.js';

export const NOTIFY_CHANNEL = 'fh_notifications';
/** Notifications (and their signals and emails) written per statement. */
const BATCH = 1000;
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

  const pushNow = pushEnabled();
  let urgent = false;
  // In batches, not a round trip per person: a survey to 3,000 people or a message to a 200-person
  // group writes its notifications in a few statements (ids made here, so each signal can name one).
  const rows = unique.map((d) => ({ id: randomUUID(), tenantId, userId: d.userId, type: d.type, params: (d.params ?? {}) as Prisma.InputJsonValue, link: d.link ?? null, dedupeKey: keyOf(d) }));
  for (let i = 0; i < rows.length; i += BATCH) await tx.notification.createMany({ data: rows.slice(i, i + BATCH) });
  const signals = rows.map((n) => JSON.stringify({ tenantId, userId: n.userId, id: n.id }));
  for (let i = 0; i < signals.length; i += BATCH) await tx.$executeRaw`SELECT pg_notify(${NOTIFY_CHANNEL}, s) FROM unnest(${signals.slice(i, i + BATCH)}::text[]) AS s`;
  const emailTo = new Map(people.map((p) => [p.id, p]));
  const phoneOf = new Map(texted.map((p) => [p.id, p]));
  const emails: Prisma.EmailOutboxCreateManyInput[] = [];
  for (const d of unique) {
    const person = d.email && emailOn ? emailTo.get(d.userId) : undefined;
    if (person) emails.push({ tenantId, toEmail: person.email, template: d.email!, params: (d.params ?? {}) as Prisma.InputJsonValue, locale: person.locale });
    const phone = d.sms ? phoneOf.get(d.userId) : undefined;
    if (phone) {
      const base = { tenantId, userId: d.userId, toPhone: phone.smsPhone!, template: d.smsTemplate ?? d.type, params: (d.params ?? {}) as Prisma.InputJsonValue, locale: phone.locale };
      // A call can go unanswered: the text follows it so the words are on the phone.
      if (d.sms === 'call') await tx.smsOutbox.create({ data: { ...base, kind: 'CALL' } });
      await tx.smsOutbox.create({ data: { ...base, kind: 'TEXT' } });
      urgent = true;
    }
    // Pushed to phones straight after the commit, not at the worker's next minute.
    if (pushNow && URGENT_PUSH.has(d.type)) urgent = true;
  }
  for (let i = 0; i < emails.length; i += BATCH) await tx.emailOutbox.createMany({ data: emails.slice(i, i + BATCH) });
  // Texts, calls and urgent pushes go out as soon as this commits (services/notifications/urgent.ts).
  if (urgent) await urgentSoon(tx, tenantId);
  return unique.length;
}

/** What an alert is about, for department scope: a person, and/or the facility or position it happened at. */
export interface AlertAbout {
  userId?: string;
  facilityId?: string;
  positionId?: string;
}

/** Someone who holds a permission, with the department scope they hold it in (null: the whole organization). */
export interface Holder {
  userId: string;
  scope: Scope;
}

/**
 * Everyone active who holds a permission, worked out the way sign-in does (accessOf): through a
 * built-in role (after the organization's Dev console overrides) or a custom role, and never
 * through a feature the organization has switched off. Alerts go by permission, not by role name:
 * a library or a water utility has no "aquatic supervisor".
 */
export async function permissionHolders(tx: Tx, tenantId: string, permission: Permission, exclude: string[] = []): Promise<Holder[]> {
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
    select: { id: true, roles: true },
  });
  const out: Holder[] = [];
  for (const u of users) {
    const access = await accessOf(tenantId, u.id, u.roles);
    if (access?.permissions.has(permission)) out.push({ userId: u.id, scope: access.scope });
  }
  return out;
}

/** The organization's own administrators: tenant.configure for the whole organization (notices about the organization itself). */
export async function organizationAdmins(tx: Tx, tenantId: string): Promise<string[]> {
  return (await permissionHolders(tx, tenantId, 'tenant.configure')).filter((h) => !h.scope).map((h) => h.userId);
}

/** How far around today a lead's positions count as working at a facility. */
const WORKS_AT_DAYS = 90;

/**
 * Whether a holder's department scope reaches what an alert is about (each part given must be in it):
 * - the person: userInScope;
 * - the position: one of the scope's positions;
 * - the facility: one of the scope's facilities; for a lead limited only by positions, a facility
 *   where one of those positions has a shift within 90 days either side of today (a library lead
 *   doesn't hear about the pool, a lifeguard lead does).
 */
export async function reaches(tx: Tx, scope: Scope, about: AlertAbout): Promise<boolean> {
  if (!scope) return true;
  if (about.positionId && scope.positionIds.length && !scope.positionIds.includes(about.positionId)) return false;
  if (about.facilityId && scope.facilityIds.length && !scope.facilityIds.includes(about.facilityId)) return false;
  if (about.facilityId && !scope.facilityIds.length && scope.positionIds.length) {
    const now = Date.now();
    const worksThere = await tx.shift.count({
      where: { facilityId: about.facilityId, positionId: { in: scope.positionIds }, status: { not: 'CANCELLED' }, startsAt: { gte: new Date(now - WORKS_AT_DAYS * 86_400_000), lt: new Date(now + WORKS_AT_DAYS * 86_400_000) } },
    });
    if (!worksThere) return false;
  }
  if (about.userId && !(await userInScope(tx, scope, about.userId))) return false;
  return true;
}

/** The holders whose scope reaches what the alert is about. */
export async function reaching(tx: Tx, holders: Holder[], about: AlertAbout): Promise<string[]> {
  const out: string[] = [];
  for (const h of holders) if (await reaches(tx, h.scope, about)) out.push(h.userId);
  return out;
}

/**
 * Everyone who should hear an alert needing `permission` (permissionHolders). With `about`, only
 * those whose department scope reaches it: a library supervisor with certs.verify hears about the
 * library's staff, not the pool's.
 */
export async function usersWithPermission(tx: Tx, tenantId: string, permission: Permission, exclude: string[] = [], about?: AlertAbout): Promise<string[]> {
  const holders = await permissionHolders(tx, tenantId, permission, exclude);
  return about ? reaching(tx, holders, about) : holders.map((h) => h.userId);
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
      const ids = await usersWithPermission(tx, e.tenantId, 'ops.pool.close', [], { facilityId: e.facilityId });
      return ids.map((userId) => ({ userId, type: 'closure_recommended', params: { poolBodyId: e.poolBodyId, reasons: e.reasons }, link: '/ops' }));
    }
    case 'pool.status_changed':
      return [];
    case 'frontdesk.page': {
      // Whoever runs the deck at that facility.
      const ids = await usersWithPermission(tx, e.tenantId, 'deck.rotate', [e.fromUserId], { facilityId: e.facilityId });
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
