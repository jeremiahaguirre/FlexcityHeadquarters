/**
 * Sliding-window limiter for sign-in, reset and enquiry endpoints.
 *
 * In production the hits live in Postgres (RateLimitHit), shared by every API
 * server, so the limit holds however many instances run and survives restarts.
 * Elsewhere (development, tests) an in-memory map is used. The per-account
 * lockout in the database remains the durable control for passwords.
 */
import { config } from '../config.js';
import { db } from '../lib/db.js';

const hits = new Map<string, number[]>();

function memoryAllow(key: string, limit: number, windowMs: number, now: number): boolean {
  const list = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (list.length >= limit) {
    hits.set(key, list);
    return false;
  }
  list.push(now);
  hits.set(key, list);
  if (hits.size > 50_000) for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k);
  return true;
}

/** Shared store: count recent hits for the key, record this one if under the limit. */
export async function databaseAllow(key: string, limit: number, windowMs: number, now = new Date()): Promise<boolean> {
  const since = new Date(now.getTime() - windowMs);
  return db().$transaction(async (tx) => {
    // One attempt at a time per key, so concurrent requests can't both slip under the limit.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
    const count = await tx.rateLimitHit.count({ where: { key, at: { gt: since } } });
    if (count >= limit) return false;
    await tx.rateLimitHit.create({ data: { key, at: now } });
    if (Math.random() < 0.01) await tx.rateLimitHit.deleteMany({ where: { at: { lt: new Date(now.getTime() - 86_400_000) } } });
    return true;
  });
}

const shared = () => process.env.RATE_LIMIT_STORE === 'database' || (process.env.RATE_LIMIT_STORE !== 'memory' && config().NODE_ENV === 'production');

export async function allow(key: string, limit: number, windowMs: number): Promise<boolean> {
  return shared() ? databaseAllow(key, limit, windowMs) : memoryAllow(key, limit, windowMs, Date.now());
}

export function resetLimits(): void {
  hits.clear();
}
