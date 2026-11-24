/**
 * Alerts go by permission and department scope (notifications/notifier.ts usersWithPermission),
 * not by built-in role name: a library lead with a custom role hears about the library's staff and
 * not the pool's, a pool lead in a city with no "aquatic supervisor" hears about the pool, and a
 * switched-off feature takes its alerts with it.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../../src/lib/db.js';
import { certificationReminders } from '../../src/services/jobs/daily.js';
import { organizationAdmins, usersWithPermission } from '../../src/services/notifications/notifier.js';
import { recordHeadcount } from '../../src/services/ops/pools.js';
import { forgetCustomPermissions } from '../../src/services/people/customRoles.js';
import { forgetFeatures } from '../../src/services/platform/features.js';
import { app as appDb, owner, seedTenant } from './fixtures.js';

const SUB = 'alertroute';
let t: Awaited<ReturnType<typeof seedTenant>>;
const ids = { hr: '', sup: '', head: '', libLead: '', poolLead: '', assistant: '', scopedAdmin: '' };
let library = { facility: '', position: '' };

const in30 = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 30));
};
const staffAlerts = async (userId: string, type: string) => (await owner.notification.findMany({ where: { userId, type } })).map((n) => (n.params as { name?: string }).name ?? '').sort();

beforeAll(async () => {
  t = await seedTenant(SUB, 1);
  const tid = t.tenant.id;
  library = {
    facility: (await owner.facility.create({ data: { tenantId: tid, name: 'Central Library', province: 'BC', timezone: 'America/Vancouver', latitude: 49.88, longitude: -119.49 } })).id,
    position: (await owner.position.create({ data: { tenantId: tid, name: 'Library Assistant' } })).id,
  };
  const mk = async (roles: ('HR_ADMIN' | 'AQUATIC_SUPERVISOR' | 'HEAD_LIFEGUARD' | 'EMPLOYEE')[], name: string, position?: string) => {
    const u = await owner.user.create({ data: { tenantId: tid, roles, employmentStatus: 'FULL_TIME', firstName: name, lastName: 'X', email: `${name}@${SUB}.test` } });
    if (position) await owner.userPosition.create({ data: { tenantId: tid, userId: u.id, positionId: position } });
    return u.id;
  };
  const role = async (userId: string, name: string, permissions: string[], scope: { scopePositionIds?: string[]; scopeFacilityIds?: string[] }) => {
    const r = await owner.customRole.create({ data: { tenantId: tid, name, permissions, ...scope } });
    await owner.userCustomRole.create({ data: { tenantId: tid, userId, customRoleId: r.id } });
  };
  ids.hr = await mk(['HR_ADMIN'], 'hr');
  ids.sup = await mk(['AQUATIC_SUPERVISOR'], 'sup');
  ids.head = await mk(['HEAD_LIFEGUARD'], 'head', t.position.id);
  ids.libLead = await mk(['EMPLOYEE'], 'liblead', library.position);
  ids.poolLead = await mk(['EMPLOYEE'], 'poollead', t.position.id);
  ids.assistant = await mk(['EMPLOYEE'], 'assistant', library.position);
  ids.scopedAdmin = await mk(['EMPLOYEE'], 'scopedadmin', library.position);
  // The library's lead: certificates and pools only at the library (position and facility).
  await role(ids.libLead, 'Library lead', ['users.read', 'certs.verify', 'ops.pool.close', 'deck.rotate'], { scopePositionIds: [library.position], scopeFacilityIds: [library.facility] });
  // The pool's lead: certificates of lifeguards, and the pool.
  await role(ids.poolLead, 'Pool lead', ['users.read', 'certs.verify', 'ops.pool.close'], { scopePositionIds: [t.position.id] });
  // Settings for the library only.
  await role(ids.scopedAdmin, 'Library admin', ['tenant.configure'], { scopePositionIds: [library.position] });
  forgetCustomPermissions(tid);
  // A lifeguard's and the library assistant's certificates both expire in 30 days.
  const cpr = await owner.certification.create({ data: { tenantId: tid, name: 'First aid', issuingBody: 'Red Cross', validityMonths: 36 } });
  await owner.userCertification.updateMany({ where: { userId: t.users[0]!.id, certificationId: t.nls.id }, data: { expiryDate: in30() } });
  await owner.userCertification.create({ data: { tenantId: tid, userId: ids.assistant, certificationId: cpr.id, issueDate: new Date('2024-01-01'), expiryDate: in30(), verifiedAt: new Date() } });
});
afterAll(async () => {
  await appDb.$disconnect();
  await owner.$disconnect();
});

describe('alerts follow permission and department scope', () => {
  it('certificates expiring: each lead hears about their own department’s people; HR and an organization-wide supervisor about everyone', async () => {
    await withTenant(t.tenant.id, (tx) => certificationReminders(tx));
    const guard = `Guard0 ${SUB}`;
    const assistant = 'assistant X';
    expect(await staffAlerts(ids.libLead, 'staff_cert_expiring')).toEqual([assistant]);
    expect(await staffAlerts(ids.poolLead, 'staff_cert_expiring')).toEqual([guard]);
    expect(await staffAlerts(ids.sup, 'staff_cert_expiring')).toEqual([guard, assistant].sort());
    expect(await staffAlerts(ids.hr, 'staff_cert_expiring')).toEqual([guard, assistant].sort());
    expect(await staffAlerts(ids.head, 'staff_cert_expiring')).toEqual([]);
  });

  it('over capacity at the pool: the pool’s leads by permission, not the library’s', async () => {
    const pool = await owner.poolBody.create({ data: { tenantId: t.tenant.id, facilityId: t.facility.id, name: 'Main Tank', kind: 'POOL', bathersPerLifeguard: 25, maxCapacity: 10 } });
    await withTenant(t.tenant.id, (tx) => recordHeadcount(tx, t.tenant.id, ids.head, pool.id, 30));
    const told = (await owner.notification.findMany({ where: { tenantId: t.tenant.id, type: 'over_capacity' } })).map((n) => n.userId);
    expect(told).toContain(ids.poolLead);
    expect(told).toContain(ids.sup);
    expect(told).not.toContain(ids.libLead);
    expect(told).not.toContain(ids.head); // who counted
  });

  it('a switched-off feature takes its alerts with it', async () => {
    const tid = t.tenant.id;
    expect((await withTenant(tid, (tx) => usersWithPermission(tx, tid, 'care.manage'))).sort()).toEqual([ids.hr, ids.sup].sort());
    await owner.tenant.update({ where: { id: tid }, data: { features: { care: false } } });
    forgetFeatures(tid);
    expect(await withTenant(tid, (tx) => usersWithPermission(tx, tid, 'care.manage'))).toEqual([]);
    await owner.tenant.update({ where: { id: tid }, data: { features: {} } });
    forgetFeatures(tid);
  });

  it('notices about the organization go to its administrators for the whole organization, not a department’s', async () => {
    const tid = t.tenant.id;
    expect(await withTenant(tid, (tx) => usersWithPermission(tx, tid, 'tenant.configure'))).toContain(ids.scopedAdmin);
    expect(await withTenant(tid, (tx) => organizationAdmins(tx, tid))).toEqual([ids.hr]);
  });
});
