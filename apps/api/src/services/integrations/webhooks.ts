/**
 * Webhooks: signed events pushed to addresses on a city's own systems (docs/PUBLIC-API.md).
 *
 * - Events: the database records them in the transaction of the change (db/rls.sql
 *   fh_public_event), into the event outbox. The outbox dispatcher (lib/outbox.ts) calls
 *   queueWebhookDeliveries(), which adds one delivery per enabled endpoint that subscribed, in that
 *   same transaction; a dedupe key keeps an event the outbox delivers twice from being queued twice.
 * - Sending: the worker (and a "Send test event" or "Redeliver" click) claims due deliveries with
 *   `FOR UPDATE SKIP LOCKED` and a short lease, so any number of workers never send one at the same
 *   time, then posts outside any transaction. Each delivery is signed (signing.ts) with a timestamp.
 * - Where it may go: https only (http to localhost only in tests that ask for it), and the address
 *   must resolve to the public internet, checked when it's saved and again at every send, and the
 *   connection goes to the address that was checked (no second lookup to rebind). Redirects are
 *   never followed: a 3xx counts as a failure.
 * - Failures: retried with backoff (1 min, 5 min, 30 min, 2 h, 6 h, 12 h, 24 h). After
 *   WEBHOOK_DISABLE_AFTER failed tries in a row the endpoint is turned off, and the organization's
 *   administrators are told in the app and by email.
 * - Records: status, tries, the answer's code and its first 500 characters. Never a secret. Kept
 *   30 days (services/privacy/retention.ts).
 */
import { randomBytes, randomUUID } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';
import type { Prisma, PrismaClient } from '@prisma/client';
import { config } from '../../config.js';
import { audit, db, type Tx, withTenant } from '../../lib/db.js';
import { assertPublicUrl } from '../../lib/egress.js';
import { captureError } from '../../lib/errorReporter.js';
import { type DomainEvent, isPublicEvent, PUBLIC_EVENT_TYPES } from '../../lib/events.js';
import { webhookDeliveries } from '../../lib/metrics.js';
import { keys, tenantKekId } from '../../routes/context.js';
import { open, seal } from '../crypto/envelope.js';
import { notify } from '../notifications/notifier.js';
import { SIGNATURE_HEADER, signatureHeader } from './signing.js';

export const WEBHOOK_EVENT_TYPES = PUBLIC_EVENT_TYPES;
export const TEST_EVENT = 'ping';


/* ---------- Secrets ---------- */

type SealedJson = { c: string; iv: string; t: string; k: string; kek: string };
const aad = (tenantId: string) => `webhook-secret:${tenantId}`;

export const newSigningSecret = () => `whsec_${randomBytes(32).toString('base64url')}`;

export async function sealSecret(tenantId: string, value: string): Promise<SealedJson> {
  const s = await seal(keys(), tenantKekId(tenantId), value, aad(tenantId));
  return { c: s.ciphertext.toString('base64'), iv: s.iv.toString('base64'), t: s.authTag.toString('base64'), k: s.wrappedDataKey.toString('base64'), kek: s.kekId };
}

async function openSecret(tenantId: string, raw: unknown): Promise<string> {
  const c = raw as SealedJson;
  return open(keys(), { ciphertext: Buffer.from(c.c, 'base64'), iv: Buffer.from(c.iv, 'base64'), authTag: Buffer.from(c.t, 'base64'), wrappedDataKey: Buffer.from(c.k, 'base64'), kekId: c.kek }, aad(tenantId));
}

/** The secrets that sign a delivery now: the current one, and the previous one during its overlap. */
async function signingSecrets(tenantId: string, ep: { secret: unknown; previousSecret: unknown; previousSecretUntil: Date | null }): Promise<string[]> {
  const out = [await openSecret(tenantId, ep.secret)];
  if (ep.previousSecret && ep.previousSecretUntil && ep.previousSecretUntil > new Date()) out.push(await openSecret(tenantId, ep.previousSecret));
  return out;
}

/* ---------- Where it may go ---------- */

