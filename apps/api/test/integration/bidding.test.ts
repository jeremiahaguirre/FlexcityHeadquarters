/** Shift bidding end to end: needs seniority, ranking, close in seniority order with reasons, override with a reason, confirm, board, notifications, stewards, isolation. */
import request from 'supertest';
import { DateTime } from 'luxon';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { signAccessToken } from '../../src/auth/tokens.js';
import { withTenant } from '../../src/lib/db.js';
import { forgetFeatures } from '../../src/services/platform/features.js';
import { bidRoundTick } from '../../src/services/scheduling/bidding.js';
import { app as appDb, owner, seedTenant } from './fixtures.js';

const server = createApp();
const SUB = 'bidwk';
const SUB2 = 'bidwk2';
const TZ = 'America/Vancouver';
const now = () => Math.floor(Date.now() / 1000);
const call = (token: string, sub = SUB) => ({
  get: (p: string) => request(server).get(p).set('x-tenant-subdomain', sub).auth(token, { type: 'bearer' }),
  post: (p: string, b: object = {}) => request(server).post(p).set('x-tenant-subdomain', sub).auth(token, { type: 'bearer' }).send(b),
  put: (p: string, b: object = {}) => request(server).put(p).set('x-tenant-subdomain', sub).auth(token, { type: 'bearer' }).send(b),
});
const monday = DateTime.now().setZone(TZ).startOf('week').plus({ weeks: 3 });
const at = (d: number, h: number) => monday.plus({ days: d }).set({ hour: h }).toJSDate();

let t: Awaited<ReturnType<typeof seedTenant>>;
let t2: Awaited<ReturnType<typeof seedTenant>>;
const tok = { sup: '', g0: '', g1: '', g2: '', steward: '', sup2: '' };
const shifts: string[] = [];
let roundId = '';
let items: Array<{ id: string; localStartsAt: string }> = [];

async function setFeatures(features: object) {
  await owner.tenant.update({ where: { id: t.tenant.id }, data: { features } });
  forgetFeatures(t.tenant.id);
}

beforeAll(async () => {
  t = await seedTenant(SUB, 3);
  t2 = await seedTenant(SUB2, 1);
  const aquatics = await owner.department.create({ data: { tenantId: t.tenant.id, name: 'Aquatics', aquatic: true } });
  await owner.position.update({ where: { id: t.position.id }, data: { departmentId: aquatics.id } });
  // g0 most senior, g1 next but without a verified certificate, g2 least senior.
  const dates = ['2010-04-01', '2014-04-01', '2019-04-01'];
  for (const [i, u] of t.users.entries()) await owner.user.update({ where: { id: u.id }, data: { seniorityDate: new Date(`${dates[i]}T00:00:00Z`), seniorityHours: 1000 * (3 - i) } });
  await owner.userCertification.updateMany({ where: { userId: t.users[1]!.id }, data: { verifiedAt: null } });
  const sup = await owner.user.create({ data: { tenantId: t.tenant.id, roles: ['AQUATIC_SUPERVISOR'], employmentStatus: 'FULL_TIME', firstName: 'Sue', lastName: 'Sup', email: `sup@${SUB}.test` } });
  await owner.departmentManager.create({ data: { tenantId: t.tenant.id, departmentId: aquatics.id, userId: sup.id } });
  tok.sup = await signAccessToken({ sub: sup.id, tid: t.tenant.id, roles: ['AQUATIC_SUPERVISOR'], aat: now() });
  const st = await owner.user.create({ data: { tenantId: t.tenant.id, roles: ['UNION_STEWARD'], employmentStatus: 'FULL_TIME', firstName: 'Stu', lastName: 'Steward', email: `steward@${SUB}.test` } });
  tok.steward = await signAccessToken({ sub: st.id, tid: t.tenant.id, roles: ['UNION_STEWARD'], aat: now() });
  for (const [i, k] of (['g0', 'g1', 'g2'] as const).entries()) tok[k] = await signAccessToken({ sub: t.users[i]!.id, tid: t.tenant.id, roles: ['STAFF'], aat: now() });
  const sup2 = await owner.user.create({ data: { tenantId: t2.tenant.id, roles: ['AQUATIC_SUPERVISOR'], employmentStatus: 'FULL_TIME', firstName: 'Two', lastName: 'Sup', email: `sup@${SUB2}.test` } });
  tok.sup2 = await signAccessToken({ sub: sup2.id, tid: t2.tenant.id, roles: ['AQUATIC_SUPERVISOR'], aat: now() });
  // Three open drafts on different days (A Monday, B Tuesday, C Wednesday).
  for (const d of [0, 1, 2]) shifts.push((await owner.shift.create({ data: { tenantId: t.tenant.id, facilityId: t.facility.id, positionId: t.position.id, startsAt: at(d, 9), endsAt: at(d, 15), status: 'DRAFT' } })).id);
});
afterAll(async () => {
  await appDb.$disconnect();
  await owner.$disconnect();
});

