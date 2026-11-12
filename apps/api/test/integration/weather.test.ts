import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { resetLimits } from '../../src/auth/rateLimit.js';
import { signAccessToken } from '../../src/auth/tokens.js';
import { addDays, startOfLocalDay } from '../../src/lib/time.js';
import { forgetCustomPermissions } from '../../src/services/people/customRoles.js';
import { refreshWeather, type DayForecast, type WeatherSource } from '../../src/services/ops/weather.js';
import { app as appDb, owner, seedTenant } from './fixtures.js';

const server = createApp();
const WEEK = '2026-08-17'; // a summer Monday
const SITE = 'bc-9001';
const FAIL_SITE = 'bc-9002';
const now = () => Math.floor(Date.now() / 1000);
let A: Awaited<ReturnType<typeof seedTenant>>;
let B: Awaited<ReturnType<typeof seedTenant>>;
let supA: string;
let supB: string;
let hrB: string;
let lead: string;
let parkId: string;

const as = (token: string, sub: string) => ({
  get: (p: string) => request(server).get(p).auth(token, { type: 'bearer' }).set('x-tenant-subdomain', sub),
  post: (p: string, b: object) => request(server).post(p).auth(token, { type: 'bearer' }).set('x-tenant-subdomain', sub).send(b),
  patch: (p: string, b: object) => request(server).patch(p).auth(token, { type: 'bearer' }).set('x-tenant-subdomain', sub).send(b),
  del: (p: string) => request(server).delete(p).auth(token, { type: 'bearer' }).set('x-tenant-subdomain', sub),
});

const day = (date: string, over: Partial<DayForecast> = {}): DayForecast => ({ date, high: 20, low: 10, pop: null, iconCode: 2, condition: 'partly', summaryEn: 'A mix of sun and cloud', summaryFr: 'Alternance de soleil et de nuages', ...over });

/** A fake ECCC that counts requests: Monday hot and sunny, Tuesday rain. */
function fakeSource(counts: Record<string, number>, sitesSeen: string[] = []): WeatherSource {
  const bump = (k: string) => (counts[k] = (counts[k] ?? 0) + 1);
  return {
    async sitesNear(lat, lng) {
      bump('sitesNear');
      sitesSeen.push(`${lat},${lng}`);
      return [{ site: SITE, nameEn: 'Testville', nameFr: 'Villetest', latitude: 50.5, longitude: -120.3 }];
    },
    async cityPage(site) {
      bump(`cityPage:${site}`);
      return { info: { site, nameEn: 'Testville', nameFr: 'Villetest', latitude: 50.5, longitude: -120.3 }, days: [day('2026-08-16'), day(WEEK, { high: 32, condition: 'sunny', iconCode: 0, summaryEn: 'Sunny' }), day(addDays(WEEK, 1), { high: 17, condition: 'rain', pop: 90, iconCode: 12 }), day(addDays(WEEK, 2))] };
    },
    async climateStation() {
      bump('climateStation');
      return null;
    },
    async climateDaily() {
      return [];
    },
  };
}

