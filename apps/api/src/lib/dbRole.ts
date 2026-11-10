/**
 * Startup check: the runtime connection must be a least-privilege role. A superuser, a role that
 * bypasses row-level security, or one with schema rights would turn any SQL injection into full
 * access, so the server refuses to start with one in production (and warns elsewhere).
 */
import pg from 'pg';

export interface RoleFacts { role: string; superuser: boolean; bypassRls: boolean; canCreate: boolean; ownsTables: boolean }

export async function roleFacts(url: string): Promise<RoleFacts> {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    const r = await c.query<{ role: string; rolsuper: boolean; rolbypassrls: boolean; can_create: boolean; owns_tables: boolean }>(
      `SELECT current_user AS role, r.rolsuper, r.rolbypassrls, has_schema_privilege(current_user, 'public', 'CREATE') AS can_create,
              EXISTS (SELECT 1 FROM pg_tables t WHERE t.schemaname IN ('public', 'union_hub') AND pg_has_role(current_user, t.tableowner, 'USAGE')) AS owns_tables
         FROM pg_roles r WHERE r.rolname = current_user`,
    );
    const x = r.rows[0]!;
    return { role: x.role, superuser: x.rolsuper, bypassRls: x.rolbypassrls, canCreate: x.can_create, ownsTables: x.owns_tables };
  } finally {
    await c.end();
  }
}

export function leastPrivilegeProblems(f: RoleFacts): string[] {
  const out: string[] = [];
  if (f.superuser) out.push(`${f.role} is a superuser`);
  if (f.bypassRls) out.push(`${f.role} bypasses row-level security`);
  if (f.canCreate) out.push(`${f.role} can create objects in the public schema`);
  // A table's owner (or a member of the owner role) isn't held by row-level security unless it's forced.
  if (f.ownsTables) out.push(`${f.role} owns (or acts as the owner of) the application's tables`);
  return out;
}

export async function assertLeastPrivilege(name: string, url: string, production: boolean) {
  const problems = leastPrivilegeProblems(await roleFacts(url));
  if (!problems.length) return;
  const msg = `${name} must use a least-privilege role (flexcity_app / flexcity_union): ${problems.join('; ')}.`;
  if (production) throw new Error(msg);
  console.warn(`[warn] ${msg}`);
}
