import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { resetLimits } from '../../src/auth/rateLimit.js';
import { signAccessToken } from '../../src/auth/tokens.js';
import { addDays, startOfLocalDay } from '../../src/lib/time.js';
import { app as appDb, owner, seedTenant } from './fixtures.js';

const server = createApp();
const SUB = 'forecastp';
let t: Awaited<ReturnType<typeof seedTenant>>;
let sup: string;
const WEEK = '2026-08-17'; // a summer Monday, with four summer Mondays before it

beforeAll(async () => {
  resetLimits();
  t = await seedTenant(SUB, 1);
  await owner.facility.update({ where: { id: t.facility.id }, data: { timezone: 'UTC' } });
  const s = await owner.user.create({ data: { tenantId: t.tenant.id, roles: ['AQUATIC_SUPERVISOR'], employmentStatus: 'FULL_TIME', firstName: 'F', lastName: 'C', email: 'sup@forecastp.test' } });
  sup = await signAccessToken({ sub: s.id, tid: t.tenant.id, roles: ['AQUATIC_SUPERVISOR'] });
  const pool = await owner.poolBody.create({ data: { tenantId: t.tenant.id, facilityId: t.facility.id, name: 'Main', kind: 'POOL', bathersPerLifeguard: 25 } });
  // The last 4 Mondays at 14:00: 60, 70, 80, 90 bathers → expect 75 → 3 guards.
  for (const [i, n] of [60, 70, 80, 90].entries()) {
    const day = addDays(WEEK, -7 * (i + 1));
    await owner.headCount.create({ data: { tenantId: t.tenant.id, poolBodyId: pool.id, count: n, recordedById: s.id, recordedAt: new Date(startOfLocalDay(day, 'UTC').getTime() + 14.25 * 3_600_000) } });
  }
  // One guard scheduled Monday 12:00–18:00.
  await owner.shift.create({ data: { tenantId: t.tenant.id, facilityId: t.facility.id, positionId: t.position.id, userId: t.users[0]!.id, status: 'PUBLISHED', startsAt: new Date(`${WEEK}T12:00:00Z`), endsAt: new Date(`${WEEK}T18:00:00Z`) } });
});
afterAll(async () => {
  await appDb.$disconnect();
  await owner.$disconnect();
});

describe('demand forecast', () => {
  it('expects 75 bathers on Monday at 2 p.m., needs 3 guards, sees 1 scheduled and a gap of 2', async () => {
    const r = await request(server).get(`/api/forecast?facilityId=${t.facility.id}&weekStart=${WEEK}&positionId=${t.position.id}`).auth(sup, { type: 'bearer' }).set('x-tenant-subdomain', SUB);
    expect(r.status).toBe(200);
    const mon = r.body.days[0];
    expect(mon.date).toBe(WEEK);
    expect(mon.hours.find((h: { hour: number }) => h.hour === 14)).toMatchObject({ expected: 75, needed: 3, scheduled: 1, gap: 2, basedOnDays: 4 });
    // Tuesday has no history at 14:00.
    expect(r.body.days[1].hours.find((h: { hour: number }) => h.hour === 14)).toMatchObject({ expected: 0, needed: 0 });
  });
});
