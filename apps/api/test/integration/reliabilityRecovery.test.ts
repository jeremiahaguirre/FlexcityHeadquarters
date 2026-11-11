import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { resetLimits } from '../../src/auth/rateLimit.js';
import { signAccessToken } from '../../src/auth/tokens.js';
import { withTenant } from '../../src/lib/db.js';
import { recomputeReliability } from '../../src/services/jobs/daily.js';
import { app as appDb, owner, seedTenant } from './fixtures.js';

const server = createApp();
const SUB = 'relrecover';
const OTHER = 'relrecover2';
let t: Awaited<ReturnType<typeof seedTenant>>;
let o: Awaited<ReturnType<typeof seedTenant>>;
let hr: string;
let sup: string;
let supId: string;
let guard: string;
let guardId: string;
let otherHr: string;
const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);

const call = (token: string, sub = SUB) => {
  const w = (r: request.Test) => r.auth(token, { type: 'bearer' }).set('x-tenant-subdomain', sub);
  return {
    get: (p: string) => w(request(server).get(p)),
    post: (p: string, b: object = {}) => w(request(server).post(p)).send(b),
    put: (p: string, b: object = {}) => w(request(server).put(p)).send(b),
  };
};

type Change = { kind: string; applied: number; points: number; fading?: boolean; eventType?: string };

beforeAll(async () => {
  resetLimits();
  t = await seedTenant(SUB, 2);
  o = await seedTenant(OTHER, 1);
  guardId = t.users[0]!.id;
  const h = await owner.user.create({ data: { tenantId: t.tenant.id, roles: ['HR_ADMIN'], employmentStatus: 'FULL_TIME', firstName: 'Ria', lastName: 'Hart', email: 'hr@relrecover.test' } });
  const s = await owner.user.create({ data: { tenantId: t.tenant.id, roles: ['AQUATIC_SUPERVISOR'], employmentStatus: 'FULL_TIME', firstName: 'Sam', lastName: 'Lee', email: 'sup@relrecover.test' } });
  const oh = await owner.user.create({ data: { tenantId: o.tenant.id, roles: ['HR_ADMIN'], employmentStatus: 'FULL_TIME', firstName: 'Oli', lastName: 'Vance', email: 'hr@relrecover2.test' } });
  supId = s.id;
  const now = Math.floor(Date.now() / 1000);
  hr = await signAccessToken({ sub: h.id, tid: t.tenant.id, roles: ['HR_ADMIN'], aat: now });
  sup = await signAccessToken({ sub: s.id, tid: t.tenant.id, roles: ['AQUATIC_SUPERVISOR'], aat: now });
  guard = await signAccessToken({ sub: guardId, tid: t.tenant.id, roles: ['STAFF'] });
  otherHr = await signAccessToken({ sub: oh.id, tid: o.tenant.id, roles: ['HR_ADMIN'], aat: now });

  const base = { tenantId: t.tenant.id, userId: guardId, facilityId: t.facility.id, positionId: t.position.id };
  // A no-show 65 days ago (now fading), recorded by the supervisor.
  await owner.reliabilityEvent.create({ data: { tenantId: t.tenant.id, userId: guardId, type: 'NO_SHOW', occurredAt: daysAgo(65), recordedById: supId, note: 'Missed the opener' } });
  // Twelve completed shifts in the last 25 days, one of them clocked in late 3 days ago.
  for (let i = 0; i < 12; i++) {
    const at = daysAgo(25 - i * 2);
    const p = await owner.timePunch.create({ data: { ...base, clockIn: at, clockOut: new Date(at.getTime() + 4 * 3_600_000), status: 'APPROVED' } });
    if (i === 11) await owner.reliabilityEvent.create({ data: { tenantId: t.tenant.id, userId: guardId, type: 'LATE_PUNCH', occurredAt: at, sourceId: p.id } });
  }
  // A no-show while on protected leave: never counts.
  await owner.timeOffRequest.create({ data: { tenantId: t.tenant.id, userId: guardId, type: 'PROTECTED_LEAVE', status: 'APPROVED', startsAt: daysAgo(41), endsAt: daysAgo(39) } });
  await owner.reliabilityEvent.create({ data: { tenantId: t.tenant.id, userId: guardId, type: 'NO_SHOW', occurredAt: daysAgo(40) } });
});
afterAll(async () => {
  await appDb.$disconnect();
  await owner.$disconnect();
});

