/**
 * Sliding-window limiter for sign-in, reset and enquiry endpoints.
 *
 * In production the hits live in Postgres (RateLimitHit), shared by every API
 * server, so the limit holds however many instances run and survives restarts.
 * Elsewhere (development, tests) an in-memory map is used, unless this is one of several
 * processes (WEB_CONCURRENCY > 1), where a per-process count would let each process grant the
 * full limit: those use Postgres too. The per-account
 * lockout in the database remains the durable control for passwords.
 */
import cluster from 'node:cluster';
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

const shared = () => process.env.RATE_LIMIT_STORE === 'database' || (process.env.RATE_LIMIT_STORE !== 'memory' && (config().NODE_ENV === 'production' || cluster.isWorker));

export async function allow(key: string, limit: number, windowMs: number): Promise<boolean> {
  return shared() ? databaseAllow(key, limit, windowMs) : memoryAllow(key, limit, windowMs, Date.now());
}

export function resetLimits(): void {
  hits.clear();
}

/** Whether a key already reached its limit, without counting this look (e.g. only wrong PINs count). */
export async function reached(key: string, limit: number, windowMs: number): Promise<boolean> {
  const now = Date.now();
  if (shared()) return (await db().rateLimitHit.count({ where: { key, at: { gt: new Date(now - windowMs) } } })) >= limit;
  return (hits.get(key) ?? []).filter((t) => now - t < windowMs).length >= limit;
}

/** Counts one hit against a key (a failure), whatever the limit. */
export async function record(key: string): Promise<void> {
  if (shared()) await db().rateLimitHit.create({ data: { key, at: new Date() } });
  else hits.set(key, [...(hits.get(key) ?? []), Date.now()]);
}

/** How many hits a key has in the window (nothing is recorded). */
export async function count(key: string, windowMs: number): Promise<number> {
  const now = Date.now();
  if (shared()) return db().rateLimitHit.count({ where: { key, at: { gt: new Date(now - windowMs) } } });
  return (hits.get(key) ?? []).filter((t) => now - t < windowMs).length;
}

const likePrefix = (p: string) => `${p.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/**
 * How many different keys starting with `prefix` have a hit in the window: e.g. the different
 * accounts one address failed to sign in to (keys `prefix` + an account hash).
 */
export async function distinctCount(prefix: string, windowMs: number): Promise<number> {
  const now = Date.now();
  if (shared()) {
    const rows = await db().$queryRaw<Array<{ n: bigint }>>`SELECT count(DISTINCT key) AS n FROM "RateLimitHit" WHERE key LIKE ${likePrefix(prefix)} AND at > ${new Date(now - windowMs)}`;
    return Number(rows[0]?.n ?? 0);
  }
  let n = 0;
  for (const [k, v] of hits) if (k.startsWith(prefix) && v.some((t) => now - t < windowMs)) n++;
  return n;
}

export interface Quota {
  allowed: boolean;
  limit: number;
  /** Requests left in the window after this one. */
  remaining: number;
  /** Seconds until the window frees a slot (the oldest hit in it ages out). */
  resetSeconds: number;
}

/**
 * Like databaseAllow, in the shared store, and says how much is left: for X-RateLimit-Remaining
 * and X-RateLimit-Reset on the public API.
 */
export async function databaseConsume(key: string, limit: number, windowMs: number, now = new Date()): Promise<Quota> {
  const since = new Date(now.getTime() - windowMs);
  return db().$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
    const used = await tx.rateLimitHit.count({ where: { key, at: { gt: since } } });
    const oldest = used ? await tx.rateLimitHit.findFirst({ where: { key, at: { gt: since } }, orderBy: { at: 'asc' }, select: { at: true } }) : null;
    const resetSeconds = Math.max(1, Math.ceil(((oldest ? oldest.at.getTime() + windowMs : now.getTime() + windowMs) - now.getTime()) / 1000));
    if (used >= limit) return { allowed: false, limit, remaining: 0, resetSeconds };
    await tx.rateLimitHit.create({ data: { key, at: now } });
    if (Math.random() < 0.01) await tx.rateLimitHit.deleteMany({ where: { at: { lt: new Date(now.getTime() - 86_400_000) } } });
    return { allowed: true, limit, remaining: limit - used - 1, resetSeconds };
  });
}
