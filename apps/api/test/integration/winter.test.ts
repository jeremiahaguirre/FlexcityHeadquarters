import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { signAccessToken } from '../../src/auth/tokens.js';
import { withTenant } from '../../src/lib/db.js';
import { forgetFeatures } from '../../src/services/platform/features.js';
import { callOutTimeouts } from '../../src/services/winter/callOuts.js';
import { routeStatus } from '../../src/services/winter/patrols.js';
import { inSeason } from '../../src/services/winter/settings.js';
import { app as appDb, owner, seedTenant } from './fixtures.js';

const server = createApp();
const SUB = 'winter';
let t: Awaited<ReturnType<typeof seedTenant>>;
let plow: string;
const ids: Record<'hr' | 'a' | 'b' | 'c', string> = { hr: '', a: '', b: '', c: '' };
const tok: Record<'hr' | 'a' | 'b' | 'c', string> = { hr: '', a: '', b: '', c: '' };
const call = (token: string) => ({
  get: (p: string) => request(server).get(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }),
  post: (p: string, b: object = {}) => request(server).post(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }).send(b),
  put: (p: string, b: object = {}) => request(server).put(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }).send(b),
});
const SETTINGS = { season: { start: '11-01', end: '04-15' }, callOuts: { responseMinutes: 10, minRestHours: 8 }, patrols: { graceMinutes: 30 } };
const storm = (dayOffset: number) => {
  const d = new Date(Date.now() + dayOffset * 86_400_000);
  const startsAt = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 10));
  return { startsAt, endsAt: new Date(startsAt.getTime() + 6 * 3_600_000) };
};

beforeAll(async () => {
  t = await seedTenant(SUB, 0);
  plow = (await owner.position.create({ data: { tenantId: t.tenant.id, name: 'Plow Operator' } })).id;
  const mk = async (key: keyof typeof ids, roles: ('HR_ADMIN' | 'EMPLOYEE')[], seniority: string) => {
    const u = await owner.user.create({ data: { tenantId: t.tenant.id, roles, employmentStatus: 'FULL_TIME', firstName: key, lastName: 'X', email: `${key}@winter.test`, seniorityDate: new Date(seniority) } });
    if (key !== 'hr') await owner.userPosition.create({ data: { tenantId: t.tenant.id, userId: u.id, positionId: plow } });
    ids[key] = u.id;
    tok[key] = await signAccessToken({ sub: u.id, tid: t.tenant.id, roles, aat: Math.floor(Date.now() / 1000) });
  };
  await mk('hr', ['HR_ADMIN'], '2000-01-01');
  await mk('a', ['EMPLOYEE'], '2005-01-01'); // most senior
  await mk('b', ['EMPLOYEE'], '2010-01-01');
  await mk('c', ['EMPLOYEE'], '2015-01-01');
});
afterAll(async () => {
  await appDb.$disconnect();
  await owner.$disconnect();
});

describe('winter settings', () => {
  it('off until the city switches them on; managers set their own time frames', async () => {
    expect((await call(tok.hr).get('/api/call-outs')).status).toBe(404);
    expect((await call(tok.hr).get('/api/winter/settings')).body).toMatchObject({ callOutsOn: false, patrolsOn: false, callOuts: { responseMinutes: 15 } });
    expect((await call(tok.a).put('/api/winter/settings', { ...SETTINGS, callOutsOn: true, patrolsOn: true })).status).toBe(403);
    expect((await call(tok.hr).put('/api/winter/settings', { ...SETTINGS, callOutsOn: true, patrolsOn: true })).status).toBe(200);
    forgetFeatures(t.tenant.id);
    expect((await call(tok.hr).get('/api/winter/settings')).body).toMatchObject({ callOutsOn: true, patrolsOn: true, callOuts: { responseMinutes: 10 } });
    expect((await call(tok.a).get('/api/me')).body.permissions).toContain('winter.patrol');
  });

  it('the season wraps the new year', () => {
    const s = { start: '11-01', end: '04-15' };
    expect(inSeason(new Date('2026-12-20T12:00:00Z'), s)).toBe(true);
    expect(inSeason(new Date('2027-03-01T12:00:00Z'), s)).toBe(true);
    expect(inSeason(new Date('2026-07-01T12:00:00Z'), s)).toBe(false);
  });
});