/** Tests run a receiver on localhost; nothing else may point a webhook there. */
const localTargets = () => config().NODE_ENV !== 'production' && process.env.WEBHOOK_LOCAL_TARGETS === 'on';

/** Refuses an address that isn't https on the public internet (when saved, and before each send). */
export const checkWebhookUrl = (url: string) => assertPublicUrl(url, 'The webhook address', { allowLocal: localTargets() });

/* ---------- Queueing ---------- */

export function payloadFor(eventId: string, type: string, tenantId: string, data: Record<string, unknown>, createdAt = new Date()) {
  return { id: eventId, type, created_at: createdAt.toISOString(), organization_id: tenantId, data };
}

/** The outbox handler's part: a delivery per enabled endpoint that wants this event. */
export async function queueWebhookDeliveries(tx: Tx, e: DomainEvent, eventId: string): Promise<number> {
  if (!isPublicEvent(e)) return 0;
  const endpoints = await tx.webhookEndpoint.findMany({ where: { enabled: true, events: { has: e.type } }, select: { id: true } });
  if (!endpoints.length) return 0;
  const payload = payloadFor(eventId, e.type, e.tenantId, e.data) as unknown as Prisma.InputJsonValue;
  const r = await tx.webhookDelivery.createMany({
    data: endpoints.map((ep) => ({ tenantId: e.tenantId, endpointId: ep.id, eventId, eventType: e.type, payload, dedupeKey: `${eventId}:${ep.id}` })),
    skipDuplicates: true,
  });
  return r.count;
}

/* ---------- Sending ---------- */

export interface SendResult {
  status?: number;
  body?: string;
  error?: string;
  durationMs: number;
}
export type Sender = (url: string, body: string, headers: Record<string, string>) => Promise<SendResult>;

const RESPONSE_KEEP = 500;

/** POSTs to the address that passed the public-internet check, never following a redirect. */
export const httpSender: Sender = async (url, body, headers) => {
  const started = Date.now();
  let address: string;
  try {
    address = await checkWebhookUrl(url);
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Address refused', durationMs: Date.now() - started };
  }
  const u = new URL(url);
  const secure = u.protocol === 'https:';
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const timeoutMs = config().WEBHOOK_TIMEOUT_MS;
  return new Promise<SendResult>((resolve) => {
    let done = false;
    const finish = (r: Omit<SendResult, 'durationMs'>) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ ...r, durationMs: Date.now() - started });
    };
    const req = (secure ? https : http).request(
      {
        host: address,
        port: u.port || (secure ? 443 : 80),
        path: `${u.pathname}${u.search}`,
        method: 'POST',
        // TLS checks the certificate against the name that was typed, not the address.
        ...(secure && !isIP(host) ? { servername: host } : {}),
        headers: { ...headers, host: u.host, 'content-length': String(Buffer.byteLength(body)) },
        agent: false,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (c: Buffer) => {
          if (size < 2048) chunks.push(c);
          size += c.length;
          if (size >= 2048) res.destroy();
        });
        const end = () => finish({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8').slice(0, RESPONSE_KEEP) });
        res.on('end', end);
        res.on('close', end);
        res.on('error', end);
      },
    );
    const timer = setTimeout(() => {
      req.destroy();
      finish({ error: `No answer within ${Math.round(timeoutMs / 1000)} s` });
    }, timeoutMs);
    req.on('error', (e) => finish({ error: e.message.slice(0, 300) }));
    req.end(body);
  });
};

/** Wait before the next try, after `attempts` failed tries. */
const BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3_600_000, 6 * 3_600_000, 12 * 3_600_000, 24 * 3_600_000];
export const webhookBackoffMs = (attempts: number) => BACKOFF_MS[Math.min(Math.max(attempts, 1), BACKOFF_MS.length) - 1]!;

const LEASE_MS = 2 * 60_000;
const ok = (r: SendResult) => r.status !== undefined && r.status >= 200 && r.status < 300;
const failureText = (r: SendResult) => r.error ?? (r.status && r.status >= 300 && r.status < 400 ? `Answered ${r.status} (redirects aren’t followed)` : `Answered ${r.status}`);