const roundBody = () => ({ name: 'Week three', kind: 'SHIFTS', positionIds: [t.position.id], shiftIds: shifts, opensAt: new Date(Date.now() - 60_000).toISOString(), closesAt: new Date(Date.now() + 3_600_000).toISOString(), maxAwardsPerPerson: 1 });

describe('switches: bidding needs seniority', () => {
  it('off by default: routes refuse and the permission is gone', async () => {
    expect((await call(tok.sup).get('/api/bids/rounds')).status).toBe(404);
    expect((await call(tok.g0).get('/api/me')).body.permissions).not.toContain('bidding.bid');
  });
  it('on, but seniority off: still refused', async () => {
    await setFeatures({ shiftBidding: true, seniority: false });
    expect((await call(tok.sup).get('/api/bids/rounds')).status).toBe(404);
    const me = await call(tok.g0).get('/api/me');
    expect(me.body.features.shiftBidding).toBe(false);
    expect(me.body.permissions).not.toContain('bidding.bid');
  });
  it('a department that turned seniority off can’t hold a round', async () => {
    await setFeatures({ shiftBidding: true });
    const tenant = await owner.tenant.findUniqueOrThrow({ where: { id: t.tenant.id } });
    const dept = (await owner.position.findUniqueOrThrow({ where: { id: t.position.id } })).departmentId!;
    await owner.tenant.update({ where: { id: t.tenant.id }, data: { overtimePolicy: { solver: { departments: { [dept]: { useSeniority: false } } } } } });
    const r = await call(tok.sup).post('/api/bids/rounds', roundBody());
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('SENIORITY_OFF');
    await owner.tenant.update({ where: { id: t.tenant.id }, data: { overtimePolicy: tenant.overtimePolicy ?? {} } });
  });
});

