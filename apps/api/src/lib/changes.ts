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
export const CHANGE_TOPICS = ['lonework', 'deck', 'templates', 'bids', 'messages', 'receipts', 'surveys', 'updates'] as const;
export type ChangeTopic = (typeof CHANGE_TOPICS)[number];

export async function announceChange(tx: Tx, tenantId: string, topic: ChangeTopic): Promise<void> {
  await tx.$executeRaw`SELECT pg_notify(${CHANGE_CHANNEL}, ${JSON.stringify({ tenantId, topic })})`;
}

/**
 * A change only some people should hear about (a conversation's members): the same signal, sent
 * only to those people's live streams. Still no content: the organization, the topic and who to tell.
 * Sent in chunks so a big group stays under pg_notify's 8 kB payload limit.
 */
export async function announceChangeTo(tx: Tx, tenantId: string, topic: ChangeTopic, userIds: readonly string[]): Promise<void> {
  const ids = [...new Set(userIds)];
  for (let i = 0; i < ids.length; i += 150) await tx.$executeRaw`SELECT pg_notify(${CHANGE_CHANNEL}, ${JSON.stringify({ tenantId, topic, userIds: ids.slice(i, i + 150) })})`;
}

/** Domain events waiting in the outbox (lib/outbox.ts): the worker LISTENs and delivers at once. */
export const EVENTS_CHANNEL = 'fh_events';
