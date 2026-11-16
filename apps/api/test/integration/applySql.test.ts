import { randomBytes } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applySqlFiles } from '../../scripts/apply-sql.mjs';

// The deploy-time SQL step (scripts/apply-sql.mjs; ARCHITECTURE-REVIEW A10), as the owner.
const url = process.env.DATABASE_URL!;
const dir = mkdtempSync(join(tmpdir(), 'fh-apply-sql-'));
const probe = `fh_lock_probe_${randomBytes(3).toString('hex')}`;
const quiet = { log: () => undefined };
let client: pg.Client;

function sqlFile(sql: string) {
  const f = join(dir, `t_${randomBytes(4).toString('hex')}.sql`);
  writeFileSync(f, sql);
  return f;
}

beforeAll(async () => {
  client = new pg.Client({ connectionString: url });
  await client.connect();
  await client.query(`CREATE TABLE ${probe} (id int)`);
});

afterAll(async () => {
  await client.query(`DROP TABLE IF EXISTS ${probe}`);
  await client.end();
});

describe('applying rls.sql and union_hub.sql at deploy time', () => {
  it('skips a file whose text and migrations are unchanged; --force or a change applies it again', async () => {
    const f = sqlFile(`COMMENT ON TABLE ${probe} IS 'one'`);
    expect((await applySqlFiles(client, [f], quiet))[0]).toMatchObject({ status: 'applied', attempts: 1 });
    expect((await applySqlFiles(client, [f], quiet))[0]).toMatchObject({ status: 'unchanged', attempts: 0 });
    expect((await applySqlFiles(client, [f], { ...quiet, force: true }))[0]).toMatchObject({ status: 'applied' });
    writeFileSync(f, `COMMENT ON TABLE ${probe} IS 'two'`);
    expect((await applySqlFiles(client, [f], quiet))[0]).toMatchObject({ status: 'applied' });
    const c = await client.query(`SELECT obj_description('${probe}'::regclass) AS d`);
    expect(c.rows[0].d).toBe('two');
  });

  it('applies again after a new migration, even if the file is the same (new tables need its grants and policies)', async () => {
    const f = sqlFile(`COMMENT ON TABLE ${probe} IS 'three'`);
    await applySqlFiles(client, [f], quiet);
    const name = `29991231000000_probe_${randomBytes(3).toString('hex')}`;
    await client.query(`INSERT INTO "_prisma_migrations" (id, checksum, migration_name, finished_at, applied_steps_count) VALUES ($1, 'x', $2, now(), 1)`, [randomBytes(16).toString('hex'), name]);
    try {
      expect((await applySqlFiles(client, [f], quiet))[0]).toMatchObject({ status: 'applied' });
    } finally {
      await client.query(`DELETE FROM "_prisma_migrations" WHERE migration_name = $1`, [name]);
    }
  });

  it('gives up a lock it cannot get quickly and retries, instead of queueing while holding other tables', async () => {
    const holder = new pg.Client({ connectionString: url });
    await holder.connect();
    try {
      await holder.query('BEGIN');
      await holder.query(`LOCK TABLE ${probe} IN ACCESS EXCLUSIVE MODE`);
      // A long report holding the table: released after about a second.
      const release = new Promise<void>((resolve) => setTimeout(() => void holder.query('COMMIT').then(() => resolve()), 1000));
      const logs: string[] = [];
      const f = sqlFile(`ALTER TABLE ${probe} ENABLE ROW LEVEL SECURITY`);
      const started = Date.now();
      const [r] = await applySqlFiles(client, [f], { lockTimeoutMs: 150, retries: 20, pauseMs: 100, log: (m: string) => logs.push(m) });
      await release;
      expect(r).toMatchObject({ status: 'applied' });
      expect(r!.attempts).toBeGreaterThan(1);
      expect(logs.some((l) => /a table is busy/.test(l))).toBe(true);
      expect(Date.now() - started).toBeLessThan(10_000);
    } finally {
      await holder.end();
    }
  });

  it('fails with lock_not_available once the retries run out, and leaves nothing half-applied', async () => {
    const holder = new pg.Client({ connectionString: url });
    await holder.connect();
    try {
      await holder.query('BEGIN');
      await holder.query(`LOCK TABLE ${probe} IN ACCESS EXCLUSIVE MODE`);
      const f = sqlFile(`CREATE TABLE ${probe}_side (id int); ALTER TABLE ${probe} DISABLE ROW LEVEL SECURITY`);
      await expect(applySqlFiles(client, [f], { lockTimeoutMs: 100, retries: 1, pauseMs: 10, log: () => undefined })).rejects.toMatchObject({ code: '55P03' });
      await holder.query('COMMIT');
      const side = await client.query(`SELECT to_regclass('${probe}_side') AS t`);
      expect(side.rows[0].t).toBeNull();
    } finally {
      await holder.end();
    }
  });

  it('applies the real rls.sql inside its lock timeout, then skips it on the next deployment', async () => {
    const files = ['db/rls.sql'];
    const first = await applySqlFiles(client, files, { ...quiet, force: true });
    expect(first[0]).toMatchObject({ status: 'applied' });
    expect((await applySqlFiles(client, files, quiet))[0]).toMatchObject({ status: 'unchanged' });
    // The record is the owner's: the app role can neither read nor change it.
    const app = new pg.Client({ connectionString: process.env.APP_DATABASE_URL! });
    await app.connect();
    try {
      await expect(app.query('SELECT * FROM fh_meta.sql_applied')).rejects.toMatchObject({ code: '42501' });
    } finally {
      await app.end();
    }
  });
});
