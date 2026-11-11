/**
 * Domain events, through a transactional outbox (lib/outbox.ts).
 *
 * A service returns the events its change causes; the caller records them with recordEvents()
 * INSIDE the same transaction, so an event exists exactly when its change committed (a rollback
 * leaves neither). After the commit, dispatchSoon() asks this process to deliver them straight
 * away; if the process stops first, the worker delivers them within seconds. Delivery is at
 * least once, and handlers are idempotent (notifications carry a dedupe key).
 */
import type { Prisma } from '@prisma/client';
import type { NotificationDraft } from '../services/notifications/notifier.js';
import type { Tx } from './db.js';

export type DomainEvent =
  | { type: 'shift.offer.posted'; tenantId: string; offerId: string; shiftId: string; eligibleUserIds: string[] }
  | { type: 'shift.offer.completed'; tenantId: string; offerId: string; shiftId: string; fromUserId: string | null; toUserId: string }
  | { type: 'shift.offer.pending_approval'; tenantId: string; offerId: string; shiftId: string; claimantId: string; overtimeHours: string }
  | { type: 'shift.offer.denied'; tenantId: string; offerId: string; claimantId: string }
  | { type: 'pool.closure_recommended'; tenantId: string; facilityId: string; poolBodyId: string; reasons: string[] }
  | { type: 'pool.status_changed'; tenantId: string; facilityId: string; poolBodyId: string; status: string }
  | { type: 'frontdesk.page'; tenantId: string; facilityId: string; fromUserId: string; message: string }
  /** Direct notifications from features that know their recipients. */
  | { type: 'notify'; tenantId: string; drafts: NotificationDraft[] }
  /**
   * For the organization's webhooks (services/integrations/webhooks.ts). The database writes these
   * itself, in the transaction of the change (db/rls.sql fh_public_event), only when an endpoint
   * wants the type: ids and the names of changed fields, never values.
   */
  | { type: PublicEventType; tenantId: string; data: { id: string; person_id?: string; changed?: string[] } };

/** Event types a city's systems can subscribe to (docs/PUBLIC-API.md). */
export const PUBLIC_EVENT_TYPES = [
  'person.created',
  'person.updated',
  'person.terminated',
  'shift.published',
  'shift.updated',
  'shift.cancelled',
  'timeoff.approved',
  'timeoff.cancelled',
  'punch.approved',
  'payrun.approved',
] as const;
export type PublicEventType = (typeof PUBLIC_EVENT_TYPES)[number];
export const isPublicEvent = (e: DomainEvent): e is Extract<DomainEvent, { data: unknown }> => (PUBLIC_EVENT_TYPES as readonly string[]).includes(e.type);

/** Write the events to the outbox, in the caller's transaction. Returns how many. */
export async function recordEvents(tx: Tx, events: DomainEvent | DomainEvent[]): Promise<number> {
  const list = Array.isArray(events) ? events : [events];
  if (!list.length) return 0;
  await tx.eventOutbox.createMany({ data: list.map((e) => ({ tenantId: e.tenantId, type: e.type, payload: e as unknown as Prisma.InputJsonValue })) });
  return list.length;
}

/** recordEvents() for a service result that carries its events; passes the result on. */
export async function withEvents<T extends { events: DomainEvent[] }>(tx: Tx, result: T | Promise<T>): Promise<T> {
  const r = await result;
  await recordEvents(tx, r.events);
  return r;
}

let kick: ((tenantId: string) => void) | null = null;

/** lib/outbox.ts installs the in-process dispatcher here (server.ts turns it on). */
export function setDispatchKick(fn: ((tenantId: string) => void) | null): void {
  kick = fn;
}

/** After the commit: deliver this organization's new events now (best effort; the worker is the backstop). */
export function dispatchSoon(tenantId: string): void {
  kick?.(tenantId);
}
