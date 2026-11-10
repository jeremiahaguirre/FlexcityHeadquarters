import { Prisma, PrismaClient } from '@prisma/client';
import { config } from '../config.js';

let client: PrismaClient | undefined;

/** Prisma client connected as the non-owner app role (RLS enforced). */
export function db(): PrismaClient {
  client ??= new PrismaClient({ datasources: { db: { url: pooled(config().APP_DATABASE_URL) } } });
  return client;
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
  opts: { isolationLevel?: Prisma.TransactionIsolationLevel; prisma?: PrismaClient; timeoutMs?: number } = {},
): Promise<T> {
  if (!UUID.test(tenantId)) throw new Error('Invalid tenant id');
  const prisma = opts.prisma ?? db();
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      return fn(tx);
    },
    // maxWait: how long to wait for a free connection under load before giving up (Prisma's default is 2 s).
    { isolationLevel: opts.isolationLevel, timeout: opts.timeoutMs ?? 15_000, maxWait: config().DB_POOL_TIMEOUT_S * 1000 },
  );
}

/** Serialise work per key inside the current transaction (released at commit/rollback). */
export async function advisoryLock(tx: Tx, key: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
}

export async function audit(
  tx: Tx,
  entry: { tenantId: string; actorId: string | null; action: string; entity: string; entityId?: string; before?: unknown; after?: unknown },
): Promise<void> {
  await tx.auditLog.create({
    data: {
      tenantId: entry.tenantId,
      actorId: entry.actorId,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId,
      before: entry.before === undefined ? undefined : (JSON.parse(JSON.stringify(entry.before)) as Prisma.InputJsonValue),
      after: entry.after === undefined ? undefined : (JSON.parse(JSON.stringify(entry.after)) as Prisma.InputJsonValue),
    },
  });
}

/** Every tenant id (via a SECURITY DEFINER function), for background jobs. */
export async function tenantIds(prisma: PrismaClient = db()): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`SELECT all_tenant_ids() AS id`;
  return rows.map((r) => r.id);
}
