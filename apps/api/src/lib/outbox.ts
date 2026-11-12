/**
 * Event outbox dispatcher: delivers the domain events recorded by lib/events.ts recordEvents().
 *
 * - Who runs it: the API process that committed the change, straight after the commit
 *   (dispatchSoon, best effort, for low latency), and the worker as soon as recordEvents() announces
 *   the organization on fh_events at commit, plus a 30 s sweep for retries and events
 *   whose process stopped first or whose delivery failed. Any number of processes may run it at once.
 * - Claiming: one event at a time, `SELECT … FOR UPDATE SKIP LOCKED` inside the organization's own
 *   transaction (RLS applies). Two dispatchers never hold the same event, and neither waits on the other.
 * - Delivery: the handler runs in that same transaction, and the event is marked DELIVERED before it
 *   commits. Handlers only write to the database (notifications, queued emails and texts), so their
 *   work and the DELIVERED mark commit together. If the process dies mid-way, both roll back and the
 *   event is delivered again later: at least once. Notifications carry a dedupe key per event, so a
 *   second delivery adds nothing.
 * - Failure: the handler's work is rolled back to a savepoint, and the attempt, the error and the next
 *   try (backoff: 5 s, 10 s, 20 s … up to 10 min) are recorded. After EVENT_MAX_ATTEMPTS the event
 *   is DEAD: kept for an operator (outbox_backlog() reports dead events to /readyz and /metrics).
 * - Retention: delivered events lose their payload at once and are deleted after 7 days; dead ones
 *   after 30 (services/privacy/retention.ts).
 * - Across organizations: the worker asks tenants_with_due_events() (SECURITY DEFINER, ids only)
 *   which organizations have events due, then dispatches each under its own context.
 */
import type { PrismaClient } from '../generated/prisma/client.js';
import { config } from '../config.js';
import { db, type Tx, withTenant } from './db.js';
import { type DomainEvent, setDispatchKick } from './events.js';
import { handleDomainEvent } from '../services/notifications/notifier.js';
import { queueWebhookDeliveries } from '../services/integrations/webhooks.js';
import { captureError } from './errorReporter.js';

export type EventHandler = (tx: Tx, e: DomainEvent, eventId: string) => Promise<unknown>;

export interface DispatchOptions {
  prisma?: PrismaClient;
  handler?: EventHandler;
  maxAttempts?: number;
  /** Most events delivered per call (per organization). */
  limit?: number;
}

export interface DispatchResult {
  delivered: number;
  retried: number;
  dead: number;
}

/** The default handler: the app's notifications, then a delivery for each subscribed webhook endpoint. */
export const defaultHandler: EventHandler = async (tx, e, eventId) => {
  await handleDomainEvent(tx, e, eventId);
  await queueWebhookDeliveries(tx, e, eventId);
};

/** Wait before the next try, after `attempts` failures. */
export const backoffMs = (attempts: number) => Math.min(5_000 * 2 ** Math.max(0, attempts - 1), 10 * 60_000);

const errorText = (err: unknown) => String(err instanceof Error ? err.message : err).slice(0, 500);

/** Deliver one organization's due events. */
export async function dispatchTenant(tenantId: string, opts: DispatchOptions = {}): Promise<DispatchResult> {
  const prisma = opts.prisma ?? db();
  const handler = opts.handler ?? defaultHandler;
  const max = opts.maxAttempts ?? config().EVENT_MAX_ATTEMPTS;
  const out: DispatchResult = { delivered: 0, retried: 0, dead: 0 };
  for (let i = 0; i < (opts.limit ?? 200); i++) {
    const r = await withTenant(
      tenantId,
      async (tx) => {
        const rows = await tx.$queryRaw<Array<{ id: string; payload: DomainEvent; attempts: number }>>`
          SELECT id, payload, attempts FROM "EventOutbox"
           WHERE status = 'PENDING' AND "availableAt" <= now()
           ORDER BY "availableAt", "createdAt" LIMIT 1
           FOR UPDATE SKIP LOCKED`;
        const row = rows[0];
        if (!row) return null;
        await tx.$executeRawUnsafe('SAVEPOINT fh_event');
        try {
          await handler(tx, { ...row.payload, tenantId }, row.id);
          await tx.$executeRawUnsafe('RELEASE SAVEPOINT fh_event');
        } catch (err) {
          await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT fh_event');
          const attempts = row.attempts + 1;
          const dead = attempts >= max;
          await tx.eventOutbox.update({
            where: { id: row.id },
            data: { attempts, lastError: errorText(err), ...(dead ? { status: 'DEAD' } : { availableAt: new Date(Date.now() + backoffMs(attempts)) }) },
          });
          if (dead) captureError(err, { source: 'job', tags: { job: 'events', event: row.payload.type } });
          return dead ? 'dead' : 'retried';
        }
        // The contents (names, messages) aren't needed once delivered.
        await tx.eventOutbox.update({ where: { id: row.id }, data: { status: 'DELIVERED', deliveredAt: new Date(), attempts: row.attempts + 1, lastError: null, payload: {} } });
        return 'delivered';
      },
      { prisma, timeoutMs: 30_000 },
    );
    if (!r) break;
    out[r]++;
  }
  return out;
}

/** Every organization with events due (the worker). */
export async function dispatchAll(opts: DispatchOptions = {}): Promise<DispatchResult> {
  const prisma = opts.prisma ?? db();
  const total: DispatchResult = { delivered: 0, retried: 0, dead: 0 };
  const ids = await prisma.$queryRaw<Array<{ id: string }>>`SELECT tenants_with_due_events() AS id`;
  for (const { id } of ids) {
    const r = await dispatchTenant(id, opts);
    total.delivered += r.delivered;
    total.retried += r.retried;
    total.dead += r.dead;
  }
  return total;
}

/**
 * In-process delivery right after a commit. Coalesced per organization: a kick while one is
 * running runs it once more afterwards. Errors are reported, never thrown: the worker retries.
 */
export function enableInlineDispatch(opts: DispatchOptions = {}): () => Promise<void> {
  const running = new Map<string, Promise<void>>();
  const again = new Set<string>();
  const run = (tenantId: string) => {
    const p = (async () => {
      do {
        again.delete(tenantId);
        await dispatchTenant(tenantId, { ...opts, limit: 50 }).catch((err) => captureError(err, { source: 'other', tags: { task: 'events:inline' } }));
      } while (again.has(tenantId));
    })().finally(() => running.delete(tenantId));
    running.set(tenantId, p);
  };
  setDispatchKick((tenantId) => {
    if (running.has(tenantId)) again.add(tenantId);
    else setImmediate(() => (running.has(tenantId) ? again.add(tenantId) : run(tenantId)));
  });
  /** Turns it off and waits for deliveries in progress (tests, shutdown). */
  return async () => {
    setDispatchKick(null);
    await Promise.all(running.values());
  };
}