describe('storm call-outs', () => {
  let id: string;
  const contacts = async () => (await call(tok.hr).get('/api/call-outs')).body.find((c: { id: string }) => c.id === id).contacts as Array<{ id: string; userId: string; status: string; skipReason: string | null }>;

  it('goes out in overtime order, skipping anyone without enough rest, one person at a time', async () => {
    const { startsAt, endsAt } = storm(3);
    // b worked until 2 hours before the call-out: not enough rest.
    await owner.shift.create({ data: { tenantId: t.tenant.id, facilityId: t.facility.id, positionId: plow, userId: ids.b, startsAt: new Date(startsAt.getTime() - 10 * 3_600_000), endsAt: new Date(startsAt.getTime() - 2 * 3_600_000), status: 'PUBLISHED' } });
    const r = await call(tok.hr).post('/api/call-outs', { facilityId: t.facility.id, positionId: plow, reason: 'Freezing rain, all routes', startsAt, endsAt });
    expect(r.status).toBe(201);
    id = r.body.id;
    const list = await contacts();
    expect(list.map((c) => [c.userId, c.status])).toEqual([[ids.a, 'OFFERED'], [ids.b, 'SKIPPED'], [ids.c, 'WAITING']]);
    expect(list[1]!.skipReason).toMatch(/REST/);
    expect(await owner.notification.count({ where: { userId: ids.a, type: 'callout_offer' } })).toBe(1);
    expect((await call(tok.a).get('/api/me/call-outs')).body).toHaveLength(1);
    expect((await call(tok.c).get('/api/me/call-outs')).body).toHaveLength(0);
  });

  it('no answer in time counts on the ledger and moves to the next person', async () => {
    expect(await withTenant(t.tenant.id, (tx) => callOutTimeouts(tx, new Date(Date.now() + 11 * 60_000)))).toBe(1);
    const list = await contacts();
    expect(list.map((c) => c.status)).toEqual(['NO_ANSWER', 'SKIPPED', 'OFFERED']);
    expect(await owner.overtimeEntry.count({ where: { userId: ids.a, kind: 'NO_ANSWER' } })).toBe(1);
  });

  it('accepting in the app fills it, assigns the shift and charges the overtime', async () => {
    const mine = (await call(tok.c).get('/api/me/call-outs')).body[0];
    expect((await call(tok.a).post(`/api/me/call-outs/${mine.id}`, { answer: 'ACCEPTED' })).status).toBe(404);
    expect((await call(tok.c).post(`/api/me/call-outs/${mine.id}`, { answer: 'ACCEPTED' })).status).toBe(200);
    const c = (await call(tok.hr).get('/api/call-outs')).body.find((x: { id: string }) => x.id === id);
    expect(c).toMatchObject({ status: 'FILLED', filledBy: 'c X' });
    const callOut = await owner.callOut.findUniqueOrThrow({ where: { id } });
    expect((await owner.shift.findUniqueOrThrow({ where: { id: callOut.shiftId } })).userId).toBe(ids.c);
    expect(await owner.overtimeEntry.count({ where: { userId: ids.c, kind: 'ACCEPTED' } })).toBe(1);
    expect(await owner.notification.count({ where: { userId: ids.hr, type: 'callout_filled' } })).toBe(1);
  });

  it('a supervisor records phone answers; a refusal moves on; cancelling stops it', async () => {
    const { startsAt, endsAt } = storm(6);
    const r = await call(tok.hr).post('/api/call-outs', { facilityId: t.facility.id, positionId: plow, reason: 'Snow, 25 cm', startsAt, endsAt });
    id = r.body.id;
    const first = (await contacts()).find((c) => c.status === 'OFFERED')!;
    expect((await call(tok.hr).post(`/api/call-outs/${id}/contacts/${first.id}`, { answer: 'DECLINED' })).status).toBe(200);
    expect(await owner.overtimeEntry.count({ where: { userId: first.userId, kind: 'REFUSED' } })).toBe(1);
    expect((await contacts()).filter((c) => c.status === 'OFFERED')).toHaveLength(1);
    expect((await call(tok.hr).post(`/api/call-outs/${id}/cancel`)).status).toBe(200);
    expect((await contacts()).some((c) => c.status === 'OFFERED' || c.status === 'WAITING')).toBe(false);
  });
});

describe('patrol records', () => {
  let routeId: string;
  it('routes with their own patrol interval; overdue only in season', async () => {
    const r = await call(tok.hr).post('/api/winter/routes', { name: 'Route 7: Hillside Dr', roadClass: '3', intervalHours: 24 });
    expect(r.status).toBe(201);
    routeId = r.body.id;
    const inWinter = await withTenant(t.tenant.id, (tx) => routeStatus(tx, new Date('2026-12-15T15:00:00Z')));
    expect(inWinter[0]).toMatchObject({ name: 'Route 7: Hillside Dr', overdue: true });
    const summer = await withTenant(t.tenant.id, (tx) => routeStatus(tx, new Date('2026-07-15T15:00:00Z')));
    expect(summer[0]!.overdue).toBe(false);
  });

  it('a worker records a patrol; records export as CSV', async () => {
    const p = await call(tok.a).post('/api/patrols', { routeId, vehicle: 'Plow 12', startLat: 49.88, startLng: -119.47 });
    expect(p.status).toBe(201);
    expect((await call(tok.a).post('/api/patrols', { routeId })).body.code).toBe('PATROL_OPEN');
    const done = await call(tok.a).post(`/api/patrols/${p.body.id}/finish`, { conditions: ['SNOW_PACKED', 'ICE'], actions: ['PLOWED', 'SALTED'], snowCm: 12, roadTempC: -6, materialTonnes: 3.5, notes: '=cmd() should not run' });
    expect(done.status).toBe(200);
    expect((await call(tok.a).get('/api/patrols?from=2020-01-01&to=2030-01-01')).status).toBe(403);
    const list = await call(tok.hr).get('/api/patrols?from=2020-01-01&to=2030-01-01');
    expect(list.body[0]).toMatchObject({ route: 'Route 7: Hillside Dr', person: 'a X', conditions: ['SNOW_PACKED', 'ICE'], actions: ['PLOWED', 'SALTED'], materialTonnes: 3.5 });
    const csv = await call(tok.hr).get('/api/patrols/export?from=2020-01-01&to=2030-01-01');
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text).toContain('"SNOW_PACKED ICE"');
    expect(csv.text).toContain(`"'=cmd() should not run"`);
  });

  it('switching patrols off hides them from everyone', async () => {
    await call(tok.hr).put('/api/winter/settings', { ...SETTINGS, callOutsOn: true, patrolsOn: false });
    forgetFeatures(t.tenant.id);
    expect((await call(tok.a).get('/api/me/patrols')).status).toBe(404);
    expect((await call(tok.a).get('/api/me')).body.permissions).not.toContain('winter.patrol');
  });
});
