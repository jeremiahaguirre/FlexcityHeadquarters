/**
 * Writing an organization's JSON settings (the Tenant row's settings columns) safely
 * (ARCHITECTURE-REVIEW A11).
 *
 * Two ways settings used to be lost:
 * - Read, change, write the whole column, with no lock: two requests at once (a schedule fill and a
 *   settings change) each wrote back what they read, so the later one silently undid the other.
 * - Parse into the known shape, write the parsed object back: keys this version doesn't know
 *   (added by a newer release still rolling out, or kept for a rollback) were reset.
 *
 * updateTenantJson locks the organization's row (SELECT … FOR UPDATE) for the rest of the
 * transaction, reads the column as stored, and writes back what `change` returns from it, so a
 * concurrent writer waits and then starts from this write. Changes should spread what they are
 * given (`{ ...current, key: value }`) so unknown keys survive.
 */
import type { Prisma } from '../generated/prisma/client.js';
import type { Tx } from './db.js';
import { ident } from './sqlIdent.js';

/** The Tenant row's JSON settings columns. */
export const TENANT_JSON_COLUMNS = [
  'overtimePolicy', 'payrollSettings', 'accountingSettings', 'retentionSettings', 'features', 'roleOverrides', 'careSettings',
  'winterSettings', 'signupSettings', 'workRules', 'messagingSettings', 'surveySettings', 'themeColors',
] as const;
export type TenantJsonColumn = (typeof TENANT_JSON_COLUMNS)[number];

export type JsonObject = Record<string, unknown>;
const asObject = (v: unknown): JsonObject => (v && typeof v === 'object' && !Array.isArray(v) ? (v as JsonObject) : {});

/** Locks the organization's row until the transaction ends: settings read after this are current. */
export async function lockTenant(tx: Tx, tenantId: string): Promise<void> {
  await tx.$queryRaw`SELECT 1 FROM "Tenant" WHERE id = ${tenantId}::uuid FOR UPDATE`;
}

/** Locks the row, reads one settings column as stored, writes back `change(current)`. Returns what was written. */
export async function updateTenantJson(tx: Tx, tenantId: string, column: TenantJsonColumn, change: (current: JsonObject) => JsonObject): Promise<JsonObject> {
  if (!(TENANT_JSON_COLUMNS as readonly string[]).includes(column)) throw new Error(`Not a Tenant settings column: ${column}`);
  const rows = await tx.$queryRawUnsafe<Array<{ v: unknown }>>(`SELECT ${ident(column)} AS v FROM "Tenant" WHERE id = $1::uuid FOR UPDATE`, tenantId);
  if (!rows.length) throw new Error('Organization not found');
  const next = change(structuredClone(asObject(rows[0]!.v)));
  await tx.tenant.update({ where: { id: tenantId }, data: { [column]: next as Prisma.InputJsonValue } });
  return next;
}
