/**
 * Making a Prisma client (Prisma 7). Prisma no longer opens connections itself: queries go through
 * the pg driver adapter (@prisma/adapter-pg) and its pg.Pool, so the pool and TLS settings are pg's.
 *
 * Database URLs stay in the standard libpq form that pg reads directly:
 *   ...?sslmode=verify-full&sslrootcert=/etc/ssl/rds/global-bundle.pem
 * pg verifies the certificate chain against that CA file and the host name (verify-full). That is
 * why the app no longer needs the Prisma-spelled URL (lib/dbUrl.ts prismaUrl(), still used for the
 * Prisma CLI's schema engine in prisma.config.ts).
 *
 * The Prisma 5 pool parameters some URLs carry (connection_limit, pool_timeout, connect_timeout)
 * still work: they become pg's max and connectionTimeoutMillis, and are taken out of the URL.
 * Prisma-only parameters pg would misread are refused rather than silently ignored.
 */
import { PrismaPg } from '@prisma/adapter-pg';
import type pg from 'pg';
import { PrismaClient } from '../generated/prisma/client.js';

export interface PoolOptions {
  /** Connections in the pool (pg's `max`), unless the URL says connection_limit. */
  poolSize?: number;
  /** Seconds to wait for a free connection or a new one to open, unless the URL says pool_timeout. */
  poolTimeoutS?: number;
  /** Shown in pg_stat_activity. */
  applicationName?: string;
}

/** pg.Pool settings for a libpq URL (see above). Exported for tests. */
export function poolConfig(url: string, opts: PoolOptions = {}): pg.PoolConfig {
  const u = new URL(url);
  const p = u.searchParams;
  // In Prisma's spelling sslcert meant the server's CA; pg (like libpq) reads it as a client
  // certificate. A Prisma-translated URL here would quietly change meaning, so refuse it.
  if (p.has('sslaccept')) throw new Error('Database URL uses Prisma’s TLS spelling (sslaccept); give the libpq form: sslmode=verify-full&sslrootcert=<CA file>');
  const num = (k: string) => {
    const v = p.get(k);
    p.delete(k);
    return v === null || v === '' ? undefined : Number(v);
  };
  const limit = num('connection_limit');
  const poolTimeout = num('pool_timeout');
  const connectTimeout = num('connect_timeout');
  const timeoutS = poolTimeout ?? connectTimeout ?? opts.poolTimeoutS;
  return {
    connectionString: u.toString(),
    ...(limit ?? opts.poolSize ? { max: limit ?? opts.poolSize } : {}),
    // pg's default is to wait forever (Prisma 5 gave up after pool_timeout, 10 s by default).
    connectionTimeoutMillis: (timeoutS ?? 10) * 1000,
    // Prisma 5 closed idle connections after 300 s; pg's default is 10 s, which reconnects (and
    // re-does the TLS handshake) far more often under bursty load.
    idleTimeoutMillis: 300_000,
    ...(opts.applicationName ? { application_name: opts.applicationName } : {}),
  };
}

/**
 * A Prisma client on its own pool. Idle-connection errors (a failover, the server closing a
 * connection) are logged, never thrown: an unhandled pg 'error' event would end the process.
 * With logQueries, every query is emitted as a 'query' event (lib/db.ts times them).
 */
export function createPrismaClient(url: string, pool: PoolOptions = {}, opts: { logQueries?: boolean } = {}): PrismaClient {
  const adapter = new PrismaPg(poolConfig(url, pool), {
    onPoolError: (err) => console.warn(`[db] idle connection error: ${err.message}`),
    onConnectionError: (err) => console.warn(`[db] connection error: ${err.message}`),
  });
  return new PrismaClient({ adapter, ...(opts.logQueries ? { log: [{ emit: 'event' as const, level: 'query' as const }] } : {}) }) as PrismaClient;
}