beforeAll(async () => {
  resetLimits();
  A = await seedTenant('wxa', 1);
  B = await seedTenant('wxb', 1);
  // Both cities' pools are in the same town: one forecast site serves them both.
  await owner.facility.update({ where: { id: A.facility.id }, data: { timezone: 'UTC', latitude: 50.52, longitude: -120.31, exposure: 'OUTDOOR', province: 'NU' } });
  await owner.facility.update({ where: { id: B.facility.id }, data: { timezone: 'UTC', latitude: 50.48, longitude: -120.27 } });
  const park = await owner.facility.create({ data: { tenantId: A.tenant.id, name: 'Beach park', province: 'BC', timezone: 'UTC', exposure: 'OUTDOOR', venueKind: 'BEACH' } });
  parkId = park.id;
  const mk = async (t: typeof A, email: string, roles: string[]) => (await owner.user.create({ data: { tenantId: t.tenant.id, roles: roles as never, employmentStatus: 'FULL_TIME', firstName: 'W', lastName: 'X', email } })).id;
  supA = await signAccessToken({ sub: await mk(A, 'sup@wxa.test', ['AQUATIC_SUPERVISOR']), tid: A.tenant.id, roles: ['AQUATIC_SUPERVISOR'] });
  supB = await signAccessToken({ sub: await mk(B, 'sup@wxb.test', ['AQUATIC_SUPERVISOR']), tid: B.tenant.id, roles: ['AQUATIC_SUPERVISOR'] });
  hrB = await signAccessToken({ sub: await mk(B, 'hr@wxb.test', ['HR_ADMIN']), tid: B.tenant.id, roles: ['HR_ADMIN'], aat: now(), mfa: true });
  // A lead whose custom role reaches only the beach park.
  const role = await owner.customRole.create({ data: { tenantId: A.tenant.id, name: 'Beach lead', permissions: ['schedule.write', 'users.read'], scopeFacilityIds: [park.id] } });
  const leadId = await mk(A, 'lead@wxa.test', ['STAFF']);
  await owner.userCustomRole.create({ data: { tenantId: A.tenant.id, userId: leadId, customRoleId: role.id } });
  forgetCustomPermissions(A.tenant.id);
  lead = await signAccessToken({ sub: leadId, tid: A.tenant.id, roles: ['STAFF'] });

  // History in both cities: the last 4 Mondays at 14:00, 60–90 bathers → 75 expected → 3 guards at 1:25.
  for (const t of [A, B]) {
    const s = await owner.user.findFirstOrThrow({ where: { tenantId: t.tenant.id, roles: { has: 'AQUATIC_SUPERVISOR' } } });
    const pool = await owner.poolBody.create({ data: { tenantId: t.tenant.id, facilityId: t.facility.id, name: 'Main', kind: 'POOL', bathersPerLifeguard: 25 } });
    for (const [i, n] of [60, 70, 80, 90].entries()) {
      const d = addDays(WEEK, -7 * (i + 1));
      await owner.headCount.create({ data: { tenantId: t.tenant.id, poolBodyId: pool.id, count: n, recordedById: s.id, recordedAt: new Date(startOfLocalDay(d, 'UTC').getTime() + 14.25 * 3_600_000) } });
    }
    for (const [i, n] of [40, 40, 40, 40].entries()) {
      const d = addDays(WEEK, 1 - 7 * (i + 1));
      await owner.headCount.create({ data: { tenantId: t.tenant.id, poolBodyId: pool.id, count: n, recordedById: s.id, recordedAt: new Date(startOfLocalDay(d, 'UTC').getTime() + 14.25 * 3_600_000) } });
    }
  }
  await owner.statutoryHoliday.upsert({ where: { province_date: { province: 'NU', date: new Date(`${addDays(WEEK, 1)}T00:00:00Z`) } }, create: { province: 'NU', date: new Date(`${addDays(WEEK, 1)}T00:00:00Z`), name: 'Test Day', nameFr: 'Journée test' }, update: {} });
});

afterAll(async () => {
  await owner.statutoryHoliday.deleteMany({ where: { province: 'NU', name: 'Test Day' } });
  await owner.weatherForecastDay.deleteMany({ where: { site: { in: [SITE, FAIL_SITE] } } });
  await owner.weatherObservation.deleteMany({ where: { site: { in: [SITE, FAIL_SITE] } } });
  await owner.weatherSite.deleteMany({ where: { site: { in: [SITE, FAIL_SITE] } } });
  await appDb.$disconnect();
  await owner.$disconnect();
});

