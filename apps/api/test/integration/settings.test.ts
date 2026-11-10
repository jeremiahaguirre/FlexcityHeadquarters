import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { signAccessToken } from '../../src/auth/tokens.js';
import { app as appDb, owner, seedTenant } from './fixtures.js';

const server = createApp();
const SUB = 'mu';
let t: Awaited<ReturnType<typeof seedTenant>>;
let hr: string;

const call = (token: string) => ({
  get: (p: string) => request(server).get(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }),
  post: (p: string, b: unknown = {}) => request(server).post(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }).send(b as object),
  put: (p: string, b: unknown) => request(server).put(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }).send(b as object),
  patch: (p: string, b: object) => request(server).patch(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }).send(b),
});
const utc = (s: string) => new Date(`${s}Z`);

async function guardToken(i: number) {
  return signAccessToken({ sub: t.users[i]!.id, tid: t.tenant.id, roles: ['STAFF'] });
}
async function openShift(startUtc: string, endUtc: string) {
  const shift = await owner.shift.create({
    data: { tenantId: t.tenant.id, facilityId: t.facility.id, positionId: t.position.id, startsAt: utc(startUtc), endsAt: utc(endUtc), status: 'PUBLISHED' },
  });
  return owner.shiftOffer.create({ data: { tenantId: t.tenant.id, shiftId: shift.id, source: 'OPEN_SHIFT' } });
}

beforeAll(async () => {
  t = await seedTenant(SUB, 3);
  const h = await owner.user.create({ data: { tenantId: t.tenant.id, roles: ['HR_ADMIN'], employmentStatus: 'FULL_TIME', firstName: 'H', lastName: 'R', email: 'hr@mu.test' } });
  // Signed in just now, as sensitive HR actions require.
  hr = await signAccessToken({ sub: h.id, tid: t.tenant.id, roles: ['HR_ADMIN'], aat: Math.floor(Date.now() / 1000) });
});
afterAll(async () => {
  await appDb.$disconnect();
  await owner.$disconnect();
});

