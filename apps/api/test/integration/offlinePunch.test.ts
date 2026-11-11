import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { signAccessToken } from '../../src/auth/tokens.js';
import { app as appDb, owner, seedTenant } from './fixtures.js';

// Offline punching: a phone with no signal keeps the tap and sends it later.
const server = createApp();
const SUB = 'offpunch';
const OTHER = 'offpunch2';
let t: Awaited<ReturnType<typeof seedTenant>>;
let staff: string;
let staff2: string;
let sup: string;
let otherSup: string;
let otherStaff: string;
let otherFacility: string;
let otherPosition: string;

const call = (token: string, sub = SUB) => ({
  get: (p: string) => request(server).get(p).set('x-tenant-subdomain', sub).auth(token, { type: 'bearer' }),
  post: (p: string, b: object = {}) => request(server).post(p).set('x-tenant-subdomain', sub).auth(token, { type: 'bearer' }).send(b),
});
const minsAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const onSite = { lat: 49.8801, lon: -119.4401, accuracyM: 10 };

beforeAll(async () => {
  t = await seedTenant(SUB, 2);
  const o = await seedTenant(OTHER, 1);
  const s = await owner.user.create({ data: { tenantId: t.tenant.id, roles: ['AQUATIC_SUPERVISOR'], employmentStatus: 'FULL_TIME', firstName: 'Sue', lastName: 'Sup', email: `sup@${SUB}.test` } });
  const os = await owner.user.create({ data: { tenantId: o.tenant.id, roles: ['AQUATIC_SUPERVISOR'], employmentStatus: 'FULL_TIME', firstName: 'Oz', lastName: 'Sup', email: `sup@${OTHER}.test` } });
  sup = await signAccessToken({ sub: s.id, tid: t.tenant.id, roles: ['AQUATIC_SUPERVISOR'] });
  otherSup = await signAccessToken({ sub: os.id, tid: o.tenant.id, roles: ['AQUATIC_SUPERVISOR'] });
  otherStaff = await signAccessToken({ sub: o.users[0]!.id, tid: o.tenant.id, roles: ['STAFF'] });
  otherFacility = o.facility.id;
  otherPosition = o.position.id;
  staff = await signAccessToken({ sub: t.users[0]!.id, tid: t.tenant.id, roles: ['STAFF'] });
  staff2 = await signAccessToken({ sub: t.users[1]!.id, tid: t.tenant.id, roles: ['STAFF'] });
});
afterAll(async () => {
  await appDb.$disconnect();
  await owner.$disconnect();
});

