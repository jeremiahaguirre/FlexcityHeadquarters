import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import pg from 'pg';

/**
 * Resets the test database: roles → migrations → RLS + union schema.
 * Requires DATABASE_URL (owner/superuser) and APP_DATABASE_URL (flexcity_app).
 */
export default async function setup() {
  const url = process.env.DATABASE_URL;
  if (!url || !process.env.APP_DATABASE_URL) throw new Error('DATABASE_URL and APP_DATABASE_URL are required for integration tests');

  // Create the test database if needed (CI starts with an empty server).
  const dbName = new URL(url).pathname.slice(1);
  const maintenance = new URL(url);
  maintenance.pathname = '/postgres';
  const bootstrap = new pg.Client({ connectionString: maintenance.toString() });
  await bootstrap.connect();
  const exists = await bootstrap.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
  if (exists.rowCount === 0) await bootstrap.query(`CREATE DATABASE "${dbName.replace(/"/g, '""')}"`);
  await bootstrap.end();

  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  await admin.query(readFileSync('db/roles.sql', 'utf8'));
  await admin.query('DROP SCHEMA IF EXISTS union_hub CASCADE');
  await admin.end();

  execSync('npx prisma migrate reset --force --skip-seed --skip-generate', { stdio: 'pipe', env: process.env });

  const c = new pg.Client({ connectionString: url });
  await c.connect();
  for (const f of ['db/rls.sql', 'db/union_hub.sql']) await c.query(readFileSync(f, 'utf8'));
  await c.end();
}