describe('organization settings', () => {
  it('validates branding colours and facility time zones', async () => {
    expect((await call(hr).patch('/api/settings', { themeColors: { primary: 'teal' } })).status).toBe(400);
    expect((await call(hr).patch('/api/settings', { themeColors: { primary: '#0f766e' }, payWeekStartDay: 0 })).status).toBe(200);
    const bad = await call(hr).post('/api/settings/facilities', { name: 'Annex', province: 'BC', timezone: 'Mars/Olympus', latitude: null, longitude: null, geoRadiusM: 150, costCenter: null });
    expect(bad.status).toBe(400);
  });

  it('lets the city choose 12-hour or 24-hour times for everyone', async () => {
    expect((await call(hr).patch('/api/settings', { timeFormat: '13h' })).status).toBe(400);
    expect((await call(hr).patch('/api/settings', { timeFormat: '24h' })).status).toBe(200);
    expect((await call(hr).get('/api/settings')).body.organization.timeFormat).toBe('24h');
    expect((await call(await guardToken(0)).get('/api/me')).body.timeFormat).toBe('24h');
    expect((await call(hr).patch('/api/settings', { timeFormat: 'auto' })).status).toBe(200);
  });

  it('keeps settings away from staff', async () => {
    expect((await call(await guardToken(0)).get('/api/settings')).status).toBe(403);
  });

  it('a collective-agreement override changes when overtime starts', async () => {
    expect((await call(hr).post('/api/settings/rule-overrides', { province: 'BC', ruleKey: 'pay.bonus', value: 1, effectiveFrom: '2026-01-01', effectiveTo: null, source: 'CBA' })).status).toBe(400);
    const ok = await call(hr).post('/api/settings/rule-overrides', { province: 'BC', ruleKey: 'overtime.dailyHours', value: 7.5, effectiveFrom: '2026-01-01', effectiveTo: null, source: 'CBA art. 14.02' });
    expect(ok.status).toBe(201);
    // 8 hours (8 a.m.–4 p.m. Vancouver) is now 0.5 h overtime → goes to a supervisor.
    const offer = await openShift('2026-12-02T15:00:00', '2026-12-02T23:00:00');
    const claim = await call(await guardToken(0)).post(`/api/offers/${offer.id}/claim`, {});
    expect(claim.body).toEqual({ outcome: 'PENDING_APPROVAL', overtimeHours: '0.50' });
  });

  it('the school calendar decides when a 15-year-old may work', async () => {
    const teen = await owner.user.create({
      data: { tenantId: t.tenant.id, roles: ['STAFF'], employmentStatus: 'CASUAL', firstName: 'Teen', lastName: 'Guard', email: 'teen@mu.test', dateOfBirth: new Date('2011-03-01') },
    });
    await owner.userPosition.create({ data: { tenantId: t.tenant.id, userId: teen.id, positionId: t.position.id } });
    await owner.userCertification.create({ data: { tenantId: t.tenant.id, userId: teen.id, certificationId: t.nls.id, issueDate: new Date('2026-01-01'), expiryDate: new Date('2028-01-01'), verifiedAt: new Date() } });
    const token = await signAccessToken({ sub: teen.id, tid: t.tenant.id, roles: ['STAFF'] });
    // Wednesday 23 Dec, 10 a.m.–2 p.m. Vancouver: a school day by default.
    const offer = await openShift('2026-12-23T17:00:00', '2026-12-23T21:00:00');
    const blocked = await call(token).post(`/api/offers/${offer.id}/claim`, {});
    expect(blocked.status).toBe(422);

    await call(hr).put('/api/settings/school-calendar', [
      { kind: 'TERM', name: '2026–27 school year', startsOn: '2026-09-02', endsOn: '2027-06-25' },
      { kind: 'BREAK', name: 'Winter break', startsOn: '2026-12-21', endsOn: '2027-01-01' },
    ]);
    const allowed = await call(token).post(`/api/offers/${offer.id}/claim`, {});
    expect(allowed.body.outcome).toBe('ASSIGNED');
  });
});

describe('statutory holiday pay in payroll', () => {
  it('adds BC holiday pay (average day’s pay) and vacation pay on it', async () => {
    const g = t.users[2]!;
    await owner.user.update({ where: { id: g.id }, data: { employeeNumber: 'E200', hireDate: new Date('2025-01-01') } });
    await owner.payRate.create({ data: { tenantId: t.tenant.id, userId: g.id, positionId: t.position.id, hourlyRate: '20.00', effectiveFrom: new Date('2025-01-01') } });
    await owner.statutoryHoliday.create({ data: { province: 'BC', date: new Date('2026-10-12'), name: 'Thanksgiving' } });
    // Worked 4 h on 16 of the 30 days before the holiday (9 a.m.–1 p.m. Vancouver).
    for (let d = 15; d <= 30; d++) {
      const day = `2026-09-${String(d).padStart(2, '0')}`;
      await owner.timePunch.create({
        data: { tenantId: t.tenant.id, userId: g.id, facilityId: t.facility.id, positionId: t.position.id, clockIn: utc(`${day}T16:00:00`), clockOut: utc(`${day}T20:00:00`), status: 'APPROVED' },
      });
    }
    await call(hr).put('/api/settings/pay-codes', [
      { key: 'REGULAR', positionId: null, code: 'REG' },
      { key: 'STAT_HOLIDAY_PAY', positionId: null, code: 'STAT_PAY' },
      { key: 'VACATION_PAY', positionId: null, code: 'VAC' },
    ]);
    const r = await call(hr).get('/api/payroll/export?periodStart=2026-10-11&weeks=1');
    expect(r.status).toBe(200);
    const rows = r.text.trim().split('\r\n').slice(1).filter((l) => l.startsWith('E200'));
    expect(rows).toEqual(['E200,STAT_PAY,0.00,0.00,80.00,CC-1,2026-10-11,2026-10-17', 'E200,VAC,0.00,0.00,3.20,CC-1,2026-10-11,2026-10-17']);
  });
});
