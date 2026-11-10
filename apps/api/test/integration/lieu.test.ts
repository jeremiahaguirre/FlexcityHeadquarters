import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { signAccessToken } from '../../src/auth/tokens.js';
import { bankOvertime } from '../../src/services/payroll/lieu.js';
import { ensureTaxTables } from '../../src/services/payroll/taxTables.js';
import { app as appDb, owner, seedTenant } from './fixtures.js';

process.env.LOCAL_KEK_BASE64 ||= randomBytes(32).toString('base64');
const server = createApp();
const SUB = 'lieu';
let t: Awaited<ReturnType<typeof seedTenant>>;
const tok = { prep: '', approver: '', guard: '', sup: '' };
let guard = '';
const call = (token: string) => ({
  get: (p: string) => request(server).get(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }),
  post: (p: string, b: object = {}) => request(server).post(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }).send(b),
  put: (p: string, b: object) => request(server).put(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }).send(b),
});
type Line = { code: string; hours: number; amount: number };
type Statement = { userId: string; gross: number; earnings: Line[]; deductions: { lieu?: { banked: number; otHours: number; taken: number; paidOut: number } } };

async function runFor(periodStart: string, payDate: string) {
  const r = await call(tok.prep).post('/api/payroll/runs', { departmentId: null, periodStart, weeks: 2, payDate });
  expect(r.status).toBe(201);
  const detail = (await call(tok.prep).get(`/api/payroll/runs/${r.body.id}`)).body as { run: { warnings: Array<{ code: string }>; blockers: Array<{ code: string }> } };
  const st = await owner.payStatement.findFirst({ where: { payRunId: r.body.id, userId: guard } });
  const mine = st ? ({ userId: st.userId, gross: Number(st.gross), earnings: st.earnings, deductions: st.deductions } as unknown as Statement) : undefined;
  return { id: r.body.id as string, mine, warnings: detail.run.warnings, blockers: detail.run.blockers };
}
const approve = async (id: string) => expect((await call(tok.approver).post(`/api/payroll/runs/${id}/approve`)).status).toBe(200);

beforeAll(async () => {
  t = await seedTenant(SUB, 1);
  guard = t.users[0]!.id;
  await owner.tenant.update({ where: { id: t.tenant.id }, data: { payWeekStartDay: 1 } });
  const now = Math.floor(Date.now() / 1000);
  const mk = async (name: string, roles: ('HR_ADMIN' | 'AQUATIC_SUPERVISOR')[]) => (await owner.user.create({ data: { tenantId: t.tenant.id, roles, employmentStatus: 'FULL_TIME', firstName: name, lastName: 'X', email: `${name}@${SUB}.test` } })).id;
  tok.prep = await signAccessToken({ sub: await mk('prep', ['HR_ADMIN']), tid: t.tenant.id, roles: ['HR_ADMIN'], aat: now, mfa: true });
  tok.approver = await signAccessToken({ sub: await mk('approver', ['HR_ADMIN']), tid: t.tenant.id, roles: ['HR_ADMIN'], aat: now, mfa: true });
  tok.sup = await signAccessToken({ sub: await mk('sup', ['AQUATIC_SUPERVISOR']), tid: t.tenant.id, roles: ['AQUATIC_SUPERVISOR'], aat: now });
  tok.guard = await signAccessToken({ sub: guard, tid: t.tenant.id, roles: ['STAFF'], aat: now });
  await owner.user.update({ where: { id: guard }, data: { hireDate: new Date('2024-01-01') } });
  await owner.payRate.create({ data: { tenantId: t.tenant.id, userId: guard, positionId: t.position.id, hourlyRate: 25, effectiveFrom: new Date('2025-01-01') } });
  // First week: five 10-hour days, so 2 hours a day over 8 (BC daily overtime at time and a half): 10 overtime hours.
  for (const d of [2, 3, 4, 5, 6]) {
    const start = new Date(Date.UTC(2026, 2, d, 16));
    await owner.timePunch.create({ data: { tenantId: t.tenant.id, userId: guard, facilityId: t.facility.id, positionId: t.position.id, clockIn: start, clockOut: new Date(start.getTime() + 10 * 3_600_000), status: 'APPROVED' } });
  }
  await ensureTaxTables(owner, 2026);
  await owner.payrollTaxTable.updateMany({ where: { year: 2026 }, data: { verifiedAt: new Date(), verifiedBy: 'test' } });
});
afterAll(async () => {
  await appDb.$disconnect();
  await owner.$disconnect();
});

