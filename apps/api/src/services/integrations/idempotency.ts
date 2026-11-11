/**
 * Idempotency-Key for the public API's POST requests (docs/PUBLIC-API.md).
 *
 * - The first request with a key claims it: a row with the request's fingerprint (method, path and
 *   body, SHA-256) and no answer yet. Its answer (2xx or 4xx, never a 5xx) is stored with it.
 * - The same key with the same request within 24 hours gets the stored answer again, without the
 *   change being made twice. The same key with a different request is refused (409). While the
 *   first is still being handled, a second answers 409 IDEMPOTENCY_IN_PROGRESS: retry shortly.
 * - Keys belong to one API key in one organization (row-level security), and expire after 24 hours
 *   (removed by services/privacy/retention.ts).
 */
import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { withTenant } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';

export const IDEMPOTENCY_TTL_MS = 24 * 3_600_000;
const KEY_RE = /^[\x21-\x7e]{1,255}$/;

export interface StoredAnswer {
  status: number;
  body: unknown;
  etag?: string | null;
  location?: string | null;
}

/** JSON with object keys sorted, so the same body sent with keys in another order matches. */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
}

export const requestHash = (method: string, path: string, body: unknown) => createHash('sha256').update(`${method}\n${path}\n${canonical(body)}`).digest('hex');

/** Checks the header's value: 1 to 255 visible ASCII characters. */
export function idempotencyKeyOf(raw: string | undefined): string {
  if (!raw) throw new HttpError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Send an `Idempotency-Key` header with every POST (a UUID you make for this change, reused when you retry it).');
  if (!KEY_RE.test(raw)) throw new HttpError(400, 'IDEMPOTENCY_KEY_INVALID', 'An Idempotency-Key is 1 to 255 visible ASCII characters.');
  return raw;
}

/** Claims the key for this request, or returns the answer already given to it. */
export async function claimIdempotency(tenantId: string, apiKeyId: string, key: string, method: string, path: string, hash: string): Promise<{ claimId: string } | { replay: StoredAnswer }> {
  return withTenant(tenantId, async (tx) => {
    const now = new Date();
    await tx.apiIdempotencyKey.deleteMany({ where: { apiKeyId, key, expiresAt: { lte: now } } });
    // ON CONFLICT DO NOTHING: of two requests racing with one key, one claims it.
    const made = await tx.apiIdempotencyKey.createMany({ data: [{ tenantId, apiKeyId, key, method, path, requestHash: hash, expiresAt: new Date(now.getTime() + IDEMPOTENCY_TTL_MS) }], skipDuplicates: true });
    const row = await tx.apiIdempotencyKey.findUniqueOrThrow({ where: { tenantId_apiKeyId_key: { tenantId, apiKeyId, key } } });
    if (made.count) return { claimId: row.id };
    if (row.requestHash !== hash) throw new HttpError(409, 'IDEMPOTENCY_KEY_REUSED', 'This Idempotency-Key was already used for a different request. Use a new key for a new change.');
    if (row.status === null) throw new HttpError(409, 'IDEMPOTENCY_IN_PROGRESS', 'A request with this Idempotency-Key is still being handled. Retry in a moment.');
    return { replay: { status: row.status, body: row.response, etag: row.etag, location: row.location } };
  });
}

/** Stores the answer, so a retry gets it again. */
export async function finishIdempotency(tenantId: string, claimId: string, a: StoredAnswer): Promise<void> {
  await withTenant(tenantId, (tx) => tx.apiIdempotencyKey.update({ where: { id: claimId }, data: { status: a.status, response: (a.body ?? null) as Prisma.InputJsonValue, etag: a.etag ?? null, location: a.location ?? null } }));
}

/** Lets the key be used again (the request failed on our side, so nothing was changed). */
export async function releaseIdempotency(tenantId: string, claimId: string): Promise<void> {
  await withTenant(tenantId, (tx) => tx.apiIdempotencyKey.deleteMany({ where: { id: claimId, status: null } }));
}