describe('the reliability score explains how it recovers', () => {
  it('the person’s own file lists every change: fading deduction, on-time credits, protected leave left out', async () => {
    const r = await call(guard).get('/api/me/case-file');
    expect(r.status).toBe(200);
    const changes: Change[] = r.body.reliability.changes;
    expect(r.body.reliability.mode).toBe('GRADUAL');
    expect(changes.find((c) => c.kind === 'EVENT' && c.eventType === 'NO_SHOW')).toMatchObject({ points: -7, fading: true });
    expect(changes.some((c) => c.kind === 'ON_TIME' && c.applied > 0)).toBe(true);
    expect(changes.some((c) => c.kind === 'CLEAN' && c.applied > 0)).toBe(true);
    const statuses = r.body.events.map((e: { type: string; status: string }) => `${e.type}:${e.status}`).sort();
    expect(statuses).toEqual(['LATE_PUNCH:COUNTED', 'NO_SHOW:FADING', 'NO_SHOW:PROTECTED']);
    expect(r.body.score).toBeGreaterThan(100 - 7 - 2);
    expect(r.body.score).toBeLessThanOrEqual(100);
  });

  it('HR sees the same score on the file, the review list, the breakdown, the stored score and the report', async () => {
    const mine = (await call(guard).get('/api/me/case-file')).body.score;
    const file = await call(hr).get(`/api/users/${guardId}/case-file`);
    expect(file.body.score).toBe(mine);
    const list = await call(hr).get('/api/people/review');
    expect(list.body.find((x: { id: string }) => x.id === guardId).score).toBe(mine);
    const b = await call(hr).get(`/api/users/${guardId}/reliability`);
    expect(b.body.score).toBe(mine);
    expect(b.body.notice).toMatch(/Advisory only/);
    await withTenant(t.tenant.id, (tx) => recomputeReliability(tx), { prisma: appDb });
    expect((await owner.user.findUniqueOrThrow({ where: { id: guardId } })).reliabilityScore).toBe(mine);
    const today = new Date().toISOString().slice(0, 10);
    const rep = await call(hr).get(`/api/reports/run?key=reliability&from=${daysAgo(30).toISOString().slice(0, 10)}&to=${today}`);
    expect(rep.status).toBe(200);
    expect(rep.body.rows.find((x: { person: string }) => x.person === `Guard0 ${SUB}`).score).toBe(mine);
  });

  it('a supervisor who isn’t HR sees only what they recorded, without timeclock credits', async () => {
    const r = await call(sup).get(`/api/users/${guardId}/case-file`);
    expect(r.body.onlyMine).toBe(true);
    expect(r.body.events).toHaveLength(1);
    expect(r.body.reliability.changes.some((c: Change) => c.kind === 'ON_TIME')).toBe(false);
  });

  it('staff can’t read someone else’s breakdown, and another organization can’t see this person at all', async () => {
    expect((await call(guard).get(`/api/users/${t.users[1]!.id}/reliability`)).status).toBe(403);
    expect((await call(otherHr, OTHER).get(`/api/users/${guardId}/reliability`)).status).toBe(404);
    expect((await call(otherHr, OTHER).get(`/api/users/${guardId}/case-file`)).status).toBe(404);
  });
});

describe('the yearly restart', () => {
  it('only HR configures it, the day must exist, and it’s kept separate per organization', async () => {
    expect((await call(sup).put('/api/settings/reliability', { mode: 'RESET', resetMonth: 1, resetDay: 1 })).status).toBe(403);
    expect((await call(hr).put('/api/settings/reliability', { mode: 'RESET', resetMonth: 2, resetDay: 30 })).status).toBe(400);
    const g = await call(hr).get('/api/settings/reliability');
    expect(g.body).toMatchObject({ mode: 'GRADUAL', resetMonth: 1, resetDay: 1, timeZone: 'America/Vancouver' });
  });

  it('restarting a month ago: the earlier no-show no longer counts but stays on the record', async () => {
    const d = daysAgo(30);
    const put = await call(hr).put('/api/settings/reliability', { mode: 'RESET', resetMonth: d.getUTCMonth() + 1, resetDay: d.getUTCDate() });
    expect(put.status).toBe(200);
    expect(put.body.lastRestartAt).toBeTruthy();
    // Saving the retention periods keeps the choice.
    await call(hr).put('/api/settings/retention', { notificationsDays: 730, emailLogDays: 90 });
    expect((await call(hr).get('/api/settings/reliability')).body.mode).toBe('RESET');

    const r = await call(guard).get('/api/me/case-file');
    expect(r.body.reliability.mode).toBe('RESET');
    expect(r.body.reliability.restartedAt).toBeTruthy();
    expect(r.body.reliability.changes[0].kind).toBe('RESTART');
    const noShow = r.body.events.find((e: { type: string; status: string }) => e.type === 'NO_SHOW' && e.status !== 'PROTECTED');
    expect(noShow).toMatchObject({ status: 'RESTARTED', counted: false });
    // Only the late clock-in since the restart, in full; no recovery credits under a plain restart.
    expect(r.body.score).toBe(98);
    expect((await call(hr).get('/api/people/review')).body.find((x: { id: string }) => x.id === guardId).score).toBe(98);
    expect(await owner.reliabilityEvent.count({ where: { userId: guardId } })).toBe(3);

    // Under both, good attendance after the late clock-in earns it back too.
    await owner.timePunch.create({ data: { tenantId: t.tenant.id, userId: guardId, facilityId: t.facility.id, positionId: t.position.id, clockIn: daysAgo(1), clockOut: new Date(daysAgo(1).getTime() + 4 * 3_600_000), status: 'APPROVED' } });
    const both = await call(hr).put('/api/settings/reliability', { mode: 'BOTH', resetMonth: d.getUTCMonth() + 1, resetDay: d.getUTCDate() });
    expect(both.status).toBe(200);
    const b = await call(guard).get('/api/me/case-file');
    expect(b.body.reliability.mode).toBe('BOTH');
    expect(b.body.score).toBe(99);
    expect(b.body.reliability.changes.some((c: Change) => c.kind === 'ON_TIME')).toBe(true);

    // The other organization is untouched.
    expect((await call(otherHr, OTHER).get('/api/settings/reliability')).body.mode).toBe('GRADUAL');
  });
});
