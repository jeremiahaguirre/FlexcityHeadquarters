/**
 * Deleting an offboarded organization's data once its retention period ends.
 *
 * Removes every row that belongs to the organization (any table with a
 * tenantId / tenant_id column, the union hub included), then the organization
 * itself. FH's own billing records (invoices, payments, the ledger) are kept,
 * as tax law requires; bank account numbers on its debit agreement are wiped.
 *
 * Run by FH operations with the database owner's connection (npm run tenant:purge).
 */
import type { PrismaClient } from '@prisma/client';

/** FH's records about the customer, kept after offboarding (CRA: six years from the end of the tax year). */
const KEEP = new Set(['Invoice', 'InvoiceLine', 'InvoicePayment', 'BillingAccount', 'PadAgreement', 'PadDebit', 'PlatformAudit', 'SupportSession', 'Tenant']);

export async function purgePlan(owner: PrismaClient, tenantId: string) {
  const cols = await owner.$queryRaw<Array<{ schema: string; table: string; col: string }>>`
    SELECT table_schema AS schema, table_name AS table, column_name AS col FROM information_schema.columns
    WHERE column_name IN ('tenantId', 'tenant_id') AND table_schema IN ('public', 'union_hub') AND table_name NOT LIKE '\\_%'`;
  const tables = cols.filter((c) => !(c.schema === 'public' && KEEP.has(c.table)));
  const counts: Array<{ table: string; rows: number }> = [];
  for (const t of tables) {
    const [r] = await owner.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT count(*)::bigint AS n FROM "${t.schema}"."${t.table}" WHERE "${t.col}" = $1::uuid`, tenantId);
    if (Number(r?.n ?? 0)) counts.push({ table: `${t.schema}.${t.table}`, rows: Number(r!.n) });
  }
  return { tables, counts };
}

export async function purgeTenant(owner: PrismaClient, tenantId: string, opts: { force?: boolean } = {}) {
  const t = await owner.tenant.findUnique({ where: { id: tenantId } });
  if (!t) throw new Error('No such organization.');
  if (!t.offboardedAt || !t.deleteAfter) throw new Error('Only offboarded organizations can be purged.');
  if (!opts.force && t.deleteAfter > new Date()) throw new Error(`The retention period runs until ${t.deleteAfter.toISOString().slice(0, 10)}.`);
  const { tables } = await purgePlan(owner, tenantId);
  let deleted = 0;
  await owner.$transaction(
    async (tx) => {
      // Rows reference each other; delete in passes until nothing is left (or nothing more can go).
      let remaining = [...tables];
      for (let pass = 0; pass < 25 && remaining.length; pass++) {
        const next: typeof remaining = [];
        for (const t of remaining) {
          try {
            await tx.$executeRawUnsafe('SAVEPOINT purge_step');
            deleted += await tx.$executeRawUnsafe(`DELETE FROM "${t.schema}"."${t.table}" WHERE "${t.col}" = $1::uuid`, tenantId);
            await tx.$executeRawUnsafe('RELEASE SAVEPOINT purge_step');
          } catch {
            await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT purge_step');
            next.push(t);
          }
        }
        if (next.length === remaining.length) throw new Error(`Couldn't delete: ${next.map((x) => x.table).join(', ')}`);
        remaining = next;
      }
      await tx.padAgreement.updateMany({ where: { tenantId }, data: { accountSealed: {}, institution: '000', transit: '00000' } });
      await tx.tenant.update({ where: { id: tenantId }, data: { name: `Deleted organization (${t.subdomain})`, logoUrl: null, themeColors: {}, features: {}, roleOverrides: {} } });
    },
    { timeout: 300_000 },
  );
  return { deleted };
}
