/**
 * Live "this changed" signals for screens that show shared, fast-moving state (working-alone
 * sessions, the deck rotation). The writing transaction calls announceChange(); pg_notify inside a
 * transaction is sent only when it commits (and never on a rollback), so a signal always means the
 * change is visible. Every API process LISTENs (services/notifications/liveHub.ts) and forwards the
 * topic down the browser's live stream (routes/notifications.ts); the screen then refetches through
 * the normal, permission-checked API. The payload is the organization id and a topic name only:
 * no ids, no personal information.
 */
import type { Tx } from './db.js';

export const CHANGE_CHANNEL = 'fh_changes';
export const CHANGE_TOPICS = ['lonework', 'deck'] as const;
export type ChangeTopic = (typeof CHANGE_TOPICS)[number];

export async function announceChange(tx: Tx, tenantId: string, topic: ChangeTopic): Promise<void> {
  await tx.$executeRaw`SELECT pg_notify(${CHANGE_CHANNEL}, ${JSON.stringify({ tenantId, topic })})`;
}

/** Domain events waiting in the outbox (lib/outbox.ts): the worker LISTENs and delivers at once. */
export const EVENTS_CHANNEL = 'fh_events';
