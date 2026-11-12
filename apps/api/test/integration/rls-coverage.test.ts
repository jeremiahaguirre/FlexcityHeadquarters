import { Prisma } from '@prisma/client';
import { afterAll, describe, expect, it } from 'vitest';
import { owner } from './fixtures.js';

afterAll(async () => {
  await owner.$disconnect();
});

describe('row-level security coverage', () => {
  it('every table holding a city’s data has row-level security on and forced', async () => {
    const tenantTables = Prisma.dmmf.datamodel.models.filter((m) => m.fields.some((f) => f.name === 'tenantId')).map((m) => m.dbName ?? m.name);
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

  it('audit trails cannot be edited or deleted by the app', async () => {
    const grants = await owner.$queryRaw<Array<{ table_name: string; privilege_type: string }>>`
      SELECT table_name, privilege_type FROM information_schema.role_table_grants WHERE grantee = 'flexcity_app' AND table_name IN ('AuditLog', 'IncidentAccessLog', 'TimePunchEdit')`;
    expect(grants.filter((g) => g.privilege_type === 'UPDATE' || g.privilege_type === 'DELETE')).toEqual([]);
  });
});
