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

  it('uses opening hours: a minimum on deck while open, nobody while closed', async () => {
    const as = (method: 'get' | 'put' | 'post', path: string) => request(server)[method](path).auth(sup, { type: 'bearer' }).set('x-tenant-subdomain', SUB);
    // Monday open 10:00–16:00 with at least 2 guards; Tuesday 13:00–15:00 with at least 1.
    const put = await as('put', `/api/facilities/${t.facility.id}/hours`).send({ blocks: [
      { dayOfWeek: 1, opensMinute: 600, closesMinute: 960, minGuards: 2 },
      { dayOfWeek: 2, opensMinute: 780, closesMinute: 900, minGuards: 1 },
    ] });
    expect(put.status).toBe(200);
    expect((await as('put', `/api/facilities/${t.facility.id}/hours`).send({ blocks: [{ dayOfWeek: 1, opensMinute: 900, closesMinute: 600, minGuards: 1 }] })).status).toBe(400);
    const r = await as('get', `/api/forecast?facilityId=${t.facility.id}&weekStart=${WEEK}&positionId=${t.position.id}`);
    const mon = r.body.days[0].hours;
    const at = (hours: Array<{ hour: number }>, h: number) => hours.find((x) => x.hour === h) as Record<string, unknown>;
    expect(r.body.hoursSet).toBe(true);
    expect(at(mon, 10)).toMatchObject({ open: true, needed: 2, scheduled: 0, gap: 2, reasons: ['minimum'] });
    expect(at(mon, 14)).toMatchObject({ open: true, needed: 3, gap: 2, reasons: ['bathers'] });
    expect(at(r.body.days[1].hours, 14)).toMatchObject({ open: true, needed: 1, reasons: ['minimum'] });
    // Sunday isn't open at all.
    expect(at(r.body.days[6].hours, 14)).toMatchObject({ open: false, needed: 0, reasons: ['closed'] });
  });

  it('counts instructors for classes with swimmers registered', async () => {
    const instructor = await owner.position.create({ data: { tenantId: t.tenant.id, name: 'Instructor' } });
    // Monday 17:00–17:45, 12 registered in classes of 8 → 2 instructors; an empty class needs nobody.
    const full = await owner.lessonClass.create({ data: { tenantId: t.tenant.id, facilityId: t.facility.id, positionId: instructor.id, name: 'Swim 3', dayOfWeek: 1, startMinute: 1020, endMinute: 1065, startsOn: new Date('2026-07-01'), endsOn: new Date('2026-09-30'), maxSwimmers: 8 } });
    await owner.lessonClass.create({ data: { tenantId: t.tenant.id, facilityId: t.facility.id, positionId: instructor.id, name: 'Empty', dayOfWeek: 1, startMinute: 600, endMinute: 660, startsOn: new Date('2026-07-01'), endsOn: new Date('2026-09-30') } });
    for (let i = 0; i < 12; i++) await owner.lessonEnrollment.create({ data: { tenantId: t.tenant.id, classId: full.id, swimmerName: `Swimmer ${i}` } });
    const r = await request(server).get(`/api/forecast?facilityId=${t.facility.id}&weekStart=${WEEK}&positionId=${instructor.id}`).auth(sup, { type: 'bearer' }).set('x-tenant-subdomain', SUB);
    expect(r.body.forLessons).toBe(true);
    const mon = r.body.days[0].hours;
    expect(mon.find((h: { hour: number }) => h.hour === 17)).toMatchObject({ needed: 2, gap: 2, lessons: { classes: 1, swimmers: 12 }, reasons: ['lessons'] });
    expect(mon.find((h: { hour: number }) => h.hour === 10)).toMatchObject({ needed: 0 });
  });

  it('turns the gaps into draft open shifts', async () => {
    const r = await request(server).post('/api/forecast/draft-shifts').auth(sup, { type: 'bearer' }).set('x-tenant-subdomain', SUB).send({ facilityId: t.facility.id, weekStart: WEEK, positionId: t.position.id });
    expect(r.status).toBe(201);
    const monday = r.body.shifts.filter((s: { startsAt: string }) => s.startsAt.startsWith(WEEK)).map((s: { startsAt: string; endsAt: string }) => `${s.startsAt.slice(11, 16)}-${s.endsAt.slice(11, 16)}`).sort();
    // Open 10–16 needing 2 (3 at 14:00) with one guard from 12: short 2 from 10–12, 1 from 12–16 (2 at 14:00).
    // Blocks shorter than the minimum shift length (3 h by default) grow into the day's busy hours.
    expect(monday).toEqual(['10:00-16:00', '10:00-13:00', '13:00-16:00'].sort());
    const saved = await owner.shift.findMany({ where: { tenantId: t.tenant.id, userId: null } });
    expect(saved.every((s) => s.status === 'DRAFT')).toBe(true);
    expect(r.body.created).toBe(saved.length);
    // The forecast still shows the gap (nobody assigned yet) and the open shifts waiting; drafting again adds none.
    const f = await request(server).get(`/api/forecast?facilityId=${t.facility.id}&weekStart=${WEEK}&positionId=${t.position.id}`).auth(sup, { type: 'bearer' }).set('x-tenant-subdomain', SUB);
    expect(f.body.days[0].hours.find((h: { hour: number }) => h.hour === 14)).toMatchObject({ gap: 2, unfilled: 2 });
    const again = await request(server).post('/api/forecast/draft-shifts').auth(sup, { type: 'bearer' }).set('x-tenant-subdomain', SUB).send({ facilityId: t.facility.id, weekStart: WEEK, positionId: t.position.id });
    expect(again.body.created).toBe(0);
  });
});
