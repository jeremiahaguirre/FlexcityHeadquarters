/**
 * The changes the messaging and survey load run led to (test/load/comms.ts, docs/SCALABILITY.md):
 * notifications written in batches with one live signal each; a read receipt tells the other
 * members 'receipts', not 'messages'; a survey answer's group worked out from the people who could
 * share it, still counting only those who were asked; the per-person send limits checked before
 * the send's transaction (not inside it, where the shared limiter needed a second connection).
 */
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

process.env.LOCAL_KEK_BASE64 ||= randomBytes(32).toString('base64');

import { createApp } from '../../src/app.js';
import { signAccessToken } from '../../src/auth/tokens.js';
import { databaseAllow } from '../../src/auth/rateLimit.js';
import { config } from '../../src/config.js';
import { CHANGE_CHANNEL } from '../../src/lib/changes.js';
import { db, withTenant } from '../../src/lib/db.js';
import { NOTIFY_CHANNEL, notify } from '../../src/services/notifications/notifier.js';
import { app as appDb, owner, seedTenant } from './fixtures.js';

const server = createApp();
const SUB = 'scale';
let t: Awaited<ReturnType<typeof seedTenant>>;
const tok: Record<string, string> = {};
const id: Record<string, string> = {};
const as = (who: string) => ({
  get: (p: string) => request(server).get(p).set('x-tenant-subdomain', SUB).auth(tok[who]!, { type: 'bearer' }),
  post: (p: string, b: object = {}) => request(server).post(p).set('x-tenant-subdomain', SUB).auth(tok[who]!, { type: 'bearer' }).send(b),
});
let listener: pg.Client;
const heard: Array<{ channel: string; payload: string }> = [];
const settle = () => new Promise((r) => setTimeout(r, 300));

beforeAll(async () => {
  t = await seedTenant(SUB, 0);
  const now = Math.floor(Date.now() / 1000);
  const mk = async (name: string, roles: string[], positionId: string | null) => {
    const u = await owner.user.create({ data: { tenantId: t.tenant.id, roles: roles as never, employmentStatus: 'PART_TIME', firstName: name, lastName: 'Test', email: `${name}@${SUB}.test`, dateOfBirth: new Date('1990-01-01') } });
    if (positionId) await owner.userPosition.create({ data: { tenantId: t.tenant.id, userId: u.id, positionId } });
    id[name] = u.id;
    tok[name] = await signAccessToken({ sub: u.id, tid: t.tenant.id, roles: roles as never, aat: now });
  };
  const big = await owner.department.create({ data: { tenantId: t.tenant.id, name: 'Big' } });
  const small = await owner.department.create({ data: { tenantId: t.tenant.id, name: 'Small' } });
  id.big = big.id;
  id.small = small.id;
  await owner.position.update({ where: { id: t.position.id }, data: { departmentId: big.id } });
  const smallPos = await owner.position.create({ data: { tenantId: t.tenant.id, name: 'Small team', departmentId: small.id } });
  id.smallPos = smallPos.id;
  for (let i = 0; i < 6; i++) await mk(`b${i}`, ['STAFF'], t.position.id);
  for (let i = 0; i < 5; i++) await mk(`s${i}`, ['STAFF'], smallPos.id);
  await mk('hr', ['HR_ADMIN'], null);
  listener = new pg.Client({ connectionString: process.env.APP_DATABASE_URL });
  await listener.connect();
  listener.on('notification', (n) => heard.push({ channel: n.channel, payload: n.payload ?? '' }));
  await listener.query(`LISTEN ${NOTIFY_CHANNEL}`);
  await listener.query(`LISTEN ${CHANGE_CHANNEL}`);
});
afterAll(async () => {
  // The emails queued above aren't for another test's outbox delivery to pick up.
  await owner.emailOutbox.deleteMany({ where: { tenantId: t.tenant.id } });
  await listener.end();
  await appDb.$disconnect();
  await owner.$disconnect();
});

describe('notifications in batches', () => {
  it('more than one batch: every notification is stored once, with one live signal naming it, and emails queued', async () => {
    const people = Array.from({ length: 1205 }, (_, i) => ({ tenantId: t.tenant.id, roles: ['STAFF' as const], employmentStatus: 'PART_TIME' as const, firstName: `N${i}`, lastName: 'Batch', email: `n${i}@${SUB}.test` }));
    await owner.user.createMany({ data: people });
    const ids = (await owner.user.findMany({ where: { tenantId: t.tenant.id, lastName: 'Batch' }, select: { id: true } })).map((u) => u.id);
    heard.length = 0;
    const n = await withTenant(t.tenant.id, (tx) => notify(tx, t.tenant.id, ids.map((userId, i) => ({ userId, type: 'survey_open', params: { title: 'Pulse', surveyId: 'x' }, link: '/surveys', ...(i < 3 ? { email: 'pay_statement_ready' } : {}) }))));
    expect(n).toBe(1205);
    await settle();
    const stored = await owner.notification.findMany({ where: { userId: { in: ids } }, select: { id: true, userId: true } });
    expect(stored).toHaveLength(1205);
    const signals = heard.filter((h) => h.channel === NOTIFY_CHANNEL).map((h) => JSON.parse(h.payload) as { tenantId: string; userId: string; id: string });
    expect(signals).toHaveLength(1205);
    const byId = new Map(stored.map((s) => [s.id, s.userId]));
    expect(signals.every((s) => s.tenantId === t.tenant.id && byId.get(s.id) === s.userId)).toBe(true);
    expect(await owner.emailOutbox.count({ where: { tenantId: t.tenant.id, template: 'pay_statement_ready' } })).toBe(3);
  });

  it('nothing is signalled when the transaction rolls back', async () => {
    heard.length = 0;
    await expect(withTenant(t.tenant.id, async (tx) => {
      await notify(tx, t.tenant.id, [{ userId: id.b0!, type: 'survey_open', params: { title: 'Gone', surveyId: 'y' } }]);
      throw new Error('rolled back');
    })).rejects.toThrow('rolled back');
    await settle();
    expect(heard.filter((h) => h.channel === NOTIFY_CHANNEL)).toHaveLength(0);
    expect(await owner.notification.count({ where: { userId: id.b0!, params: { path: ['title'], equals: 'Gone' } } })).toBe(0);
  });
});

