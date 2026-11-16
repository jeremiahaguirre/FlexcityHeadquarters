// Applies raw SQL files (RLS policies, union schema) with the owner connection, after the migrations.
// Usage: node scripts/apply-sql.mjs [--force] db/rls.sql db/union_hub.sql
//
// rls.sql alone locks about 166 tables (ALTER TABLE, CREATE POLICY) in one transaction. So that a
// deployment never stalls clock-ins behind a long report (ARCHITECTURE-REVIEW A10), each file:
// - is skipped when neither its text nor the set of applied migrations changed since it was last
//   applied (fh_meta.sql_applied): most deployments take no locks at all;
// - otherwise runs in one transaction with a short lock_timeout, so it gives up a lock it can't get
//   quickly instead of queueing (and making everyone queue behind it) while holding the others,
//   and is retried with a growing pause.
// --force applies every file whatever the record says.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { ownerUrl } from './owner-url.mjs';

const LOCK_NOT_AVAILABLE = '55P03';

/** What a file's last application depended on: its text and every applied migration. */
export async function sqlState(client, text) {
  const { rows } = await client.query(
    `SELECT coalesce(string_agg(migration_name || ':' || checksum, ',' ORDER BY migration_name), '') AS m
       FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`,
  );
  return createHash('sha256').update(text).update('\0').update(rows[0].m).digest('hex');
}

async function ensureLedger(client) {
  // Owned by the owner, outside "public" (Prisma's schema) and with no grant to the runtime roles.
  await client.query(`CREATE SCHEMA IF NOT EXISTS fh_meta`);
  await client.query(`REVOKE ALL ON SCHEMA fh_meta FROM PUBLIC`);
  await client.query(`CREATE TABLE IF NOT EXISTS fh_meta.sql_applied (file text PRIMARY KEY, state text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Applies the files in order. Returns one result per file: 'applied' or 'unchanged', with the
 * number of attempts. Options: force, lockTimeoutMs (2000), retries (10), pauseMs (1000, doubling
 * up to 15 s), log.
 */
export async function applySqlFiles(client, files, opts = {}) {
  const { force = false, lockTimeoutMs = 2000, retries = 10, pauseMs = 1000, log = console.log } = opts;
  await ensureLedger(client);
  const results = [];
  for (const file of files) {
    const sql = await readFile(file, 'utf8');
    const name = basename(file);
    const state = await sqlState(client, sql);
    const prev = await client.query('SELECT state FROM fh_meta.sql_applied WHERE file = $1', [name]);
    if (!force && prev.rows[0]?.state === state) {
      log(`unchanged ${file} (skipped: same file, same migrations)`);
      results.push({ file, status: 'unchanged', attempts: 0 });
      continue;
    }
    for (let attempt = 1; ; attempt++) {
      try {
        await client.query('BEGIN');
        await client.query(`SELECT set_config('lock_timeout', $1, true)`, [`${lockTimeoutMs}ms`]);
        // sql-safety: trusted — the repository's own SQL files, run by an operator, never request input.
        await client.query(sql);
        await client.query(
          `INSERT INTO fh_meta.sql_applied (file, state) VALUES ($1, $2) ON CONFLICT (file) DO UPDATE SET state = excluded.state, applied_at = now()`,
          [name, state],
        );
        await client.query('COMMIT');
        log(`applied ${file}${attempt > 1 ? ` (attempt ${attempt})` : ''}`);
        results.push({ file, status: 'applied', attempts: attempt });
        break;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        if (err?.code !== LOCK_NOT_AVAILABLE || attempt > retries) throw err;
        const wait = Math.min(pauseMs * 2 ** (attempt - 1), 15_000);
        log(`${file}: a table is busy (lock not granted within ${lockTimeoutMs} ms); retrying in ${wait} ms (${attempt}/${retries})`);
        await sleep(wait);
      }
    }
  }
  return results;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const files = args.filter((a) => a !== '--force');
  let url;
  try {
    url = ownerUrl();
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await applySqlFiles(client, files, {
      force,
      lockTimeoutMs: Number(process.env.SQL_LOCK_TIMEOUT_MS ?? 2000),
      retries: Number(process.env.SQL_LOCK_RETRIES ?? 10),
    });
  } finally {
    await client.end();
  }
}
