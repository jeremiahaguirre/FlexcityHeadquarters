// Applies raw SQL files (RLS policies, union schema) with the owner connection, after the migrations.
// Usage: node scripts/apply-sql.mjs [--force] db/rls.sql db/union_hub.sql
//
// rls.sql alone locks about 166 tables (ALTER TABLE, CREATE POLICY) in one transaction. So that a
// deployment never stalls clock-ins behind a long report (ARCHITECTURE-REVIEW A10), each file:
// - is skipped when its text, the set of applied migrations and the "public" schema itself are
//   unchanged since it was last applied, AND the database's policies and row-level security flags
//   are exactly as they were left (fh_meta.sql_applied): most deployments take no locks at all,
//   while a rebuilt schema, or a policy dropped by hand, gets everything applied again;
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

const CATALOG = '(catalog)';

/**
 * What a file's last application depended on: its text, every applied migration, and the identity
 * of the "public" schema (a schema dropped and recreated, as `prisma migrate reset` does, has a
 * new oid even when the same migrations are replayed).
 */
export async function sqlState(client, text) {
  const { rows } = await client.query(
    `SELECT coalesce((SELECT string_agg(migration_name || ':' || checksum, ',' ORDER BY migration_name)
                        FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL), '') AS m,
            'public'::regnamespace::oid::text AS ns`,
  );
  return createHash('sha256').update(text).update('\0').update(rows[0].m).update('\0').update(rows[0].ns).digest('hex');
}

/** Every policy and row-level security flag outside the system schemas, as one hash. */
export async function catalogState(client) {
  const { rows } = await client.query(
    `SELECT coalesce(string_agg(x, E'\\n' ORDER BY x), '') AS c FROM (
       SELECT format('policy %s.%s.%s %s %s %s %s', schemaname, tablename, policyname, cmd, roles, qual, with_check) AS x
         FROM pg_policies
       UNION ALL
       SELECT format('table %s.%s %s %s', n.nspname, c.relname, c.relrowsecurity, c.relforcerowsecurity)
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind = 'r' AND n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg_toast%'
     ) t`,
  );
  return createHash('sha256').update(rows[0].c).digest('hex');
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
  const recorded = async (name) => (await client.query('SELECT state FROM fh_meta.sql_applied WHERE file = $1', [name])).rows[0]?.state;
  const record = (name, state) =>
    client.query(`INSERT INTO fh_meta.sql_applied (file, state) VALUES ($1, $2) ON CONFLICT (file) DO UPDATE SET state = excluded.state, applied_at = now()`, [name, state]);
  // The policies are not what these files left behind (a rebuilt schema, a policy dropped by
  // hand, a first run): apply every file, whatever their own records say.
  const catalogChanged = (await recorded(CATALOG)) !== (await catalogState(client));
  if (catalogChanged && !force) log('policies or row-level security differ from what was last applied: applying every file');
  const results = [];
  for (const file of files) {
    const sql = await readFile(file, 'utf8');
    const name = basename(file);
    const state = await sqlState(client, sql);
    if (!force && !catalogChanged && (await recorded(name)) === state) {
      log(`unchanged ${file} (skipped: same file, same migrations, same policies)`);
      results.push({ file, status: 'unchanged', attempts: 0 });
      continue;
    }
    for (let attempt = 1; ; attempt++) {
      try {
        await client.query('BEGIN');
        await client.query(`SELECT set_config('lock_timeout', $1, true)`, [`${lockTimeoutMs}ms`]);
        // sql-safety: trusted — the repository's own SQL files, run by an operator, never request input.
        await client.query(sql);
        await record(name, state);
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
  await record(CATALOG, await catalogState(client));
  return results;
}

/** A positive whole number from the environment, or the default; anything else is an error. */
export function positiveInt(env, name, fallback) {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  if (!/^[1-9][0-9]*$/.test(raw)) throw new Error(`${name} must be a positive whole number (got "${raw}")`);
  return Number(raw);
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
  let lockTimeoutMs, retries;
  try {
    // 0 would switch lock_timeout off, and NaN would retry forever.
    lockTimeoutMs = positiveInt(process.env, 'SQL_LOCK_TIMEOUT_MS', 2000);
    retries = positiveInt(process.env, 'SQL_LOCK_RETRIES', 10);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await applySqlFiles(client, files, { force, lockTimeoutMs, retries });
  } finally {
    await client.end();
  }
}
