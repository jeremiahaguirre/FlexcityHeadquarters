/**
 * Cache invalidation across API processes.
 *
 * A few small per-process caches save a query on every request: feature switches and billing state
 * (services/platform/features.ts), custom-role permissions (people/customRoles.ts), department
 * scope (people/departments.ts) and the sign-in page's tenant lookup (routes/context.ts). Each
 * also expires on its own within 30 to 60 seconds. With several processes, dropping an entry in
 * the one that made the change isn't enough: a permission taken away, a feature switched off or an
 * organization suspended must take effect everywhere at once. So each forget is also announced
 * on the `fh_cache` channel ({ cache, tenantId }: names and ids only), and every process's LISTEN
 * connection (lib/listen.ts) drops its copy.
 *
 * Given the transaction that makes the change, the announcement is sent inside it, so Postgres
 * delivers it only on commit (also to this process, which drops again any entry a concurrent
 * request reloaded before the commit). Without one, it goes out straight away (call it after the
 * commit). If the LISTEN connection drops, every cache is cleared once it is back.
 */
import type { PgListener } from './listen.js';
import { db, type Tx } from './db.js';
import { logError } from './log.js';

export const CACHE_CHANNEL = 'fh_cache';

type Forget = (tenantId?: string) => void;
const caches = new Map<string, Forget>();
let announcing = false;

/** Register a cache's local forget; returns the forget to call, which also tells other processes. */
export function sharedForget(name: string, forgetLocal: Forget): (tenantId?: string, tx?: Tx) => Promise<void> {
  caches.set(name, forgetLocal);
  return async (tenantId, tx) => {
    forgetLocal(tenantId);
    if (!announcing) return;
    const payload = JSON.stringify({ cache: name, tenantId: tenantId ?? null });
    try {
      if (tx) await tx.$executeRaw`SELECT pg_notify(${CACHE_CHANNEL}, ${payload})`;
      else await db().$executeRaw`SELECT pg_notify(${CACHE_CHANNEL}, ${payload})`;
    } catch (err) {
      // Inside a transaction a failure here aborts it, so let the caller see it.
      if (tx) throw err;
      logError('cache invalidation not announced', err);
    }
  };
}

/** Listen for other processes' forgets, and announce this one's (server.ts). */
export function attachCacheBus(l: PgListener): () => void {
  announcing = true;
  const off = l.on(CACHE_CHANNEL, (raw) => {
    try {
      const m = JSON.parse(raw) as { cache?: string; tenantId?: string | null };
      caches.get(String(m.cache))?.(m.tenantId ?? undefined);
    } catch {
      /* ignore malformed payloads */
    }
  });
  // Forgets sent while the connection was down were lost: start every cache afresh.
  const offRe = l.onReconnect(() => {
    for (const f of caches.values()) f();
  });
  return () => {
    announcing = false;
    off();
    offRe();
  };
}