export interface AttemptOptions {
  send?: Sender;
  prisma?: PrismaClient;
}

/**
 * One try of one delivery (already claimed, or made by a click). Manual sends (a test event or a
 * redelivery) are tried once and don't count toward turning the endpoint off.
 */
export async function attemptDelivery(tenantId: string, deliveryId: string, opts: AttemptOptions = {}): Promise<{ ok: boolean; status: string }> {
  const prisma = opts.prisma ?? db();
  const loaded = await withTenant(tenantId, async (tx) => tx.webhookDelivery.findUnique({ where: { id: deliveryId }, include: { endpoint: true } }), { prisma });
  if (!loaded || loaded.status !== 'PENDING') return { ok: false, status: loaded?.status ?? 'MISSING' };
  const ep = loaded.endpoint;
  const manual = loaded.test || !!loaded.redeliveryOfId;
  if (!ep.enabled && !manual) {
    await withTenant(tenantId, (tx) => tx.webhookDelivery.update({ where: { id: deliveryId }, data: { status: 'FAILED', error: 'The endpoint is turned off.' } }), { prisma });
    return { ok: false, status: 'FAILED' };
  }
  const body = JSON.stringify(loaded.payload);
  let result: SendResult;
  try {
    const secrets = await signingSecrets(tenantId, ep);
    const headers = {
      'content-type': 'application/json',
      'user-agent': 'FlexcityHeadquarters-Webhooks/1',
      'fh-event-id': loaded.eventId,
      'fh-event-type': loaded.eventType,
      'fh-delivery-id': loaded.id,
      [SIGNATURE_HEADER.toLowerCase()]: signatureHeader(secrets, body),
    };
    result = await (opts.send ?? httpSender)(ep.url, body, headers);
  } catch (err) {
    captureError(err, { source: 'job', tags: { job: 'webhooks' } });
    result = { error: 'Couldn’t sign or send this delivery.', durationMs: 0 };
  }
  const success = ok(result);
  webhookDeliveries.inc({ type: loaded.eventType, outcome: success ? 'ok' : 'failed' });
  const max = manual ? 1 : config().WEBHOOK_MAX_ATTEMPTS;
  const attempts = loaded.attempts + 1;
  const now = new Date();
  const status = success ? 'SUCCEEDED' : attempts >= max ? 'FAILED' : 'PENDING';
  await withTenant(
    tenantId,
    async (tx) => {
      await tx.webhookDelivery.update({
        where: { id: deliveryId },
        data: {
          status,
          attempts,
          lastAttemptAt: now,
          responseStatus: result.status ?? null,
          responseBody: result.body ?? null,
          error: success ? null : failureText(result).slice(0, 300),
          durationMs: result.durationMs,
          ...(success ? { deliveredAt: now } : status === 'PENDING' ? { nextAttemptAt: new Date(now.getTime() + webhookBackoffMs(attempts)) } : {}),
        },
      });
      if (manual) return;
      if (success) {
        await tx.webhookEndpoint.update({ where: { id: ep.id }, data: { consecutiveFailures: 0, lastSuccessAt: now } });
        return;
      }
      const e = await tx.webhookEndpoint.update({ where: { id: ep.id }, data: { consecutiveFailures: { increment: 1 }, lastFailureAt: now } });
      if (e.enabled && e.consecutiveFailures >= config().WEBHOOK_DISABLE_AFTER) await disableForFailures(tx, tenantId, e);
    },
    { prisma },
  );
  return { ok: success, status };
}