describe('a round, start to finish', () => {
  it('a manager opens a round; staff and other cities can’t', async () => {
    expect((await call(tok.g0).post('/api/bids/rounds', roundBody())).status).toBe(403);
    expect((await call(tok.sup).post('/api/bids/rounds', { ...roundBody(), closesAt: at(1, 10).toISOString() })).status).toBe(400);
    const r = await call(tok.sup).post('/api/bids/rounds', roundBody());
    expect(r.status).toBe(201);
    roundId = r.body.id;
    expect((await call(tok.sup2, SUB2).get(`/api/bids/rounds/${roundId}`)).status).toBeGreaterThanOrEqual(403);
    // The same shifts can't go in a second round at once.
    expect((await call(tok.sup).post('/api/bids/rounds', roundBody())).status).toBe(400);
  });

  it('staff see the round, their own place in seniority, and rank until the close', async () => {
    const mine = await call(tok.g2).get('/api/me/bids');
    expect(mine.status).toBe(200);
    const r = mine.body.find((x: { id: string }) => x.id === roundId);
    expect(r.seniority).toMatchObject({ rank: 3, of: 3 });
    expect(JSON.stringify(mine.body)).not.toContain(t.users[0]!.id);
    items = [...r.items].sort((a: { localStartsAt: string }, b: { localStartsAt: string }) => a.localStartsAt.localeCompare(b.localStartsAt));
    const [A, B, C] = items.map((i) => i.id);
    expect((await call(tok.g0).put(`/api/me/bids/${roundId}/choices`, { itemIds: [A, B] })).body).toEqual({ count: 2 });
    await call(tok.g1).put(`/api/me/bids/${roundId}/choices`, { itemIds: [B] });
    await call(tok.g2).put(`/api/me/bids/${roundId}/choices`, { itemIds: [A, B, C] });
    expect((await call(tok.g2).put(`/api/me/bids/${roundId}/choices`, { itemIds: [A, A] })).status).toBe(400);
    expect((await call(tok.g2).get('/api/me/bids')).body[0].myChoices).toEqual([A, B, C]);
  });

  it('stewards don’t see an open round', async () => {
    expect((await call(tok.steward).get('/api/bids/rounds')).body.rounds).toEqual([]);
    expect((await call(tok.steward).get(`/api/bids/rounds/${roundId}`)).status).toBe(404);
  });

  it('at the close, awards go in seniority order with a reason for every choice', async () => {
    await owner.bidRound.update({ where: { id: roundId }, data: { closesAt: new Date(Date.now() - 1000) } });
    expect(await withTenant(t.tenant.id, (tx) => bidRoundTick(tx))).toBeGreaterThan(0);
    const [A, B] = items.map((i) => i.id);
    const d = await call(tok.sup).get(`/api/bids/rounds/${roundId}`);
    expect(d.body.status).toBe('REVIEW');
    expect(d.body.order.map((e: { userId: string }) => e.userId)).toEqual(t.users.map((u) => u.id));
    const award = (item: string | undefined) => d.body.awards.find((x: { itemId: string }) => x.itemId === item)?.userId;
    expect(award(A)).toBe(t.users[0]!.id);
    expect(award(B)).toBe(t.users[2]!.id);
    const g1 = d.body.order.find((e: { userId: string }) => e.userId === t.users[1]!.id);
    expect(g1.outcomes[0]).toMatchObject({ result: 'NOT_ELIGIBLE', code: 'MISSING_CERTIFICATION' });
    const g2 = d.body.order.find((e: { userId: string }) => e.userId === t.users[2]!.id);
    expect(g2.outcomes[0]).toMatchObject({ result: 'TAKEN_BY_SENIOR' });
    // Changing a ranking after the close is refused; staff don't see proposed awards yet.
    expect((await call(tok.g2).put(`/api/me/bids/${roundId}/choices`, { itemIds: [A] })).status).toBe(409);
    expect((await call(tok.g2).get('/api/me/bids')).body[0].result).toBeNull();
    expect(await owner.notification.count({ where: { tenantId: t.tenant.id, type: 'bid_round_review' } })).toBeGreaterThan(0);
  });

  it('stewards read the order and reasons once closed, and can’t change anything', async () => {
    const r = await call(tok.steward).get(`/api/bids/rounds/${roundId}`);
    expect(r.status).toBe(200);
    expect(r.body.access).toBe('observe');
    expect(r.body.order).toHaveLength(3);
    expect(r.body.eligible).toEqual([]);
    expect((await call(tok.steward).post(`/api/bids/rounds/${roundId}/confirm`)).status).toBe(403);
  });

  it('a manager changes an award only with a reason, only to someone who can work it, audited', async () => {
    const [, B] = items.map((i) => i.id);
    expect((await call(tok.sup).put(`/api/bids/rounds/${roundId}/awards/${B}`, { userId: null, reason: 'no' })).status).toBe(400);
    const bad = await call(tok.sup).put(`/api/bids/rounds/${roundId}/awards/${B}`, { userId: t.users[1]!.id, reason: 'Covering a training need' });
    expect(bad.status).toBe(422);
    const ok = await call(tok.sup).put(`/api/bids/rounds/${roundId}/awards/${B}`, { userId: null, reason: 'Held back for a returning guard' });
    expect(ok.status).toBe(200);
    const log = await owner.auditLog.findFirst({ where: { tenantId: t.tenant.id, action: 'bid.award.override' } });
    expect(JSON.stringify(log?.after)).toContain('Held back for a returning guard');
    const d = await call(tok.steward).get(`/api/bids/rounds/${roundId}`);
    expect(d.body.order.find((e: { userId: string }) => e.userId === t.users[2]!.id).outcomes.find((o: { itemId: string }) => o.itemId === B).result).toBe('OVERRIDDEN');
    // And back again.
    await call(tok.sup).put(`/api/bids/rounds/${roundId}/awards/${B}`, { userId: t.users[2]!.id, reason: 'Guard declined; back to the bid' });
  });

  it('confirming schedules the winners, posts the rest on the Shift Board and tells everyone', async () => {
    const r = await call(tok.sup).post(`/api/bids/rounds/${roundId}/confirm`);
    expect(r.body).toEqual({ assigned: 2, posted: 1, dropped: 0 });
    const rows = await owner.shift.findMany({ where: { id: { in: shifts } }, orderBy: { startsAt: 'asc' } });
    expect(rows.map((s) => [s.status, s.userId])).toEqual([['PUBLISHED', t.users[0]!.id], ['PUBLISHED', t.users[2]!.id], ['PUBLISHED', null]]);
    expect(await owner.shiftOffer.count({ where: { shiftId: rows[2]!.id, status: 'OPEN' } })).toBe(1);
    const notes = await owner.notification.findMany({ where: { tenantId: t.tenant.id, type: { in: ['bid_awarded', 'bid_not_awarded'] } }, select: { userId: true, type: true } });
    expect(notes).toEqual(expect.arrayContaining([{ userId: t.users[0]!.id, type: 'bid_awarded' }, { userId: t.users[1]!.id, type: 'bid_not_awarded' }, { userId: t.users[2]!.id, type: 'bid_awarded' }]));
    const mine = (await call(tok.g1).get('/api/me/bids')).body.find((x: { id: string }) => x.id === roundId);
    expect(mine.result.outcomes[0]).toMatchObject({ result: 'NOT_ELIGIBLE', code: 'MISSING_CERTIFICATION' });
    expect((await call(tok.sup).post(`/api/bids/rounds/${roundId}/confirm`)).status).toBe(409);
  });

  it('turning seniority off hides bidding again', async () => {
    await setFeatures({ shiftBidding: true, seniority: false });
    expect((await call(tok.g0).get('/api/me/bids')).status).toBe(404);
    await setFeatures({ shiftBidding: true });
  });

  it('lines from a weekly template: one per seat, the whole season, drafts made first', async () => {
    const tpl = await call(tok.sup).post('/api/schedule/templates', { name: 'Season', slots: [{ daysOfWeek: [1, 2], startMinute: 17 * 60, endMinute: 21 * 60, facilityId: t.facility.id, positionId: t.position.id, headcount: 2 }] });
    expect(tpl.status).toBe(201);
    const from = monday.plus({ weeks: 1 }).toISODate()!;
    const to = monday.plus({ weeks: 3 }).toISODate()!;
    const r = await call(tok.sup).post('/api/bids/rounds', { name: 'Evening lines', kind: 'LINES', positionIds: [t.position.id], templateId: tpl.body.id, from, to, opensAt: new Date(Date.now() - 60_000).toISOString(), closesAt: new Date(Date.now() + 3_600_000).toISOString() });
    expect(r.status).toBe(201);
    const d = await call(tok.sup).get(`/api/bids/rounds/${r.body.id}`);
    expect(d.body.items).toHaveLength(2);
    expect(d.body.items.map((i: { shifts: number }) => i.shifts)).toEqual([4, 4]);
    expect(d.body.items[0].meta).toMatchObject({ daysOfWeek: [1, 2], startMinute: 1020 });
    expect((await call(tok.sup).post(`/api/bids/rounds/${r.body.id}/cancel`)).status).toBe(200);
  });
});
