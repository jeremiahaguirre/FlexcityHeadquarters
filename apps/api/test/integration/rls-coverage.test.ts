import { randomBytes } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { db, platformDb, withTenant, type Tx } from '../../src/lib/db.js';
import { owner, seedTenant } from './fixtures.js';

afterAll(async () => {
  await owner.$disconnect();
  await db().$disconnect();
});

describe('row-level security coverage', () => {
  it('every table holding a city’s data has row-level security on and forced', async () => {
    // Every table with a tenantId column, as the database has them (Prisma 7's client no longer ships its data model).
    const tenantTables = (
      await owner.$queryRaw<Array<{ table_name: string }>>`SELECT table_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'tenantId'`
    ).map((r) => r.table_name);
    expect(tenantTables.length).toBeGreaterThan(100);
    // Platform-level tables that hold a tenantId for the Dev console only (never read under a city session).
    // WebAuthnChallenge is used before anyone is signed in (no city session yet); it holds
    // only single-use random challenges that expire within minutes.
    const platformOnly = new Set(['PlatformAudit', 'BillingAccount', 'Invoice', 'InvoiceLine', 'InvoicePayment', 'InvoiceCounter', 'PadAgreement', 'PadDebit', 'SupportSession', 'Tenant', 'WebAuthnChallenge']);
    const rows = await owner.$queryRaw<Array<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>>`
      SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relkind = 'r' AND relnamespace = 'public'::regnamespace`;
    const missing = tenantTables.filter((t) => !platformOnly.has(t)).filter((t) => {
      const r = rows.find((x) => x.relname === t);
      return !r || !r.relrowsecurity || !r.relforcerowsecurity;
    });
    expect(missing).toEqual([]);
  });

  it('the owner, who runs the SECURITY DEFINER functions, sees every row even when it is not a superuser (RDS)', async () => {
    // Without owner_all, FORCE ROW LEVEL SECURITY would hide every row from fh_owner on RDS: the
    // organization lookup at sign-in and the worker's list of organizations would return nothing.
    const rows = await owner.$queryRaw<Array<{ relname: string }>>`
      SELECT c.relname FROM pg_class c
       WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND c.relrowsecurity
         AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid AND p.polname = 'owner_all' AND c.relowner = ANY (p.polroles))`;
    expect(rows.map((r) => r.relname)).toEqual([]);
    const definers = await owner.$queryRaw<Array<{ proname: string }>>`
      SELECT p.proname FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.prosecdef
         AND p.proowner <> (SELECT relowner FROM pg_class WHERE oid = '"Tenant"'::regclass)`;
    expect(definers.map((d) => d.proname)).toEqual([]);
  });

  it('every table is classified: a city’s, FH-only, FH’s published notices or global read-only (SEC-35)', async () => {
    // The policy names db/rls.sql gives each class. owner_all is the owner's, not a class.
    const classOf: Record<string, string> = {
      tenant_isolation: 'city', city_or_fh: 'city', tenant_self: 'city', cert_read: 'city', cert_write: 'city', cert_update: 'city',
      fh_only: 'fh-only', fh_published_read: 'fh-published', fh_published_insert: 'fh-published', fh_published_update: 'fh-published',
      global_read: 'global-read-only', fh_write: 'global-read-only',
    };
    const tables = await owner.$queryRaw<Array<{ relname: string; relrowsecurity: boolean; policies: string[] }>>`
      SELECT c.relname, c.relrowsecurity,
             coalesce(array_agg(p.polname::text) FILTER (WHERE p.polname IS NOT NULL AND p.polname <> 'owner_all'), '{}') AS policies
        FROM pg_class c LEFT JOIN pg_policy p ON p.polrelid = c.oid
       WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND c.relname <> '_prisma_migrations'
       GROUP BY c.relname, c.relrowsecurity`;
    expect(tables.length).toBeGreaterThan(180);
    const unclassified = tables.filter((t) => !t.relrowsecurity || !t.policies.some((p) => classOf[p])).map((t) => t.relname);
    expect(unclassified).toEqual([]);
    const unknown = tables.flatMap((t) => t.policies.filter((p) => !classOf[p]).map((p) => `${t.relname}.${p}`));
    expect(unknown).toEqual([]);
    const cls = (name: string) => new Set(tables.find((t) => t.relname === name)!.policies.map((p) => classOf[p]));
    for (const t of ['PlatformAdmin', 'PlatformSession', 'PlatformPasskey', 'FhBooks', 'FhJournalEntry', 'InvoiceCounter', 'Lead', 'PadBatch', 'RateLimitHit']) expect([...cls(t)], t).toEqual(['fh-only']);
    // The fallback for an unlisted table with a tenantId has a name of its own, which isn't a class.
    expect(classOf.tenant_isolation_unclassified).toBeUndefined();
    for (const t of ['StatutoryHoliday', 'CertificationPrerequisite', 'PayrollTaxTable', 'WeatherSite', 'WeatherForecastDay', 'WeatherObservation', 'BenchmarkSnapshot']) expect([...cls(t)], t).toEqual(['global-read-only']);
  });

  it('the app role has no access to FH’s platform tables, in a city or not; only the platform role has (review of #61)', async () => {
    const { tenant } = await seedTenant(`rls-${randomBytes(4).toString('hex')}`, 0);
    const email = `rls-${tenant.id}@example.ca`;
    await owner.platformAdmin.create({ data: { email, name: 'Console admin', passwordHash: 'x' } });
    const denied = /permission denied|42501/;
    // No city chosen, and a city's transaction that clears its own setting: both refused.
    await expect(db().platformAdmin.findMany({ select: { passwordHash: true } })).rejects.toThrow(denied);
    await expect(db().lead.count()).rejects.toThrow(denied);
    await expect(db().fhBooks.count()).rejects.toThrow(denied);
    await expect(
      withTenant(tenant.id, async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', '', true)`;
        return tx.platformAdmin.findMany({ select: { passwordHash: true } });
      }),
    ).rejects.toThrow(denied);
    // Reference data: the app role reads it, in a city or not, and never writes it.
    const year = 2099;
    await owner.payrollTaxTable.upsert({ where: { year_jurisdiction: { year, jurisdiction: 'CA' } }, create: { year, jurisdiction: 'CA', data: {} }, update: {} });
    expect(await withTenant(tenant.id, (tx) => tx.payrollTaxTable.count({ where: { year } }))).toBe(1);
    expect(await db().payrollTaxTable.count({ where: { year } })).toBe(1);
    await expect(db().payrollTaxTable.updateMany({ where: { year }, data: { note: 'from the app role' } })).rejects.toThrow(denied);
    await expect(
      withTenant(tenant.id, async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', '', true)`;
        return tx.payrollTaxTable.updateMany({ where: { year }, data: { data: { tampered_from_city: 1 } } });
      }),
    ).rejects.toThrow(denied);
    // The shared rate limiter stays the app's, with no city chosen only.
    expect(await withTenant(tenant.id, (tx) => tx.rateLimitHit.count())).toBe(0);
    await expect(withTenant(tenant.id, (tx) => tx.rateLimitHit.create({ data: { key: `rls:${tenant.id}` } }))).rejects.toThrow(/row-level security|42501/);
    // FH's side, as the platform role: the platform tables, writes to reference data, and a city's
    // rows only through that city's own context, like the app (it is a member of the app role).
    expect(await platformDb().platformAdmin.count({ where: { email } })).toBe(1);
    expect((await platformDb().payrollTaxTable.updateMany({ where: { year }, data: { note: 'FH' } })).count).toBe(1);
    expect(await platformDb().user.count({ where: { tenantId: tenant.id } })).toBe(0);
    await owner.payrollTaxTable.deleteMany({ where: { year } });
    await owner.platformAdmin.deleteMany({ where: { email } });
  });

  it('a new table with a tenantId that no list classifies fails this test, though it is isolated (review of #61)', async () => {
    const name = `NewCityThing${randomBytes(3).toString('hex')}`;
    await owner.$executeRawUnsafe(`CREATE TABLE "${name}" (id int, "tenantId" uuid)`);
    try {
      // The catalogue block of rls.sql, as a deployment runs it.
      const sql = (await import('node:fs')).readFileSync(new URL('../../db/rls.sql', import.meta.url), 'utf8');
      const block = sql.slice(sql.indexOf('-- Generated from the catalogue'), sql.indexOf('-- The owner (the role that runs migrations'));
      await owner.$executeRawUnsafe(block);
      const pol = await owner.$queryRawUnsafe<Array<{ polname: string }>>(`SELECT polname FROM pg_policy WHERE polrelid = '"${name}"'::regclass`);
      expect(pol.map((x) => x.polname)).toEqual(['tenant_isolation_unclassified']);
    } finally {
      await owner.$executeRawUnsafe(`DROP TABLE "${name}"`);
    }
  });

  it('audit trails cannot be edited or deleted by the app', async () => {
    const grants = await owner.$queryRaw<Array<{ table_name: string; privilege_type: string }>>`
      SELECT table_name, privilege_type FROM information_schema.role_table_grants WHERE grantee = 'flexcity_app' AND table_name IN ('AuditLog', 'IncidentAccessLog', 'TimePunchEdit')`;
    expect(grants.filter((g) => g.privilege_type === 'UPDATE' || g.privilege_type === 'DELETE')).toEqual([]);
  });
});