describe('weather cache shared across organizations', () => {
  it('fetches each forecast site once for every city near it, sending only rounded coordinates', async () => {
    const counts: Record<string, number> = {};
    const seen: string[] = [];
    const r = await refreshWeather({ source: fakeSource(counts, seen), prisma: appDb, now: new Date('2026-08-16T18:00:00Z'), tenants: [A.tenant.id, B.tenant.id] });
    expect(r).toMatchObject({ sites: 1, fetched: 1, failed: 0, located: 2 });
    expect(counts[`cityPage:${SITE}`]).toBe(1);
    // Two facilities, one rounded point: one lookup.
    expect(counts.sitesNear).toBe(1);
    expect(seen).toEqual(['50.5,-120.3']);
    const located = await owner.facility.findMany({ where: { id: { in: [A.facility.id, B.facility.id] } }, select: { weatherSiteAuto: true } });
    expect(located.map((f) => f.weatherSiteAuto)).toEqual([SITE, SITE]);
    expect(await owner.weatherForecastDay.count({ where: { site: SITE } })).toBe(4);
    // Today's forecast stands in for the observation.
    expect(await owner.weatherObservation.findUnique({ where: { site_date: { site: SITE, date: new Date('2026-08-16T00:00:00Z') } } })).toMatchObject({ source: 'forecast', condition: 'partly' });

    // Fresh: the next round within three hours asks nothing.
    const again: Record<string, number> = {};
    expect(await refreshWeather({ source: fakeSource(again), prisma: appDb, now: new Date('2026-08-16T19:00:00Z'), tenants: [A.tenant.id, B.tenant.id] })).toMatchObject({ fetched: 0 });
    expect(again[`cityPage:${SITE}`]).toBeUndefined();
  });

  it('the shared tables hold no organization’s data', async () => {
    for (const name of ['WeatherSite', 'WeatherForecastDay', 'WeatherObservation']) {
      const fields = (await owner.$queryRaw<Array<{ column_name: string }>>`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ${name}`).map((r) => r.column_name);
      expect(fields.length).toBeGreaterThan(2);
      expect(fields).not.toContain('tenantId');
      expect(fields.filter((f) => /facility|user|tenant/i.test(f))).toEqual([]);
    }
  });
});

