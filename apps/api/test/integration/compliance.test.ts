import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { resetLimits } from '../../src/auth/rateLimit.js';
import { signAccessToken } from '../../src/auth/tokens.js';
import { app as appDb, owner, seedTenant } from './fixtures.js';

const server = createApp();
const SUB = 'complymin';
let t: Awaited<ReturnType<typeof seedTenant>>;
let hr: string;
let guard: string;
const AT = new Date(Date.now() - 5 * 86_400_000);
const at = (h: number) => new Date(AT.getTime() + h * 3_600_000);
const call = (token: string) => ({ get: (p: string) => request(server).get(p).auth(token, { type: 'bearer' }).set('x-tenant-subdomain', SUB) });

beforeAll(async () => {
  resetLimits();
  t = await seedTenant(SUB, 3);
  const h = await owner.user.create({ data: { tenantId: t.tenant.id, roles: ['HR_ADMIN'], employmentStatus: 'FULL_TIME', firstName: 'H', lastName: 'R', email: 'hr@complymin.test' } });
  hr = await signAccessToken({ sub: h.id, tid: t.tenant.id, roles: ['HR_ADMIN'] });
  guard = await signAccessToken({ sub: t.users[0]!.id, tid: t.tenant.id, roles: ['STAFF'] });
  const [a, b, c] = t.users;
  await owner.userCertification.updateMany({ where: { tenantId: t.tenant.id }, data: { verifiedAt: new Date(AT.getTime() - 30 * 86_400_000) } });
  // a: worked and on the chair; b: worked, but certification had expired the day before; c: scheduled, never clocked in.
  await owner.userCertification.updateMany({ where: { userId: b!.id }, data: { expiryDate: new Date(AT.getTime() - 86_400_000) } });
  for (const u of [a!, b!, c!]) {
    await owner.shift.create({ data: { tenantId: t.tenant.id, facilityId: t.facility.id, positionId: t.position.id, userId: u.id, status: 'PUBLISHED', startsAt: at(-2), endsAt: at(4) } });
  }
  for (const u of [a!, b!]) {
    await owner.timePunch.create({ data: { tenantId: t.tenant.id, userId: u.id, facilityId: t.facility.id, positionId: t.position.id, clockIn: at(-2), clockOut: at(4) } });
  }
  const pool = await owner.poolBody.create({ data: { tenantId: t.tenant.id, facilityId: t.facility.id, name: 'Main Tank', kind: 'POOL', bathersPerLifeguard: 25, maxCapacity: 100, phMin: '7.2', phMax: '7.8', freeChlorineMinPpm: '1' } });
  const station = await owner.deckStation.create({ data: { tenantId: t.tenant.id, facilityId: t.facility.id, poolBodyId: pool.id, name: 'Deep end chair' } });
  await owner.rotationLog.create({ data: { tenantId: t.tenant.id, facilityId: t.facility.id, stationId: station.id, userId: a!.id, startedAt: at(-0.25), endedAt: at(0.25), recordedById: a!.id } });
  await owner.headCount.create({ data: { tenantId: t.tenant.id, poolBodyId: pool.id, count: 60, recordedAt: at(-0.5), recordedById: a!.id, overCapacity: false } });
  await owner.chemicalReading.create({ data: { tenantId: t.tenant.id, poolBodyId: pool.id, recordedById: a!.id, recordedAt: at(-1), ph: '8.1', freeChlorinePpm: '2.0', outOfRange: true } });
  await owner.incidentReport.create({ data: { tenantId: t.tenant.id, facilityId: t.facility.id, reportedById: a!.id, occurredAt: at(0.5), category: 'FIRST_AID', ciphertext: Buffer.from('x'), iv: Buffer.from('x'), authTag: Buffer.from('x'), wrappedDataKey: Buffer.from('x'), kekId: 'k' } });
});
afterAll(async () => {
  await appDb.$disconnect();
  await owner.$disconnect();
});

describe('compliance at any minute', () => {
  it('is for HR and supervisors only', async () => {
    expect((await call(guard).get(`/api/compliance/snapshot?facilityId=${t.facility.id}&at=${AT.toISOString()}`)).status).toBe(403);
  });

  it('rebuilds who was on deck, their certifications then, staffing, chemistry and incidents', async () => {
    const r = await call(hr).get(`/api/compliance/snapshot?facilityId=${t.facility.id}&at=${AT.toISOString()}`);
    expect(r.status).toBe(200);
    const byName = (n: string) => r.body.people.find((p: { name: string }) => p.name.startsWith(n));
    expect(byName('Guard0')).toMatchObject({ clockedIn: true, station: 'Deep end chair' });
    expect(byName('Guard0').certifications[0].status).toBe('VALID');
    expect(byName('Guard1').certifications[0].status).toBe('EXPIRED');
    expect(byName('Guard2')).toMatchObject({ scheduled: true, clockedIn: false });
    const pool = r.body.pools[0];
    expect(pool).toMatchObject({ lifeguardsRequired: 3, lifeguardsOnStation: 1 });
    expect(pool.chemistry.outOfRange).toBe(true);
    expect(r.body.incidents).toHaveLength(1);
    expect(r.body.issues.map((i: { code: string }) => i.code).sort()).toEqual(['CERT_EXPIRED', 'CHEMISTRY_OUT_OF_RANGE', 'SCHEDULED_NOT_CLOCKED_IN', 'UNDERSTAFFED']);
    expect(await owner.auditLog.count({ where: { tenantId: t.tenant.id, action: 'compliance.snapshot' } })).toBe(1);
  });

  it('a minute after the shift, nobody is on deck', async () => {
    const r = await call(hr).get(`/api/compliance/snapshot?facilityId=${t.facility.id}&at=${at(5).toISOString()}`);
    expect(r.body.people).toEqual([]);
  });
});