describe('time in lieu', () => {
  it('banks whole overtime lines up to the room left, splitting the one that passes it', () => {
    const lines = [
      { code: 'REGULAR', hours: 40, rate: 25, amount: 1000 },
      { code: 'OVERTIME_1_5', hours: 10, rate: 37.5, amount: 375 },
    ];
    const b = bankOvertime(lines, 12);
    expect(b.banked).toBe(12);
    expect(b.otHours).toBe(8);
    expect(b.lines.find((l) => l.code === 'OVERTIME_1_5')).toEqual({ code: 'OVERTIME_1_5', hours: 2, rate: 37.5, amount: 75 });
    expect(bankOvertime(lines, 0).lines).toEqual(lines);
  });

  it('is off until the city turns it on; then a person can agree to bank overtime', async () => {
    expect((await call(tok.guard).put('/api/me/lieu', { bank: true })).body.code).toBe('LIEU_OFF');
    expect((await call(tok.prep).put('/api/payroll/settings', { lieu: { enabled: true, capHours: 12, takeWithinMonths: 3 } })).status).toBe(200);
    expect((await call(tok.guard).put('/api/me/lieu', { bank: true })).status).toBe(200);
    expect(await owner.auditLog.count({ where: { action: 'lieu.agreed', entityId: guard } })).toBe(1);
  });

  it('a pay run banks overtime at time and a half up to the cap and pays the rest', async () => {
    const r = await runFor('2026-03-02', '2026-03-20');
    expect(r.mine!.deductions.lieu).toEqual({ banked: 12, otHours: 8, taken: 0, paidOut: 0 });
    expect(r.mine!.earnings.find((l) => l.code === 'OVERTIME_1_5')).toMatchObject({ hours: 2 });
    // Not banked until the run is approved.
    expect((await call(tok.guard).get('/api/me/lieu')).body.balance).toBe(0);
    await approve(r.id);
    const me = (await call(tok.guard).get('/api/me/lieu')).body;
    expect(me.balance).toBe(12);
    expect(me.history[0]).toMatchObject({ kind: 'BANKED', hours: 12 });
  });

  it('days off come out of the bank, and can’t take more than is in it', async () => {
    const two = await call(tok.guard).post('/api/me/time-off', { type: 'LIEU', startsAt: '2026-03-16T07:00:00Z', endsAt: '2026-03-18T07:00:00Z' });
    expect(two.body.code).toBe('LIEU_SHORT');
    const one = await call(tok.guard).post('/api/me/time-off', { type: 'LIEU', startsAt: '2026-03-17T07:00:00Z', endsAt: '2026-03-18T07:00:00Z' });
    expect(one.status).toBe(201);
    expect((await call(tok.sup).post(`/api/time-off/${one.body.request.id}/decision`, { decision: 'APPROVE' })).status).toBe(200);
    const r = await runFor('2026-03-16', '2026-04-03');
    expect(r.mine!.earnings.find((l) => l.code === 'LIEU_TAKEN')).toMatchObject({ hours: 8, amount: 200 });
    expect(r.mine!.deductions.lieu).toMatchObject({ taken: 8 });
    await approve(r.id);
    expect((await call(tok.guard).get('/api/me/lieu')).body.balance).toBe(4);
  });

  it('pays out banked time at the regular rate, never more than the balance', async () => {
    const r = await runFor('2026-03-30', '2026-04-17');
    expect((await call(tok.prep).post(`/api/payroll/runs/${r.id}/adjustments`, { userId: guard, kind: 'LIEU_PAYOUT', description: 'Banked time', hours: 5 })).body.code).toBe('LIEU_SHORT');
    expect((await call(tok.prep).post(`/api/payroll/runs/${r.id}/adjustments`, { userId: guard, kind: 'LIEU_PAYOUT', description: 'Banked time', hours: 4 })).status).toBe(201);
    const adj = (await call(tok.prep).get(`/api/payroll/runs/${r.id}/adjustments`)).body;
    expect(adj[0]).toMatchObject({ kind: 'LIEU_PAYOUT', hours: 4, amount: 100 });
    const st = (await owner.payStatement.findFirstOrThrow({ where: { payRunId: r.id, userId: guard } })) as unknown as Statement;
    expect(st.deductions.lieu).toMatchObject({ paidOut: 4 });
    await approve(r.id);
    expect((await call(tok.guard).get('/api/me/lieu')).body.balance).toBe(0);
  });

  it('HR corrects a balance with a reason, and old banked time is flagged on the next run', async () => {
    expect((await call(tok.prep).post(`/api/users/${guard}/lieu/adjust`, { hours: -1, note: 'Oops' })).body.code).toBe('LIEU_SHORT');
    expect((await call(tok.guard).post(`/api/users/${guard}/lieu/adjust`, { hours: 5, note: 'Opening balance' })).status).toBe(403);
    expect((await call(tok.prep).post(`/api/users/${guard}/lieu/adjust`, { hours: 6, note: 'Opening balance from the old system' })).status).toBe(201);
    await owner.lieuAdjustment.updateMany({ where: { userId: guard }, data: { createdAt: new Date('2025-06-01') } });
    expect((await call(tok.prep).get('/api/lieu')).body.people).toEqual([expect.objectContaining({ userId: guard, balance: 6, expiring: 6 })]);
    const start = new Date(Date.UTC(2026, 6, 7, 16));
    await owner.timePunch.create({ data: { tenantId: t.tenant.id, userId: guard, facilityId: t.facility.id, positionId: t.position.id, clockIn: start, clockOut: new Date(start.getTime() + 6 * 3_600_000), status: 'APPROVED' } });
    // Used first-in, first-out: what's left was banked on March 20, over 3 months before this pay date.
    const r = await runFor('2026-07-06', '2026-07-24');
    expect(r.warnings.some((w) => w.code === 'LIEU_EXPIRED')).toBe(true);
  });
});