describe('special events', () => {
  let cityWide: string;
  let mine: string;
  it('a manager adds, changes and removes events; bad ones are refused', async () => {
    const sup = as(supA, 'wxa');
    const base = { facilityId: A.facility.id, name: 'Swim meet', startsOn: WEEK, endsOn: WEEK, startMinute: 13 * 60, endMinute: 15 * 60, extraPeople: 40 };
    expect((await sup.post('/api/forecast/events', { ...base, endsOn: addDays(WEEK, -1) })).status).toBe(400);
    expect((await sup.post('/api/forecast/events', { ...base, extraPeople: null })).status).toBe(400);
    expect((await sup.post('/api/forecast/events', { ...base, endMinute: null })).status).toBe(400);
    expect((await sup.post('/api/forecast/events', { ...base, facilityId: B.facility.id })).status).toBe(404);
    const made = await sup.post('/api/forecast/events', base);
    expect(made.status).toBe(201);
    mine = made.body.id;
    const city = await sup.post('/api/forecast/events', { facilityId: null, name: 'Canada Day', startsOn: '2026-07-01', endsOn: '2026-07-01', percent: 30, recursYearly: true, notes: 'Fireworks at the waterfront' });
    expect(city.status).toBe(201);
    cityWide = city.body.id;
    const temp = await sup.post('/api/forecast/events', { facilityId: A.facility.id, name: 'Typo', startsOn: WEEK, endsOn: WEEK, percent: 5 });
    expect((await sup.patch(`/api/forecast/events/${temp.body.id}`, { name: 'Club night', percent: 10 })).body).toMatchObject({ name: 'Club night', percent: 10 });
    expect((await sup.patch(`/api/forecast/events/${temp.body.id}`, { endsOn: addDays(WEEK, -3) })).status).toBe(400);
    expect((await sup.del(`/api/forecast/events/${temp.body.id}`)).status).toBe(204);
    const list = await sup.get(`/api/forecast/events?facilityId=${A.facility.id}`);
    expect(list.body.map((e: { name: string }) => e.name).sort()).toEqual(['Canada Day', 'Swim meet']);
    expect(await owner.auditLog.count({ where: { tenantId: A.tenant.id, action: { startsWith: 'forecast.event_' } } })).toBe(5);
  });

  it('another city can’t see or touch them', async () => {
    const b = as(supB, 'wxb');
    expect((await b.get('/api/forecast/events')).body).toEqual([]);
    expect((await b.get(`/api/forecast/events?facilityId=${A.facility.id}`)).body).toEqual([]);
    expect((await b.patch(`/api/forecast/events/${mine}`, { name: 'Mine now' })).status).toBe(404);
    expect((await b.del(`/api/forecast/events/${cityWide}`)).status).toBe(404);
    expect(await owner.specialEvent.findUniqueOrThrow({ where: { id: mine } })).toMatchObject({ name: 'Swim meet' });
  });

  it('a lead limited to one facility manages its events only, and sees the city-wide ones', async () => {
    const l = as(lead, 'wxa');
    const seen = await l.get('/api/forecast/events');
    expect(seen.status).toBe(200);
    expect(seen.body.map((e: { name: string }) => e.name)).toEqual(['Canada Day']);
    expect((await l.get(`/api/forecast/events?facilityId=${A.facility.id}`)).status).toBe(404);
    expect((await l.post('/api/forecast/events', { facilityId: null, name: 'Festival', startsOn: WEEK, endsOn: WEEK, percent: 20 })).status).toBe(403);
    expect((await l.post('/api/forecast/events', { facilityId: A.facility.id, name: 'Festival', startsOn: WEEK, endsOn: WEEK, percent: 20 })).status).toBe(404);
    const ok = await l.post('/api/forecast/events', { facilityId: parkId, name: 'Sandcastle contest', startsOn: WEEK, endsOn: WEEK, percent: 20 });
    expect(ok.status).toBe(201);
    expect((await l.del(`/api/forecast/events/${mine}`)).status).toBe(404);
    expect((await l.del(`/api/forecast/events/${cityWide}`)).status).toBe(403);
    expect((await l.patch(`/api/forecast/events/${ok.body.id}`, { facilityId: null })).status).toBe(403);
    expect((await l.del(`/api/forecast/events/${ok.body.id}`)).status).toBe(204);
  });
});

describe('forecast with weather and events', () => {
  it('adjusts expected bathers and guards for the weather, the holiday and the event, and says why', async () => {
    const r = await as(supA, 'wxa').get(`/api/forecast?facilityId=${A.facility.id}&weekStart=${WEEK}&positionId=${A.position.id}`);
    expect(r.status).toBe(200);
    expect(r.body.weather).toMatchObject({ status: 'ok', site: SITE, siteName: { en: 'Testville', fr: 'Villetest' }, profile: 'outdoor' });
    const mon = r.body.days[0];
    expect(mon.weather).toMatchObject({ high: 32, condition: 'sunny', observed: false });
    expect(mon.adjustments).toEqual([
      { kind: 'weather', bucket: 'hot', condition: 'sunny', high: 32, pct: 21, source: 'default' },
      expect.objectContaining({ kind: 'event', name: 'Swim meet', extra: 40, cityWide: false }),
    ]);
    // 75 × 1.21 ≈ 91, plus 40 at the meet → 131 → 6 guards; without adjustments 75 → 3.
    const at14 = mon.hours.find((h: { hour: number }) => h.hour === 14);
    expect(at14).toMatchObject({ expected: 131, needed: 6, base: { expected: 75, needed: 3 } });
    // Tuesday: rain (−35%) on a statutory holiday (+15%): 40 → 30.
    const tue = r.body.days[1];
    expect(tue.adjustments.map((x: { kind: string; pct?: number }) => [x.kind, x.pct])).toEqual([['weather', -35], ['holiday', 15]]);
    expect(tue.adjustments[1]).toMatchObject({ name: 'Test Day', nameFr: 'Journée test' });
    expect(tue.hours.find((h: { hour: number }) => h.hour === 14)).toMatchObject({ expected: 30, base: { expected: 40 } });
    // Draft shifts follow the adjusted numbers.
    const draft = await as(supA, 'wxa').post('/api/forecast/draft-shifts', { facilityId: A.facility.id, weekStart: WEEK, positionId: A.position.id });
    expect(draft.status).toBe(201);
    const monShifts = draft.body.shifts.filter((s: { startsAt: string }) => s.startsAt.startsWith(WEEK) && s.startsAt.includes('T14:'));
    expect(monShifts.length).toBe(6);
  });

  it('the other city sees the same weather but none of the first city’s events', async () => {
    const r = await as(supB, 'wxb').get(`/api/forecast?facilityId=${B.facility.id}&weekStart=${WEEK}&positionId=${B.position.id}`);
    expect(r.status).toBe(200);
    expect(r.body.weather.status).toBe('ok');
    // Indoor pool (the default): a hot day barely moves it; no events, no NU holiday (BC).
    expect(r.body.days[0].adjustments).toEqual([{ kind: 'weather', bucket: 'hot', condition: 'sunny', high: 32, pct: -5, source: 'default' }]);
    expect(JSON.stringify(r.body)).not.toMatch(/Swim meet|Canada Day|Test Day/);
  });
});