describe('read receipts', () => {
  it('the reader is told "messages"; the other members only "receipts"', async () => {
    const c = await as('b0').post('/api/messages/department', { departmentId: id.big });
    expect(c.status).toBe(201);
    expect((await as('b1').post(`/api/messages/conversations/${c.body.id}/messages`, { text: 'Lane 3 is closed' })).status).toBe(201);
    await settle();
    heard.length = 0;
    expect((await as('b0').post(`/api/messages/conversations/${c.body.id}/read`)).status).toBe(200);
    await settle();
    const changes = heard.filter((h) => h.channel === CHANGE_CHANNEL).map((h) => JSON.parse(h.payload) as { tenantId: string; topic: string; userIds: string[] });
    const told = (topic: string) => changes.filter((x) => x.topic === topic).flatMap((x) => x.userIds).sort();
    expect(told('messages')).toEqual([id.b0]);
    expect(told('receipts')).toEqual(['b1', 'b2', 'b3', 'b4', 'b5'].map((k) => id[k]!).sort());
  });
});

describe('survey answers keep their group only when enough of it was asked', () => {
  it('a department of five with one person added after sending: its answers keep no department; the big one keeps its own', async () => {
    const q = [{ id: 'mood', type: 'RATING', text: 'How was your week?' }];
    const s = await as('hr').post('/api/surveys', { kind: 'PULSE', title: 'Check-in', questions: q, closesAt: new Date(Date.now() + 7 * 86_400_000).toISOString(), breakdown: 'DEPARTMENT', audience: { departmentIds: [id.big, id.small], positionIds: [] } });
    expect(s.status).toBe(201);
    // s4 leaves the small team before it's sent, so only four of it are asked; then comes back.
    await owner.userPosition.deleteMany({ where: { userId: id.s4!, positionId: id.smallPos! } });
    expect((await as('hr').post(`/api/surveys/${s.body.id}/publish`)).status).toBe(200);
    await owner.userPosition.create({ data: { tenantId: t.tenant.id, userId: id.s4!, positionId: id.smallPos! } });
    for (const who of ['b0', 'b1', 's0', 's1']) expect((await as(who).post(`/api/me/surveys/${s.body.id}/answers`, { answers: { mood: 4 } })).status).toBe(201);
    const stored = await owner.surveyResponse.findMany({ where: { surveyId: s.body.id }, select: { departmentId: true } });
    expect(stored.map((r) => r.departmentId).sort()).toEqual([id.big, id.big, null, null].sort());
  });
});

describe('send limits with the shared (database) limiter', () => {
  it('30 a minute per person still holds when checked before the transaction', async () => {
    const before = process.env.RATE_LIMIT_STORE;
    process.env.RATE_LIMIT_STORE = 'database';
    try {
      await owner.rateLimitHit.deleteMany({ where: { key: { startsWith: `msg-send:${id.b2}` } } });
      const c = await as('b2').post('/api/messages/department', { departmentId: id.big });
      const statuses: number[] = [];
      for (let i = 0; i < 31; i++) statuses.push((await as('b2').post(`/api/messages/conversations/${c.body.id}/messages`, { text: `m${i}` })).status);
      expect(statuses.slice(0, 30).every((x) => x === 201)).toBe(true);
      expect(statuses[30]).toBe(429);
      expect(await owner.rateLimitHit.count({ where: { key: `msg-send:${id.b2}` } })).toBe(30);
    } finally {
      if (before === undefined) delete process.env.RATE_LIMIT_STORE;
      else process.env.RATE_LIMIT_STORE = before;
    }
  });
});

describe('the shared limiter waits for a connection like a request', () => {
  it('its transaction asks for DB_POOL_TIMEOUT_S, not Prisma’s 2 s', async () => {
    // Prisma 7's client defines $transaction in a way vi.spyOn can't wrap (the spy returns
    // undefined), so the call is observed by hand and the original put back.
    const client = db();
    const own = Object.getOwnPropertyDescriptor(client, '$transaction');
    const original = client.$transaction.bind(client) as (...args: unknown[]) => unknown;
    const calls: unknown[][] = [];
    Object.defineProperty(client, '$transaction', { configurable: true, writable: true, value: (...args: unknown[]) => (calls.push(args), original(...args)) });
    try {
      expect(await databaseAllow(`scale-wait:${Date.now()}`, 5, 60_000)).toBe(true);
      expect(calls[0]?.[1]).toMatchObject({ maxWait: config().DB_POOL_TIMEOUT_S * 1000 });
    } finally {
      if (own) Object.defineProperty(client, '$transaction', own);
      else delete (client as unknown as Record<string, unknown>).$transaction;
    }
  });
});