/** Too many failed tries in a row: turn the endpoint off, stop its queue, tell the administrators. */
async function disableForFailures(tx: Tx, tenantId: string, ep: { id: string; url: string; consecutiveFailures: number }) {
  await tx.webhookEndpoint.update({ where: { id: ep.id }, data: { enabled: false, disabledAt: new Date(), disabledReason: 'failures' } });
  await tx.webhookDelivery.updateMany({ where: { endpointId: ep.id, status: 'PENDING' }, data: { status: 'FAILED', error: 'The endpoint was turned off after too many failures.' } });
  await audit(tx, { tenantId, actorId: null, action: 'webhook.auto_disable', entity: 'WebhookEndpoint', entityId: ep.id, after: { failures: ep.consecutiveFailures } });
  const admins = await tx.user.findMany({ where: { status: 'ACTIVE', anonymizedAt: null, roles: { has: 'HR_ADMIN' } }, select: { id: true } });
  const host = new URL(ep.url).host;
  await notify(tx, tenantId, admins.map((u) => ({ userId: u.id, type: 'webhook_disabled', params: { host, failures: ep.consecutiveFailures }, link: '/manage/settings?tab=integrations', email: 'webhook_disabled' })));
}

/** Claims one due delivery for a short lease (SKIP LOCKED), or null. */
async function claim(tenantId: string, prisma: PrismaClient): Promise<string | null> {
  return withTenant(
    tenantId,
    async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        UPDATE "WebhookDelivery" SET "nextAttemptAt" = now() + ${`${LEASE_MS / 1000} seconds`}::interval
         WHERE id = (SELECT id FROM "WebhookDelivery" WHERE status = 'PENDING' AND "nextAttemptAt" <= now()
                      ORDER BY "nextAttemptAt", "createdAt" LIMIT 1 FOR UPDATE SKIP LOCKED)
         RETURNING id`;
      return rows[0]?.id ?? null;
    },
    { prisma },
  );
}

export interface DeliverResult {
  sent: number;
  failed: number;
}

/** Sends one organization's due deliveries. */
export async function deliverTenantWebhooks(tenantId: string, opts: AttemptOptions & { limit?: number } = {}): Promise<DeliverResult> {
  const prisma = opts.prisma ?? db();
  const out: DeliverResult = { sent: 0, failed: 0 };
  for (let i = 0; i < (opts.limit ?? 100); i++) {
    const id = await claim(tenantId, prisma);
    if (!id) break;
    const r = await attemptDelivery(tenantId, id, opts);
    if (r.ok) out.sent++;
    else out.failed++;
  }
  return out;
}

/** Every organization with deliveries due (the worker). */
export async function deliverAllWebhooks(opts: AttemptOptions = {}): Promise<DeliverResult> {
  const prisma = opts.prisma ?? db();
  const total: DeliverResult = { sent: 0, failed: 0 };
  const ids = await prisma.$queryRaw<Array<{ id: string }>>`SELECT tenants_with_due_webhooks() AS id`;
  for (const { id } of ids) {
    const r = await deliverTenantWebhooks(id, opts);
    total.sent += r.sent;
    total.failed += r.failed;
  }
  return total;
}

/* ---------- Manual sends ---------- */

/** A "ping" to one endpoint, sent now. */
export async function sendTestEvent(tenantId: string, endpointId: string, opts: AttemptOptions = {}) {
  const prisma = opts.prisma ?? db();
  const eventId = randomUUID();
  const d = await withTenant(
    tenantId,
    (tx) => tx.webhookDelivery.create({ data: { tenantId, endpointId, eventId, eventType: TEST_EVENT, test: true, payload: payloadFor(eventId, TEST_EVENT, tenantId, { message: 'A test event from FlexcityHeadquarters.' }) as Prisma.InputJsonValue } }),
    { prisma },
  );
  await attemptDelivery(tenantId, d.id, opts);
  return d.id;
}

/** The same event again (same event id, so receivers can tell it's a repeat), sent now. */
export async function redeliver(tx: Tx, tenantId: string, deliveryId: string) {
  const d = await tx.webhookDelivery.findUnique({ where: { id: deliveryId } });
  if (!d) return null;
  return tx.webhookDelivery.create({ data: { tenantId, endpointId: d.endpointId, eventId: d.eventId, eventType: d.eventType, payload: d.payload as Prisma.InputJsonValue, test: d.test, redeliveryOfId: d.redeliveryOfId ?? d.id } });
}