describe('when the weather service fails', () => {
  it('the job records the failure and carries on; the forecast works without weather', async () => {
    // Settings › Facilities: a forecast site set by hand.
    const set = await as(hrB, 'wxb').patch(`/api/settings/facilities/${B.facility.id}`, { weatherSite: 'BC-9002', exposure: 'OUTDOOR', venueKind: 'POOL' });
    expect(set.status).toBe(200);
    expect(await owner.facility.findUniqueOrThrow({ where: { id: B.facility.id } })).toMatchObject({ weatherSite: FAIL_SITE, exposure: 'OUTDOOR' });
    expect((await as(hrB, 'wxb').patch(`/api/settings/facilities/${B.facility.id}`, { weatherSite: 'kelowna' })).status).toBe(400);

    const broken: WeatherSource = {
      sitesNear: async () => [],
      cityPage: async () => {
        throw new Error('No answer within 10 s');
      },
      climateStation: async () => null,
      climateDaily: async () => [],
    };
    const r = await refreshWeather({ source: broken, prisma: appDb, tenants: [B.tenant.id] });
    expect(r).toMatchObject({ sites: 1, fetched: 0, failed: 1 });
    expect(await owner.weatherSite.findUniqueOrThrow({ where: { site: FAIL_SITE } })).toMatchObject({ failures: 1, lastError: 'No answer within 10 s' });
    // Straight after a failure it waits before trying again.
    expect(await refreshWeather({ source: broken, prisma: appDb, tenants: [B.tenant.id] })).toMatchObject({ failed: 0, fetched: 0 });

    const monday = (() => {
      const d = new Date();
      const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
      x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
      return x.toISOString().slice(0, 10);
    })();
    const f = await as(supB, 'wxb').get(`/api/forecast?facilityId=${B.facility.id}&weekStart=${monday}&positionId=${B.position.id}`);
    expect(f.status).toBe(200);
    expect(f.body.weather.status).toBe('unavailable');
    expect(f.body.days.every((d: { weather: unknown }) => d.weather === null)).toBe(true);
    // And for the week with data at the other site, nothing from it leaks in.
    const g = await as(supB, 'wxb').get(`/api/forecast?facilityId=${B.facility.id}&weekStart=${WEEK}&positionId=${B.position.id}`);
    expect(g.body.weather.status).toBe('unavailable');
    expect(g.body.days[0].hours.find((h: { hour: number }) => h.hour === 14)).toMatchObject({ expected: 75, needed: 3 });
  });
});
