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

/** Gives back a reserved slot (see reserve()). Safe to call more than once. */
export type Release = () => Promise<void>;

/**
 * Atomically takes a slot under `limit` for the key (like allow()), and returns a function that
 * gives it back, or null when the window is full. For "count the attempt first, verify after":
 * concurrent attempts can't all slip under the limit while a slow check (a password hash) runs,
 * and an attempt that turns out right gives its slot back (only failures stay counted).
 */
export async function reserve(key: string, limit: number, windowMs: number): Promise<Release | null> {
  const now = Date.now();
  if (shared()) {
    const id = await db().$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
      const used = await tx.rateLimitHit.count({ where: { key, at: { gt: new Date(now - windowMs) } } });
      if (used >= limit) return null;
      return (await tx.rateLimitHit.create({ data: { key, at: new Date(now) }, select: { id: true } })).id;
    });
    if (id === null) return null;
    let done = false;
    return async () => {
      if (done) return;
      done = true;
      await db().rateLimitHit.deleteMany({ where: { id } });
    };
  }
  // In memory nothing awaits between the count and the push, so this is atomic in the process.
  const list = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (list.length >= limit) {
    hits.set(key, list);
    return null;
  }
  list.push(now);
  hits.set(key, list);
  let done = false;
  return async () => {
    if (done) return;
    done = true;
    const l = hits.get(key);
    const i = l ? l.lastIndexOf(now) : -1;
    if (l && i >= 0) l.splice(i, 1);
  };
}

/** Forgets every hit of every key starting with `prefix` (e.g. an account's failures once it signs in). */
export async function clearPrefix(prefix: string): Promise<void> {
  if (shared()) {
    await db().$executeRaw`DELETE FROM "RateLimitHit" WHERE key LIKE ${likePrefix(prefix)}`;
    return;
  }
  for (const k of [...hits.keys()]) if (k.startsWith(prefix)) hits.delete(k);
}

/** When the key was last hit within the window (ms since the epoch), or null. */
export async function latest(key: string, windowMs: number): Promise<number | null> {
  const now = Date.now();
  if (shared()) {
    const r = await db().rateLimitHit.findFirst({ where: { key, at: { gt: new Date(now - windowMs) } }, orderBy: { at: 'desc' }, select: { at: true } });
    return r ? r.at.getTime() : null;
  }
  const l = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  return l.length ? Math.max(...l) : null;
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