describe('offline punches', () => {
  it('a re-sent clock-in is recognised, never saved twice', async () => {
    const clientId = randomUUID();
    const body = { facilityId: t.facility.id, positionId: t.position.id, location: onSite, clientId };
    const first = await call(staff2).post('/api/timeclock/in', body);
    expect(first.status).toBe(201);
    const again = await call(staff2).post('/api/timeclock/in', body);
    expect(again.status).toBe(200);
    expect(again.body).toEqual(first.body);
    expect(await owner.timePunch.count({ where: { userId: t.users[1]!.id } })).toBe(1);

    const outId = randomUUID();
    const out1 = await call(staff2).post('/api/timeclock/out', { clientId: outId });
    const out2 = await call(staff2).post('/api/timeclock/out', { clientId: outId });
    expect(out1.status).toBe(200);
    expect(out2.body).toEqual(out1.body);
    // Sent live: not flagged.
    expect(first.body.recordedOffline).toBe(false);
  });

  it('keeps when a late punch happened, when it arrived, and flags it for review', async () => {
    const inAt = minsAgo(180);
    const r = await call(staff).post('/api/timeclock/in', { facilityId: t.facility.id, positionId: t.position.id, location: onSite, clientId: randomUUID(), occurredAt: inAt, sentAt: new Date().toISOString(), offline: true });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ recordedOffline: true, locationStatus: 'VERIFIED' });
    expect(new Date(r.body.clockIn).toISOString()).toBe(inAt);

    const out = await call(staff).post('/api/timeclock/out', { clientId: randomUUID(), occurredAt: minsAgo(60), sentAt: new Date().toISOString(), offline: true });
    expect(out.status).toBe(200);
    const p = await owner.timePunch.findUniqueOrThrow({ where: { id: r.body.id } });
    expect(p.recordedOffline).toBe(true);
    expect(p.clockInReceivedAt).not.toBeNull();
    expect(p.clockOutReceivedAt).not.toBeNull();
    expect(p.clockInReceivedAt!.getTime() - p.clockIn.getTime()).toBeGreaterThan(170 * 60_000);

    const audits = await owner.auditLog.findMany({ where: { entityId: p.id }, select: { action: true } });
    expect(audits.map((a) => a.action).sort()).toEqual(['punch.offline_in', 'punch.offline_out']);

    const q = await call(sup).get('/api/punches');
    const row = q.body.find((x: { id: string }) => x.id === p.id);
    expect(row).toMatchObject({ recordedOffline: true });
    expect(row.attention).toContain('RECORDED_OFFLINE');
    expect(row.localClockInReceivedAt).toBeTruthy();
    expect(row.localClockOutReceivedAt).toBeTruthy();
  });

  it('refuses punches in the future or too old to trust', async () => {
    const base = { facilityId: t.facility.id, positionId: t.position.id, location: null, offline: true };
    const future = await call(staff).post('/api/timeclock/in', { ...base, clientId: randomUUID(), occurredAt: new Date(Date.now() + 10 * 60_000).toISOString() });
    expect(future.status).toBe(422);
    expect(future.body.code).toBe('PUNCH_IN_FUTURE');
    const old = await call(staff).post('/api/timeclock/in', { ...base, clientId: randomUUID(), occurredAt: minsAgo(73 * 60) });
    expect(old.status).toBe(422);
    expect(old.body.code).toBe('PUNCH_TOO_OLD');
    // A little clock drift ahead is fine (lands at "now").
    const drift = await call(staff).post('/api/timeclock/in', { ...base, clientId: randomUUID(), occurredAt: new Date(Date.now() + 60_000).toISOString() });
    expect(drift.status).toBe(201);
    expect((await call(staff).post('/api/timeclock/out', {})).status).toBe(200);
  });

  it('keeps punches in order: no clock-out before the clock-in, no overlaps', async () => {
    // Inside the closed punch from the earlier test (3 h to 1 h ago).
    const overlap = await call(staff).post('/api/timeclock/in', { facilityId: t.facility.id, positionId: t.position.id, location: null, clientId: randomUUID(), occurredAt: minsAgo(120), offline: true });
    expect(overlap.status).toBe(409);
    expect(overlap.body.code).toBe('PUNCH_OVERLAPS');

    // 30 minutes ago is free, but the punch made after it (the drift punch) means it can't run until now.
    const inn = await call(staff).post('/api/timeclock/in', { facilityId: t.facility.id, positionId: t.position.id, location: null, clientId: randomUUID(), occurredAt: minsAgo(30), offline: true });
    expect(inn.status).toBe(201);
    const across = await call(staff).post('/api/timeclock/out', { clientId: randomUUID() });
    expect(across.status).toBe(409);
    expect(across.body.code).toBe('PUNCH_OVERLAPS');
    await owner.timePunch.delete({ where: { id: inn.body.id } });

    const ok = await call(staff).post('/api/timeclock/in', { facilityId: t.facility.id, positionId: t.position.id, location: null, clientId: randomUUID() });
    expect(ok.status).toBe(201);
    const before = await call(staff).post('/api/timeclock/out', { clientId: randomUUID(), occurredAt: minsAgo(10), offline: true });
    expect(before.status).toBe(422);
    expect(before.body.code).toBe('PUNCH_OUT_BEFORE_IN');
    const twice = await call(staff).post('/api/timeclock/in', { facilityId: t.facility.id, positionId: t.position.id, location: null, clientId: randomUUID(), occurredAt: minsAgo(1), offline: true });
    expect(twice.body.code).toBe('ALREADY_CLOCKED_IN');
    expect((await call(staff).post('/api/timeclock/out', { clientId: randomUUID() })).status).toBe(200);
  });

  it('corrects for a wrong phone clock and flags a large difference', async () => {
    // The phone is 20 minutes behind: its clock says the punch was 4 h 20 min ago "now - 20 min".
    const phoneNow = new Date(Date.now() - 20 * 60_000);
    const r = await call(staff2).post('/api/timeclock/in', {
      facilityId: t.facility.id,
      positionId: t.position.id,
      location: null,
      clientId: randomUUID(),
      occurredAt: new Date(phoneNow.getTime() - 4 * 3_600_000).toISOString(),
      sentAt: phoneNow.toISOString(),
      offline: true,
    });
    expect(r.status).toBe(201);
    const p = await owner.timePunch.findUniqueOrThrow({ where: { id: r.body.id } });
    expect(Math.abs(p.clockSkewS! - 1200)).toBeLessThan(5);
    expect(Math.abs(Date.now() - 4 * 3_600_000 - p.clockIn.getTime())).toBeLessThan(10_000);
    await call(staff2).post('/api/timeclock/out', { clientId: randomUUID(), occurredAt: new Date(phoneNow.getTime() - 3 * 3_600_000).toISOString(), sentAt: phoneNow.toISOString(), offline: true });
    const row = (await call(sup).get('/api/punches')).body.find((x: { id: string }) => x.id === p.id);
    expect(row.attention).toEqual(expect.arrayContaining(['RECORDED_OFFLINE', 'CLOCK_SKEW']));
  });

  it('another city can’t see offline punches or replay their ids', async () => {
    const mine = await owner.timePunch.findFirstOrThrow({ where: { tenantId: t.tenant.id, recordedOffline: true } });
    const q = await call(otherSup, OTHER).get('/api/punches');
    expect(q.status).toBe(200);
    expect(q.body.find((x: { id: string }) => x.id === mine.id)).toBeUndefined();
    expect(q.body.every((x: { recordedOffline: boolean }) => !x.recordedOffline)).toBe(true);
    // Re-using another city's punch id gets a punch of your own, never theirs.
    const r = await call(otherStaff, OTHER).post('/api/timeclock/in', { facilityId: otherFacility, positionId: otherPosition, location: null, clientId: mine.clientInId });
    expect(r.status).toBe(201);
    expect(r.body.id).not.toBe(mine.id);
  });

  it('keeps staff out of punch review', async () => {
    expect((await call(staff).get('/api/punches')).status).toBe(403);
  });
});
