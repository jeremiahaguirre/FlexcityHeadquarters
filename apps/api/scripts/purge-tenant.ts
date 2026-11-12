/**
 * npm run tenant:purge -- <subdomain>          (shows what would be deleted)
 * npm run tenant:purge -- <subdomain> --yes    (deletes it; only after the retention date)
 *
 * Uses the database owner (DATABASE_URL, or the migration task's DB_* settings). Logged in the platform audit log.
 */
import { PrismaClient } from '@prisma/client';
import { prismaUrl } from '../src/lib/dbUrl.js';
import { purgePlan, purgeTenant } from '../src/services/platform/purge.js';
// @ts-expect-error a plain JavaScript module without types, shared with the migration scripts
import { ownerUrl } from './owner-url.mjs';

const [sub, flag] = process.argv.slice(2);
// Owner connection: DATABASE_URL, or on AWS the DB_* parts and the RDS-managed password the
// migration task gets (scripts/owner-url.mjs), its TLS settings translated for Prisma (src/lib/dbUrl.ts).
let url: string;
try {
  url = ownerUrl();
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
const owner = new PrismaClient({ datasources: { db: { url: prismaUrl(url) } } });
(async () => {
  if (!sub) throw new Error('Give the organization’s address (subdomain).');
  const t = await owner.tenant.findUnique({ where: { subdomain: sub } });
  if (!t) throw new Error(`No organization at “${sub}”.`);
  console.log(`${t.name} (${sub}) · offboarded ${t.offboardedAt?.toISOString().slice(0, 10) ?? 'no'} · delete after ${t.deleteAfter?.toISOString().slice(0, 10) ?? '—'}`);
  const plan = await purgePlan(owner, t.id);
  for (const c of plan.counts) console.log(`  ${c.table}: ${c.rows}`);
  if (flag !== '--yes') return console.log('Dry run. Add --yes to delete.');
  const r = await purgeTenant(owner, t.id);
  await owner.platformAudit.create({ data: { adminId: '00000000-0000-0000-0000-000000000000', tenantId: t.id, action: 'tenant.purge', detail: { rows: r.deleted } } });
  console.log(`Deleted ${r.deleted} rows. Invoices and the ledger are kept.`);
  // Crypto-shredding: with the organization's own key gone, sealed values in any backup are unreadable.
  console.log(`Next: schedule its encryption key for deletion:\n  aws kms schedule-key-deletion --key-id "$(aws kms describe-key --key-id alias/flexcity-tenant-${t.id} --query KeyMetadata.KeyId --output text)" --pending-window-in-days 30`);
})()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => owner.$disconnect());
