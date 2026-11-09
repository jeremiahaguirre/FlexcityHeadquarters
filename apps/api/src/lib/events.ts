import { EventEmitter } from 'node:events';

/**
 * Domain events. In-process for now; the WebSocket gateway and push-notification
 * worker subscribe here. Emit only AFTER the transaction commits (callers return
 * events from the transaction and publish them afterwards), so subscribers never
 * see state that was rolled back.
 */
export type DomainEvent =
  | { type: 'shift.offer.posted'; tenantId: string; offerId: string; shiftId: string; eligibleUserIds: string[] }
  | { type: 'shift.offer.completed'; tenantId: string; offerId: string; shiftId: string; fromUserId: string | null; toUserId: string }
  | { type: 'shift.offer.pending_approval'; tenantId: string; offerId: string; shiftId: string; claimantId: string; overtimeHours: string }
  | { type: 'shift.offer.denied'; tenantId: string; offerId: string; claimantId: string }
  | { type: 'pool.closure_recommended'; tenantId: string; facilityId: string; poolBodyId: string; reasons: string[] }
  | { type: 'pool.status_changed'; tenantId: string; facilityId: string; poolBodyId: string; status: string }
  | { type: 'frontdesk.page'; tenantId: string; facilityId: string; fromUserId: string; message: string };

const bus = new EventEmitter();
bus.setMaxListeners(100);

export function publish(events: DomainEvent | DomainEvent[]): void {
  for (const e of Array.isArray(events) ? events : [events]) bus.emit('event', e);
}

export function subscribe(fn: (e: DomainEvent) => void): () => void {
  bus.on('event', fn);
  return () => bus.off('event', fn);
}
