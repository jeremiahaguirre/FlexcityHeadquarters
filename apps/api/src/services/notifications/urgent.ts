/**
 * Urgent delivery: texts, calls, pushes and emails for alerts that can't wait for the worker's
 * minute (a missed working-alone check-in, a call for help, a winter call-out, an open shift
 * starting soon, a sign-in code).
 *
 * Whoever queues one calls urgentSoon(tx, tenantId) in the same transaction. Once it commits:
 *  - this process delivers that organization's due messages straight away (afterCommit, in-process,
 *    coalesced per organization: enableInlineUrgent() turns it on in the API and the worker);
 *  - the worker hears a pg_notify on URGENT_CHANNEL (sent only on COMMIT) and does the same, so a
 *    message queued by an API process that stopped first still goes out within a second or two;
 *  - the worker also sweeps every few seconds for due texts (tenants_with_due_sms()), which covers
 *    retries and a lost NOTIFY, and keeps its minute jobs as the last backstop.
 * Every path claims each message with `FOR UPDATE SKIP LOCKED` (sms.ts, mailer.ts, push.ts), so
 * running them all at once never sends one twice.
 *
 * A failed safety text is retried after 15 s, 30 s, 60 s, 120 s (a timer here, and the sweep).
 * One still unsent after SAFETY_SMS_ALERT_S raises an alert: checkOverdueSafety() reports it to
 * the error reporter and counts it, and /readyz warns (outbox "sms_safety").
 *
 * There are no quiet hours for texts: every template here is either a safety alert or something
 * the person asked for just now (a code) or opted into (urgent open shifts).
 */
import type { PrismaClient } from '@prisma/client';
import { config } from '../../config.js';
import { afterCommit, db, type Tx, withTenant } from '../../lib/db.js';
import { captureError } from '../../lib/errorReporter.js';
import { safetySmsOverdueAlerts } from '../../lib/metrics.js';
import { deliverEmailTenant, type Mailer } from './mailer.js';
import { deliverPush, pushEnabled } from './push.js';
import { deliverSmsTenant, type SmsSender } from './sms.js';

export const URGENT_CHANNEL = 'fh_urgent';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const announced = new WeakSet<object>();
let kick: ((tenantId: string) => void) | null = null;

/** In the caller's transaction: deliver this organization's urgent messages as soon as it commits. Once per transaction. */
export async function urgentSoon(tx: Tx, tenantId: string): Promise<void> {
  if (announced.has(tx)) return;
  announced.add(tx);
  await tx.$executeRaw`SELECT pg_notify(${URGENT_CHANNEL}, ${tenantId})`;
  afterCommit(tx, () => kick?.(tenantId));
}

/** Ask this process to deliver an organization's urgent messages now (the worker's LISTEN and sweep). */
export function kickUrgent(tenantId: string): void {
  if (UUID.test(tenantId)) kick?.(tenantId);
}

export interface UrgentDeps {
  sms?: SmsSender | null;
  mailer?: Mailer | null;
  prisma?: PrismaClient;
}

/** One organization's due texts and calls (safety first), then pushes, then emails. */
export async function deliverUrgent(tenantId: string, deps: UrgentDeps): Promise<{ sms: number; push: number; email: number; retryInMs: number | null }> {
  const out = { sms: 0, push: 0, email: 0, retryInMs: null as number | null };
  if (deps.sms) {
    const r = await deliverSmsTenant(tenantId, deps.sms, { prisma: deps.prisma, limit: 50 });
    out.sms = r.sent;
    out.retryInMs = r.retryInMs;
  }
  if (pushEnabled()) out.push = await withTenant(tenantId, (tx) => deliverPush(tx), { prisma: deps.prisma, timeoutMs: 60_000 });
  if (deps.mailer) out.email = (await deliverEmailTenant(tenantId, deps.mailer, { prisma: deps.prisma, limit: 20 })).sent;
  return out;
}

