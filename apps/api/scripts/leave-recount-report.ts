/**
 * npm run leave:recount-report                  (every organization)
 * npm run leave:recount-report -- <subdomain>   (one organization)
 *
 * Read-only report for payroll. Lists approved time off whose hours were counted by weekdays
 * (no shifts in it) and would count differently now. Before the fix, those hours were counted
 * in UTC, so a Friday leave in Vancouver could be charged as a Saturday. Each request is recounted
 * in the person's time zone as of when it was decided (services/people/leaveHours.ts weekdayRecount).
 *
 * It changes nothing: the stored hours may already be in closed pay runs. Payroll decides what to correct.
 * Output is CSV on stdout. It identifies people by id only.
 *
 * Connections: the owner (DATABASE_URL, or the migration task's DB_* settings) only lists the
 * organizations. Each organization is read as the app role (APP_DATABASE_URL), in a read-only
 * transaction, so row-level security keeps it to that organization's rows.
 */
import { createPrismaClient } from '../src/lib/prismaClient.js';
import { withTenant } from '../src/lib/db.js';
import { weekdayRecount } from '../src/services/people/leaveHours.js';
// @ts-expect-error a plain JavaScript module without types, shared with the migration scripts
import { ownerUrl } from './owner-url.mjs';

const [sub] = process.argv.slice(2);
let url: string;
try {
  url = ownerUrl();
  if (!process.env.APP_DATABASE_URL) throw new Error('APP_DATABASE_URL is required');
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
const owner = createPrismaClient(url);
const app = createPrismaClient(process.env.APP_DATABASE_URL!);
(async () => {
  const tenants = await owner.tenant.findMany({ where: sub ? { subdomain: sub } : {}, select: { id: true, subdomain: true }, orderBy: { subdomain: 'asc' } });
  if (sub && !tenants.length) throw new Error(`No organization at “${sub}”.`);
  console.log('organization,request_id,person_id,type,starts_at,ends_at,time_zone,charged_hours,recount_hours');
  let n = 0;
  for (const t of tenants) {
    const rows = await withTenant(t.id, (tx) => weekdayRecount(tx), { prisma: app, readOnly: true, timeoutMs: 120_000 });
    for (const r of rows) console.log([t.subdomain, r.id, r.userId, r.type, r.startsAt.toISOString(), r.endsAt.toISOString(), r.timeZone, r.charged, r.recount].join(','));
    n += rows.length;
  }
  console.error(`${n} request(s) to review across ${tenants.length} organization(s). Nothing was changed.`);
})()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => Promise.all([owner.$disconnect(), app.$disconnect()]));
