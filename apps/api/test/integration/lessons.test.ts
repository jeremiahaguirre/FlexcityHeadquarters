import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { signAccessToken } from '../../src/auth/tokens.js';
import { app as appDb, owner, seedTenant } from './fixtures.js';

const server = createApp();
const SUB = 'nu';
let t: Awaited<ReturnType<typeof seedTenant>>;
let sup: string;
let teacher: string;
let other: string;
let classId: string;
const swimmers: string[] = [];
const TUE = '2026-11-03'; // a past Tuesday: attendance is never recorded ahead of time

const call = (token: string) => ({
  get: (p: string) => request(server).get(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }),
  post: (p: string, b: unknown) => request(server).post(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }).send(b as object),
});

beforeAll(async () => {
  t = await seedTenant(SUB, 2);
  const s = await owner.user.create({ data: { tenantId: t.tenant.id, roles: ['AQUATIC_SUPERVISOR'], employmentStatus: 'FULL_TIME', firstName: 'S', lastName: 'N', email: 'sup@nu.test' } });
  sup = await signAccessToken({ sub: s.id, tid: t.tenant.id, roles: ['AQUATIC_SUPERVISOR'] });
  teacher = await signAccessToken({ sub: t.users[0]!.id, tid: t.tenant.id, roles: ['STAFF'] });
  other = await signAccessToken({ sub: t.users[1]!.id, tid: t.tenant.id, roles: ['STAFF'] });
  // Teacher worked 4–6 p.m. Vancouver on Tuesday 3 Nov.
  await owner.shift.create({
    data: { tenantId: t.tenant.id, facilityId: t.facility.id, positionId: t.position.id, userId: t.users[0]!.id, status: 'PUBLISHED', startsAt: new Date('2026-11-03T23:00:00Z'), endsAt: new Date('2026-11-04T01:00:00Z') },
  });
});
afterAll(async () => {
  await appDb.$disconnect();
  await owner.$disconnect();
});

describe('lessons', () => {
  it('a supervisor creates a weekly class and enrolls swimmers up to capacity', async () => {
    const c = await call(sup).post('/api/lessons/classes', {
      facilityId: t.facility.id, positionId: t.position.id, name: 'Swimmer 3', level: 'Swimmer 3', dayOfWeek: 2, startMinute: 16 * 60 + 30, endMinute: 17 * 60 + 15, startsOn: '2026-11-03', endsOn: '2026-12-15', maxSwimmers: 2,
    });
    expect(c.status).toBe(201);
    classId = c.body.id;
    for (const name of ['Ava L.', 'Noah P.']) swimmers.push((await call(sup).post(`/api/lessons/classes/${classId}/enrollments`, { swimmerName: name, safetyNote: name === 'Ava L.' ? 'Asthma: inhaler in bag' : null })).body.id);
    const full = await call(sup).post(`/api/lessons/classes/${classId}/enrollments`, { swimmerName: 'Third Kid' });
    expect(full.status).toBe(409);
  });

  it('instructors see only the sessions their shifts cover, with the roster', async () => {
    const mine = await call(teacher).get(`/api/me/lessons?from=2026-11-02&to=2026-11-15`);
    expect(mine.body).toHaveLength(1);
    expect(mine.body[0]).toMatchObject({ sessionDate: TUE, name: 'Swimmer 3' });
    expect(mine.body[0].localStartsAt).toMatch(/^2026-11-03T16:30:00/);
    expect(mine.body[0].roster.map((r: { swimmerName: string }) => r.swimmerName)).toEqual(['Ava L.', 'Noah P.']);
    expect((await call(other).get(`/api/me/lessons?from=2026-11-02&to=2026-11-15`)).body).toHaveLength(0);
  });

  it('accepts offline batches safely: retries, stale taps, wrong sessions', async () => {
    const at = (min: number) => new Date(Date.parse('2026-11-03T23:40:00Z') + min * 60_000).toISOString();
    const first = await call(teacher).post('/api/lessons/attendance', [
      { clientId: 'dev1-0001', enrollmentId: swimmers[0], sessionDate: TUE, status: 'PRESENT', recordedAt: at(0) },
      { clientId: 'dev1-0002', enrollmentId: swimmers[1], sessionDate: TUE, status: 'ABSENT', recordedAt: at(0) },
      { clientId: 'dev1-0003', enrollmentId: swimmers[1], sessionDate: '2026-11-04', status: 'PRESENT', recordedAt: at(0) },
    ]);
    expect(first.body.results.map((r: { outcome: string }) => r.outcome)).toEqual(['saved', 'saved', 'invalid']);

    const retry = await call(teacher).post('/api/lessons/attendance', [{ clientId: 'dev1-0001', enrollmentId: swimmers[0], sessionDate: TUE, status: 'PRESENT', recordedAt: at(0) }]);
    expect(retry.body.results[0].outcome).toBe('duplicate');

    // Noah arrived late: a newer tap wins; an older one from another device doesn't.
    const later = await call(teacher).post('/api/lessons/attendance', [
      { clientId: 'dev1-0004', enrollmentId: swimmers[1], sessionDate: TUE, status: 'PRESENT', recordedAt: at(10) },
      { clientId: 'dev2-0001', enrollmentId: swimmers[1], sessionDate: TUE, status: 'ABSENT', recordedAt: at(5) },
    ]);
    expect(later.body.results.map((r: { outcome: string }) => r.outcome)).toEqual(['saved', 'superseded']);
    const roster = (await call(teacher).get(`/api/me/lessons?from=${TUE}&to=${TUE}`)).body[0].roster;
    expect(roster.map((r: { status: string }) => r.status)).toEqual(['PRESENT', 'PRESENT']);

    const intruder = await call(other).post('/api/lessons/attendance', [{ clientId: 'dev9-0001', enrollmentId: swimmers[0], sessionDate: TUE, status: 'ABSENT', recordedAt: at(20) }]);
    expect(intruder.body.results[0].outcome).toBe('not_your_session');
  });
});
