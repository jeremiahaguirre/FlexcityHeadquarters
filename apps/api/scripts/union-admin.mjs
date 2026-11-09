// Platform-operator tool: create a union local and its first steward.
// The employer's admins cannot do this through the app, by design.
//
//   node --env-file=.env scripts/union-admin.mjs create-local <subdomain> "<Local name>" <kms-key-id>
//   node --env-file=.env scripts/union-admin.mjs add-steward <local-id> <staff email>
import pg from 'pg';

const [cmd, ...args] = process.argv.slice(2);
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
try {
  if (cmd === 'create-local') {
    const [subdomain, name, kekId] = args;
    if (!subdomain || !name || !kekId) throw new Error('usage: create-local <subdomain> "<name>" <kms-key-id>');
    const t = await c.query('SELECT id FROM "Tenant" WHERE subdomain = $1', [subdomain]);
    if (!t.rowCount) throw new Error(`No organization with subdomain ${subdomain}`);
    const r = await c.query('INSERT INTO union_hub.local (tenant_id, name, kek_id) VALUES ($1, $2, $3) RETURNING id', [t.rows[0].id, name, kekId]);
    console.log(`Created local ${name}: ${r.rows[0].id}`);
  } else if (cmd === 'add-steward') {
    const [localId, email] = args;
    const l = await c.query('SELECT tenant_id FROM union_hub.local WHERE id = $1', [localId]);
    if (!l.rowCount) throw new Error('Unknown local');
    const u = await c.query('SELECT id FROM "User" WHERE "tenantId" = $1 AND email = $2', [l.rows[0].tenant_id, String(email).toLowerCase()]);
    if (!u.rowCount) throw new Error('No staff member with that email in this organization');
    await c.query(
      'INSERT INTO union_hub.member_access (local_id, user_id, is_steward) VALUES ($1, $2, true) ON CONFLICT (local_id, user_id) DO UPDATE SET is_steward = true',
      [localId, u.rows[0].id],
    );
    console.log(`${email} is now a steward of ${localId}`);
  } else {
    throw new Error('commands: create-local, add-steward');
  }
} finally {
  await c.end();
}
