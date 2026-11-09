import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../../src/lib/db.js';
import { HttpError } from '../../src/lib/errors.js';
import { claimOffer, decideOffer } from '../../src/services/shiftboard/offers.js';
import { app, owner, seedOpenOffer, seedTenant } from './fixtures.js';

let t: Awaited<ReturnType<typeof seedTenant>>;

beforeAll(async () => {
  t = await seedTenant('gamma', 6);
});
afterAll(async () => {
  await app.$disconnect();
  await owner.$disconnect();
});

const actor = (userId: string) => ({ userId, tenantId: t.tenant.id, canPostOpenShifts: false });
const claim = (userId: string, offerId: string, version?: number) =>
  withTenant(t.tenant.id, (tx) => claimOffer(tx, actor(userId), offerId, version), { prisma: app });

describe('claiming under concurrency', () => {
  it('exactly one of many simultaneous claims wins', async () => {
    const { shift, offer } = await seedOpenOffer(t, 3);
    const results = await Promise.allSettled(t.users.map((u) => claim(u.id, offer.id)));

    const wins = results.filter((r) => r.status === 'fulfilled');
    const losses = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(wins).toHaveLength(1);
    expect(losses.every((l) => l.reason instanceof HttpError && l.reason.status === 409)).toBe(true);

    const after = await owner.shift.findUniqueOrThrow({ where: { id: shift.id } });
    expect(after.userId).not.toBeNull();
    expect(after.version).toBe(1);
  });

  it('one person cannot win two overlapping shifts by claiming both at once', async () => {
    const one = await seedOpenOffer(t, 5);
    const two = await seedOpenOffer(t, 5); // same time slot
    const guard = t.users[1]!;
    const results = await Promise.allSettled([claim(guard.id, one.offer.id), claim(guard.id, two.offer.id)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason.details.blocks[0].code).toBe('OVERLAPPING_SHIFT');
  });

  it('rejects a claim made against a stale shift version', async () => {
    const { offer } = await seedOpenOffer(t, 7);
    await expect(claim(t.users[2]!.id, offer.id, 99)).rejects.toMatchObject({ code: 'SHIFT_CHANGED' });
  });

  it('refuses ineligible claimants with reasons', async () => {
    const { offer } = await seedOpenOffer(t, 9);
    const u = t.users[3]!;
    await owner.userCertification.updateMany({ where: { userId: u.id }, data: { expiryDate: new Date(Date.now() + 86_400_000) } });
    await expect(claim(u.id, offer.id)).rejects.toMatchObject({ status: 422, code: 'NOT_ELIGIBLE' });
  });
});

describe('overtime approval', () => {
  it('routes overtime claims to approval and re-checks before assigning', async () => {
    const u = t.users[4]!;
    const { offer, shift } = await seedOpenOffer(t, 12, 10); // a 10h shift → 2h daily OT in BC
    const res = await claim(u.id, offer.id);
    expect(res.outcome).toBe('PENDING_APPROVAL');
    expect(res.outcome === 'PENDING_APPROVAL' && res.overtimeHours).toBe('2.00');
    expect((await owner.shift.findUniqueOrThrow({ where: { id: shift.id } })).userId).toBeNull();

    // A supervisor approves → assigned, audited.
    const sup = await owner.user.create({
      data: { tenantId: t.tenant.id, roles: ['AQUATIC_SUPERVISOR'], employmentStatus: 'FULL_TIME', firstName: 'Sup', lastName: 'V', email: 'sup@gamma.test' },
    });
    await withTenant(t.tenant.id, (tx) => decideOffer(tx, { userId: sup.id, tenantId: t.tenant.id, canPostOpenShifts: true }, offer.id, 'APPROVE'), {
      prisma: app,
    });
    expect((await owner.shift.findUniqueOrThrow({ where: { id: shift.id } })).userId).toBe(u.id);
    expect(await owner.auditLog.count({ where: { entityId: shift.id, action: 'shift.reassign' } })).toBe(1);
  });
});
