// Creates the app's database roles (db/roles.sql) and sets their real passwords, for a new
// environment. Run with the owner connection, e.g. as the one-off "db-roles" task on AWS
// (ops/terraform/README.md). Passwords come from the environment, never the command line or logs.
//
//   DATABASE_URL=… FLEXCITY_APP_PASSWORD=… [FLEXCITY_UNION_PASSWORD=…] node scripts/set-role-passwords.mjs
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { ownerUrl } from './owner-url.mjs';

let url;
try {
  url = ownerUrl();
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
const passwords = { flexcity_app: process.env.FLEXCITY_APP_PASSWORD, flexcity_union: process.env.FLEXCITY_UNION_PASSWORD };
if (!passwords.flexcity_app || passwords.flexcity_app.length < 24) {
  console.error('FLEXCITY_APP_PASSWORD is required (24 characters or more)');
  process.exit(1);
}
if (passwords.flexcity_union !== undefined && passwords.flexcity_union.length < 24) {
  console.error('FLEXCITY_UNION_PASSWORD must be 24 characters or more');
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  // sql-safety: trusted — the repository's own bootstrap file.
  await client.query(await readFile(new URL('../db/roles.sql', import.meta.url), 'utf8'));
  for (const [role, password] of Object.entries(passwords)) {
    if (!password) continue;
    // Postgres quotes the role and the password itself (%I, %L); nothing is spliced in here.
    const { rows } = await client.query('SELECT format($$ALTER ROLE %I PASSWORD %L$$, $1::text, $2::text) AS stmt', [role, password]);
    await client.query(rows[0].stmt);
    console.log(`password set for ${role}`);
  }
} finally {
  await client.end();
}
