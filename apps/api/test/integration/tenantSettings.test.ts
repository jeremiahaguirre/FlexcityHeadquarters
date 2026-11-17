/** Organization settings writes keep unknown keys and don't lose concurrent changes (ARCHITECTURE-REVIEW A11). */
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { signAccessToken } from '../../src/auth/tokens.js';
import { db, withTenant } from '../../src/lib/db.js';
import { updateTenantJson } from '../../src/lib/tenantSettings.js';
import { owner, seedTenant } from './fixtures.js';

const server = createApp();
const SUB = `tset${randomBytes(3).toString('hex')}`;
const now = () => Math.floor(Date.now() / 1000);
let t: Awaited<ReturnType<typeof seedTenant>>;
let hr = '';

const put = (p: string, b: object) => request(server).put(p).set('x-tenant-subdomain', SUB).auth(hr, { type: 'bearer' }).send(b);
const policy = async () => (await owner.tenant.findUniqueOrThrow({ where: { id: t.tenant.id }, select: { overtimePolicy: true } })).overtimePolicy as Record<string, any>;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  t = await seedTenant(SUB, 0);
  const u = await owner.user.create({ data: { tenantId: t.tenant.id, roles: ['HR_ADMIN', 'AQUATIC_SUPERVISOR'], employmentStatus: 'FULL_TIME', firstName: 'Hal', lastName: 'HR', email: `hr@${SUB}.test` } });
  // HR configures the organization; the supervisor role adds the templates and bidding permissions.
  hr = await signAccessToken({ sub: u.id, tid: t.tenant.id, roles: ['HR_ADMIN', 'AQUATIC_SUPERVISOR'], aat: now() });
  await owner.tenant.update({ where: { id: t.tenant.id }, data: { features: { shiftBidding: true } } });
});

afterAll(async () => {
  await owner.$disconnect();
  await db().$disconnect();
});

describe('organization settings writes', () => {
  it('two writers at once both keep their change: the second waits for the first and starts from it', async () => {
    await owner.tenant.update({ where: { id: t.tenant.id }, data: { overtimePolicy: { start: true } } });
    // Writer A holds the row while it works (as a schedule fill does); B arrives meanwhile.
    const a = withTenant(t.tenant.id, async (tx) => {
      await updateTenantJson(tx, t.tenant.id, 'overtimePolicy', (cur) => ({ ...cur, fromA: 1 }));
      await sleep(400);
    });
    await sleep(100);
    const b = withTenant(t.tenant.id, (tx) => updateTenantJson(tx, t.tenant.id, 'overtimePolicy', (cur) => ({ ...cur, fromB: 2 })));
    await Promise.all([a, b]);
    expect(await policy()).toEqual({ start: true, fromA: 1, fromB: 2 });
  });

  it('settings screens keep solver keys this version does not know (a newer release rolling out)', async () => {
    await owner.tenant.update({ where: { id: t.tenant.id }, data: { overtimePolicy: { countRefusals: true, solver: { futureKey: 'kept', planAheadWeeks: 4 } } } });
    const r1 = await put('/api/schedule/templates/settings', { autoCreate: true });
    expect(r1.status, JSON.stringify(r1.body)).toBeLessThan(300);
    const r2 = await put('/api/bids/settings', { awardOrder: 'SENIOR_FIRST' });
    expect(r2.status, JSON.stringify(r2.body)).toBeLessThan(300);
    const op = await policy();
    expect(op.countRefusals).toBe(true);
    expect(op.solver).toMatchObject({ futureKey: 'kept', planAheadWeeks: 4, templateAutoCreate: true, bidAwardOrder: 'SENIOR_FIRST' });
  });

  it('the overtime policy screen keeps the solver settings and anything else stored beside it', async () => {
    await owner.tenant.update({ where: { id: t.tenant.id }, data: { overtimePolicy: { other: 1, solver: { futureKey: 'kept' } } } });
    const r = await put('/api/overtime/policy', { countRefusals: false, clause: null, periodStartMonth: 4 });
    expect(r.status, JSON.stringify(r.body)).toBeLessThan(300);
    expect(await policy()).toMatchObject({ other: 1, solver: { futureKey: 'kept' }, countRefusals: false, periodStartMonth: 4 });
  });

  it('settings writers and inserts that point at the organization neither deadlock nor wait on each other', async () => {
    // Each transaction inserts a row with a foreign key to the organization (which takes FOR KEY
    // SHARE on it), then writes a setting. With FOR UPDATE this deadlocked (review of #63).
    let ready = 0;
    const both = new Promise<void>((resolve) => {
      const check = setInterval(() => ready >= 2 && (clearInterval(check), resolve()), 10);
    });
    const writer = (n: number) =>
      withTenant(t.tenant.id, async (tx) => {
        await tx.department.create({ data: { tenantId: t.tenant.id, name: `Dept ${n} ${Date.now()}` } });
        ready++;
        await both;
        await updateTenantJson(tx, t.tenant.id, 'overtimePolicy', (cur) => ({ ...cur, [`w${n}`]: n }));
      });
    await Promise.all([writer(1), writer(2)]);
    expect(await policy()).toMatchObject({ w1: 1, w2: 2 });
  });

  it('refuses a column that is not a settings column', async () => {
    await expect(withTenant(t.tenant.id, (tx) => updateTenantJson(tx, t.tenant.id, 'name' as never, (c) => c))).rejects.toThrow(/Not a Tenant settings column/);
  });
});