/**
 * Turns on in-process delivery after commits (server.ts, worker.ts). Coalesced per organization:
 * a kick while one runs runs it once more afterwards. A failed text schedules its own retry.
 * Errors are reported, never thrown. Returns a function that turns it off and waits (tests, shutdown).
 */
export function enableInlineUrgent(deps: UrgentDeps): () => Promise<void> {
  const running = new Map<string, Promise<void>>();
  const again = new Set<string>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  let on = true;
  const retryAt = new Map<string, number>();
  const scheduleRetry = (tenantId: string, ms: number) => {
    const at = Date.now() + ms;
    if (timers.has(tenantId) && (retryAt.get(tenantId) ?? Infinity) <= at) return;
    clearTimeout(timers.get(tenantId));
    const t = setTimeout(() => {
      timers.delete(tenantId);
      retryAt.delete(tenantId);
      if (on) start(tenantId);
    }, ms + 100);
    t.unref?.();
    timers.set(tenantId, t);
    retryAt.set(tenantId, at);
  };
  const run = (tenantId: string) => {
    const p = (async () => {
      do {
        again.delete(tenantId);
        try {
          const r = await deliverUrgent(tenantId, deps);
          if (r.retryInMs !== null && on) scheduleRetry(tenantId, r.retryInMs);
        } catch (err) {
          captureError(err, { source: 'other', tenantId, tags: { task: 'urgent:inline' } });
        }
      } while (again.has(tenantId) && on);
    })().finally(() => running.delete(tenantId));
    running.set(tenantId, p);
  };
  const start = (tenantId: string) => {
    if (running.has(tenantId)) again.add(tenantId);
    else run(tenantId);
  };
  kick = (tenantId) => {
    if (running.has(tenantId)) again.add(tenantId);
    else setImmediate(() => on && start(tenantId));
  };
  return async () => {
    on = false;
    kick = null;
    for (const t of timers.values()) clearTimeout(t);
    timers.clear();
    await Promise.all(running.values());
  };
}

/** Organizations with texts or calls due now (ids only; the worker's sweep). */
export async function tenantsWithDueSms(prisma: PrismaClient = db()): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`SELECT tenants_with_due_sms() AS id`;
  return rows.map((r) => r.id);
}

export interface OverdueSafety {
  tenantId: string;
  overdue: number;
  oldestAgeS: number;
}

const alerted = new Map<string, { at: number; overdue: number }>();
/** The same organization is alerted again only when more messages are late, or after this long. */
const REALERT_MS = 15 * 60_000;

/**
 * Safety texts and calls still unsent after SAFETY_SMS_ALERT_S (within the last 6 hours), per
 * organization. Each one found raises an alert: an error report (organization id and counts only)
 * and fh_safety_sms_overdue_alerts_total. Run by the worker's sweep.
 */
export async function checkOverdueSafety(prisma: PrismaClient = db(), now = Date.now()): Promise<OverdueSafety[]> {
  const threshold = config().SAFETY_SMS_ALERT_S;
  const rows = await prisma.$queryRaw<Array<{ tenant_id: string; overdue: bigint; oldest_age_s: number }>>`SELECT * FROM safety_sms_overdue(${threshold}::int)`;
  const out = rows.map((r) => ({ tenantId: r.tenant_id, overdue: Number(r.overdue), oldestAgeS: Math.round(Number(r.oldest_age_s)) }));
  for (const r of out) {
    const last = alerted.get(r.tenantId);
    if (last && r.overdue <= last.overdue && now - last.at < REALERT_MS) continue;
    alerted.set(r.tenantId, { at: now, overdue: r.overdue });
    safetySmsOverdueAlerts.inc();
    captureError(new Error(`${r.overdue} safety text(s) or call(s) unsent after ${threshold}s (oldest ${r.oldestAgeS}s)`), { source: 'job', tenantId: r.tenantId, tags: { task: 'sms-safety-overdue' } });
  }
  for (const id of [...alerted.keys()]) if (!out.some((r) => r.tenantId === id)) alerted.delete(id);
  return out;
}
