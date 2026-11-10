import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { signAccessToken } from '../../src/auth/tokens.js';
import { app as appDb, owner, seedTenant } from './fixtures.js';

const server = createApp();
const SUB = 'trades';
let t: Awaited<ReturnType<typeof seedTenant>>;
const tok: Record<string, string> = {};
let g: string[] = [];
const as = (who: string) => ({
  get: (p: string) => request(server).get(p).set('x-tenant-subdomain', SUB).auth(tok[who]!, { type: 'bearer' }),
  post: (p: string, b: object = {}) => request(server).post(p).set('x-tenant-subdomain', SUB).auth(tok[who]!, { type: 'bearer' }).send(b),
});
// Days ahead at 16:00 UTC, so shifts are in the future and don't cross local midnight.
const at = (days: number, hour = 16) => {
  const d = new Date(Date.now() + days * 86_400_000);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hour));
};
const shift = (userId: string | null, days: number, positionId = t.position.id, hours = 4) =>
  owner.shift.create({ data: { tenantId: t.tenant.id, facilityId: t.facility.id, positionId, userId, startsAt: at(days), endsAt: new Date(at(days).getTime() + hours * 3_600_000), status: 'PUBLISHED' } });

beforeAll(async () => {
  t = await seedTenant(SUB, 3);
  g = t.users.map((u) => u.id);
  const now = Math.floor(Date.now() / 1000);
  for (const [i, id] of g.entries()) tok[`g${i}`] = await signAccessToken({ sub: id, tid: t.tenant.id, roles: ['STAFF'], aat: now });
  const sup = await owner.user.create({ data: { tenantId: t.tenant.id, roles: ['AQUATIC_SUPERVISOR'], employmentStatus: 'FULL_TIME', firstName: 'Sup', lastName: 'X', email: `sup@${SUB}.test` } });
  tok.sup = await signAccessToken({ sub: sup.id, tid: t.tenant.id, roles: ['AQUATIC_SUPERVISOR'], aat: now });
});
afterAll(async () => {
  await appDb.$disconnect();
  await owner.$disconnect();
});

describe('shift trades between two people', () => {
  it('lists the shifts I could trade mine for, then swaps them once both agree and a supervisor approves', async () => {
    const mine = await shift(g[0]!, 3);
    const theirs = await shift(g[1]!, 4);
    const options = (await as('g0').get(`/api/me/trades/options?shiftId=${mine.id}`)).body as Array<{ id: string; person: string }>;
    expect(options.map((o) => o.id)).toContain(theirs.id);
    expect((await as('g1').get(`/api/me/trades/options?shiftId=${mine.id}`)).status).toBe(404);

    const p = await as('g0').post('/api/me/trades', { myShiftId: mine.id, theirShiftId: theirs.id, note: 'Family dinner' });
    expect(p.status).toBe(201);
    expect(p.body).toMatchObject({ status: 'PROPOSED', from: { userId: g[0] }, to: { userId: g[1] } });
    expect(await owner.notification.count({ where: { userId: g[1], type: 'trade_proposed' } })).toBe(1);
    // The same shift can't be in two trades at once.
    expect((await as('g0').post('/api/me/trades', { myShiftId: mine.id, theirShiftId: theirs.id })).body.code).toBe('ALREADY_TRADING');

    expect((await as('g2').post(`/api/me/trades/${p.body.id}/accept`)).status).toBe(404);
    expect((await as('g1').post(`/api/me/trades/${p.body.id}/accept`)).status).toBe(200);
    expect((await as('g0').post(`/api/trades/${p.body.id}/decision`, { decision: 'APPROVE' })).status).toBe(403);
    const pending = (await as('sup').get('/api/trades')).body as Array<{ id: string }>;
    expect(pending.map((x) => x.id)).toEqual([p.body.id]);
    expect((await as('sup').post(`/api/trades/${p.body.id}/decision`, { decision: 'APPROVE' })).status).toBe(200);

    expect((await owner.shift.findUniqueOrThrow({ where: { id: mine.id } })).userId).toBe(g[1]);
    expect((await owner.shift.findUniqueOrThrow({ where: { id: theirs.id } })).userId).toBe(g[0]);
    expect(await owner.notification.count({ where: { type: 'trade_approved' } })).toBe(2);
    expect((await as('g0').get('/api/me/trades')).body[0].status).toBe('APPROVED');
  });

  it('swaps two shifts at the same time (each person gives one up to take the other)', async () => {
    const other = await owner.facility.create({ data: { tenantId: t.tenant.id, name: 'Other pool', province: 'BC', timezone: 'America/Vancouver', costCenter: 'CC-2' } });
    const a = await shift(g[0]!, 6);
    const b = await owner.shift.create({ data: { tenantId: t.tenant.id, facilityId: other.id, positionId: t.position.id, userId: g[2]!, startsAt: at(6), endsAt: new Date(at(6).getTime() + 4 * 3_600_000), status: 'PUBLISHED' } });
    const p = await as('g0').post('/api/me/trades', { myShiftId: a.id, theirShiftId: b.id });
    expect(p.status).toBe(201);
  });

  it('refuses a trade someone isn’t eligible for', async () => {
    const instructor = await owner.position.create({ data: { tenantId: t.tenant.id, name: 'Instructor' } });
    await owner.userPosition.create({ data: { tenantId: t.tenant.id, userId: g[1]!, positionId: instructor.id } });
    const mine = await shift(g[0]!, 8);
    const theirs = await shift(g[1]!, 9, instructor.id);
    expect((await as('g0').post('/api/me/trades', { myShiftId: mine.id, theirShiftId: theirs.id })).body.code).toBe('NOT_ELIGIBLE');
    expect((await as('g0').post('/api/me/trades', { myShiftId: theirs.id, theirShiftId: mine.id })).status).toBe(403);
  });

  it('closes a trade whose shift changed before approval, and swaps nothing', async () => {
    const mine = await shift(g[1]!, 10);
    const theirs = await shift(g[2]!, 11);
    const p = await as('g1').post('/api/me/trades', { myShiftId: mine.id, theirShiftId: theirs.id });
    await as('g2').post(`/api/me/trades/${p.body.id}/accept`);
    await owner.shift.update({ where: { id: theirs.id }, data: { userId: g[0], version: { increment: 1 } } });
    expect((await as('sup').post(`/api/trades/${p.body.id}/decision`, { decision: 'APPROVE' })).body.code).toBe('TRADE_STALE');
    expect((await owner.shiftTrade.findUniqueOrThrow({ where: { id: p.body.id } })).status).toBe('EXPIRED');
    expect((await owner.shift.findUniqueOrThrow({ where: { id: mine.id } })).userId).toBe(g[1]);
  });

  it('the other person can decline, and the proposer can cancel', async () => {
    const a = await shift(g[0]!, 12);
    const b = await shift(g[2]!, 13);
    const p = await as('g0').post('/api/me/trades', { myShiftId: a.id, theirShiftId: b.id });
    expect((await as('g2').post(`/api/me/trades/${p.body.id}/decline`)).status).toBe(200);
    expect(await owner.notification.count({ where: { userId: g[0], type: 'trade_declined' } })).toBe(1);
    const q = await as('g0').post('/api/me/trades', { myShiftId: a.id, theirShiftId: b.id });
    expect(q.status).toBe(201);
    expect((await as('g0').post(`/api/me/trades/${q.body.id}/cancel`)).status).toBe(200);
    expect((await owner.shiftTrade.findUniqueOrThrow({ where: { id: q.body.id } })).status).toBe('CANCELLED');
  });
});
