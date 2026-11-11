import { Prisma, PrismaClient } from '@prisma/client';
import { config } from '../config.js';
import { dbQueryDuration, dbSlowQueries } from './metrics.js';

let client: PrismaClient | undefined;
let replicaClient: PrismaClient | undefined;

/** Prisma client connected as the non-owner app role (RLS enforced). */
export function db(): PrismaClient {
  if (!client) client = connect(config().APP_DATABASE_URL);
  return client;
}

/**
 * The read replica (READ_REPLICA_URL), for heavy reads that may lag the primary by a few seconds,
 * such as running reports. Without one configured it is the primary. Use it through
 * withTenant(…, { readOnly: true, prisma: replica() }) so a write fails the same way on both.
 */
export function replica(): PrismaClient {
  const url = config().READ_REPLICA_URL;
  if (!url) return db();
  if (!replicaClient) replicaClient = connect(url);
  return replicaClient;
}

function connect(url: string): PrismaClient {
  // With metrics on (METRICS_TOKEN), each query's duration goes to fh_db_query_duration_seconds.
  // Queries slower than SLOW_QUERY_MS are logged and counted: the SQL text only (it has $1-style
  // placeholders), never the parameters, which can hold personal information.
  const timed = !!config().METRICS_TOKEN;
  const slowMs = config().SLOW_QUERY_MS;
  const listen = timed || slowMs > 0;
  const c = new PrismaClient({ datasources: { db: { url: pooled(url) } }, ...(listen ? { log: [{ emit: 'event' as const, level: 'query' as const }] } : {}) });
  if (listen) (c as unknown as PrismaClient<Prisma.PrismaClientOptions, 'query'>).$on('query', (e) => onQuery(e.duration, e.query, timed, slowMs));
  return c;
}

/**
 * The query as logged: whitespace collapsed and Prisma's long column list shortened to "SELECT …",
 * so the FROM and WHERE (what explains a slow query) fit in the 400 characters kept.
 */
export function shortSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').replace(/^SELECT (?:(?!\bFROM\b).)+? FROM /, 'SELECT … FROM ').slice(0, 400);
}

/** One query finished: time it, and log it if slow (text only, trimmed; never its parameters). */
export function onQuery(durationMs: number, sql: string, timed: boolean, slowMs: number) {
  if (timed) dbQueryDuration.observe({}, durationMs / 1000);
  if (slowMs > 0 && durationMs >= slowMs) {
    dbSlowQueries.inc({});
    console.warn(`[slow-query] ${Math.round(durationMs)} ms: ${shortSql(sql)}`);
  }
}

/** Adds the configured pool size and wait to a connection URL (unless it already says). */
export function pooled(url: string): string {
  const u = new URL(url);
  const c = config();
  if (!u.searchParams.has('connection_limit')) u.searchParams.set('connection_limit', String(c.DB_POOL_SIZE));
  if (!u.searchParams.has('pool_timeout')) u.searchParams.set('pool_timeout', String(c.DB_POOL_TIMEOUT_S));
  return u.toString();
}

export type Tx = Prisma.TransactionClient;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Run `fn` in a transaction whose Postgres session has `app.tenant_id` set.
 * Every tenant-scoped query MUST go through here: RLS policies compare each row's
 * tenantId to this setting, and return nothing if it is missing.
 */
export async function withTenant<T>(
  tenantId: string,
  fn: (tx: Tx) => Promise<T>,
  opts: { isolationLevel?: Prisma.TransactionIsolationLevel; prisma?: PrismaClient; timeoutMs?: number; readOnly?: boolean } = {},
): Promise<T> {
  if (!UUID.test(tenantId)) throw new Error('Invalid tenant id');
  const prisma = opts.prisma ?? db();
  const hooks: Array<() => void> = [];
  const result = await prisma.$transaction(
    async (tx) => {
      commitHooks.set(tx, hooks);
      // Must come before any other statement in the transaction.
      if (opts.readOnly) await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      return fn(tx);
    },
    // maxWait: how long to wait for a free connection under load before giving up (Prisma's default is 2 s).
    { isolationLevel: opts.isolationLevel, timeout: opts.timeoutMs ?? 15_000, maxWait: config().DB_POOL_TIMEOUT_S * 1000 },
  );
  for (const h of hooks) {
    try {
      h();
    } catch {
      // A hook is a best-effort nudge (deliver this now); the worker is the backstop.
    }
  }
  return result;
}

const commitHooks = new WeakMap<object, Array<() => void>>();

/**
 * Run `fn` once the withTenant() transaction `tx` belongs to has committed (never on a rollback).
 * For in-process nudges only, such as "deliver the text just queued": `fn` must be quick and must
 * not need the transaction. Outside withTenant() it does nothing, so the work must also be safe to
 * leave to the worker.
 */
export function afterCommit(tx: Tx, fn: () => void): void {
  commitHooks.get(tx)?.push(fn);
}

/** Serialise work per key inside the current transaction (released at commit/rollback). */
export async function advisoryLock(tx: Tx, key: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
}

export async function audit(
  tx: Tx,
  entry: { tenantId: string; actorId: string | null; action: string; entity: string; entityId?: string; before?: unknown; after?: unknown },
): Promise<void> {
  // A public API write: the key is the actor, whichever service records the change.
  const key = apiKeyActors.get(tx);
  const after = key ? { ...(entry.after && typeof entry.after === 'object' && !Array.isArray(entry.after) ? entry.after : entry.after === undefined ? {} : { value: entry.after }), actor: `API key ${key.name}` } : entry.after;
  await tx.auditLog.create({
    data: {
      tenantId: entry.tenantId,
      actorId: key ? null : entry.actorId,
      apiKeyId: key?.id ?? null,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId,
      before: entry.before === undefined ? undefined : (JSON.parse(JSON.stringify(entry.before)) as Prisma.InputJsonValue),
      after: after === undefined ? undefined : (JSON.parse(JSON.stringify(after)) as Prisma.InputJsonValue),
    },
  });
}

const apiKeyActors = new WeakMap<object, { id: string; name: string }>();

/**
 * Everything audit() records in this withTenant() transaction names the organization API key as
 * its actor (apiKeyId, "API key <name>"), not a person: for the public API's writes.
 */
export function actAsApiKey(tx: Tx, key: { id: string; name: string }): void {
  apiKeyActors.set(tx, key);
}

/** Every tenant id (via a SECURITY DEFINER function), for background jobs. */
export async function tenantIds(prisma: PrismaClient = db()): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`SELECT all_tenant_ids() AS id`;
  return rows.map((r) => r.id);
}
