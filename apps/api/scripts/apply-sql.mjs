// Applies raw SQL files (RLS policies, union schema) with the owner connection.
// Usage: node scripts/apply-sql.mjs db/rls.sql db/union_hub.sql
import { readFile } from 'node:fs/promises';
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  for (const file of process.argv.slice(2)) {
    const sql = await readFile(file, 'utf8');
    // sql-safety: trusted — the repository's own migration files, run by an operator, never request input.
    await client.query(sql);
    console.log(`applied ${file}`);
  }
} finally {
  await client.end();
}
