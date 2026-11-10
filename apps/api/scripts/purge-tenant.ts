/**
 * npm run tenant:purge -- <subdomain>          (shows what would be deleted)
 * npm run tenant:purge -- <subdomain> --yes    (deletes it; only after the retention date)
 *
 * Uses DATABASE_URL (the database owner). Logged in the platform audit log.
 */
import { PrismaClient } from '@prisma/client';
import { purgePlan, purgeTenant } from '../src/services/platform/purge.js';

const [sub, flag] = process.argv.slice(2);
const owner = new PrismaClient();
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
