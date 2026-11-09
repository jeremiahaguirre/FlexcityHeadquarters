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
    const platformOnly = new Set(['PlatformAudit', 'BillingAccount', 'Invoice', 'InvoiceLine', 'InvoicePayment', 'InvoiceCounter', 'Tenant', 'WebAuthnChallenge']);
    const rows = await owner.$queryRaw<Array<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>>`
      SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relkind = 'r' AND relnamespace = 'public'::regnamespace`;
    const missing = tenantTables.filter((t) => !platformOnly.has(t)).filter((t) => {
      const r = rows.find((x) => x.relname === t);
      return !r || !r.relrowsecurity || !r.relforcerowsecurity;
    });
    expect(missing).toEqual([]);
  });

  it('audit trails cannot be edited or deleted by the app', async () => {
    const grants = await owner.$queryRaw<Array<{ table_name: string; privilege_type: string }>>`
      SELECT table_name, privilege_type FROM information_schema.role_table_grants WHERE grantee = 'flexcity_app' AND table_name IN ('AuditLog', 'IncidentAccessLog', 'TimePunchEdit')`;
    expect(grants.filter((g) => g.privilege_type === 'UPDATE' || g.privilege_type === 'DELETE')).toEqual([]);
  });
});
