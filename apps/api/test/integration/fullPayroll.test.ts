import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { signAccessToken } from '../../src/auth/tokens.js';
import { ensureTaxTables } from '../../src/services/payroll/taxTables.js';
import { app as appDb, owner, seedTenant } from './fixtures.js';

process.env.LOCAL_KEK_BASE64 ||= randomBytes(32).toString('base64');
const server = createApp();
const SUB = 'fullpay';
let t: Awaited<ReturnType<typeof seedTenant>>;
const tok = { prep: '', approver: '' };
let manager = '';
const PERIOD = '2026-03-02';
const PAY_DATE = '2026-03-20';
const call = (token: string) => ({
  get: (p: string) => request(server).get(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }),
  post: (p: string, b: object = {}) => request(server).post(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }).send(b),
  del: (p: string) => request(server).delete(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }),
});
type Statement = { userId: string; gross: number; net: number; totalDeductions: number; deductions: { federalTax: number; provincialTax: number; reimbursements?: number; orders?: Array<{ amount: number }>; lumpSum?: number } };

beforeAll(async () => {
  t = await seedTenant(SUB, 2);
  await owner.tenant.update({ where: { id: t.tenant.id }, data: { payWeekStartDay: 1 } });
  const now = Math.floor(Date.now() / 1000);
  const hr = async (name: string) => (await owner.user.create({ data: { tenantId: t.tenant.id, roles: ['HR_ADMIN'], employmentStatus: 'FULL_TIME', firstName: name, lastName: 'HR', email: `${name}@${SUB}.test` } })).id;
  tok.prep = await signAccessToken({ sub: await hr('prep'), tid: t.tenant.id, roles: ['HR_ADMIN'], aat: now, mfa: true });
  tok.approver = await signAccessToken({ sub: await hr('approver'), tid: t.tenant.id, roles: ['HR_ADMIN'], aat: now, mfa: true });
  manager = (await owner.user.create({ data: { tenantId: t.tenant.id, roles: ['AQUATIC_SUPERVISOR'], employmentStatus: 'FULL_TIME', firstName: 'Morgan', lastName: 'Salaried', email: `m@${SUB}.test`, hireDate: new Date('2024-01-01') } })).id;
  for (const u of t.users) {
    await owner.user.update({ where: { id: u.id }, data: { hireDate: new Date('2024-01-01') } });
    await owner.payRate.create({ data: { tenantId: t.tenant.id, userId: u.id, positionId: t.position.id, hourlyRate: 25, effectiveFrom: new Date('2025-01-01') } });
    for (const d of [2, 3, 4, 5, 9, 10, 11, 12]) {
      const start = new Date(Date.UTC(2026, 2, d, 16));
      await owner.timePunch.create({ data: { tenantId: t.tenant.id, userId: u.id, facilityId: t.facility.id, positionId: t.position.id, clockIn: start, clockOut: new Date(start.getTime() + 8 * 3_600_000), status: 'APPROVED' } });
    }
  }
  await ensureTaxTables(owner, 2026);
  await owner.payrollTaxTable.updateMany({ where: { year: 2026 }, data: { verifiedAt: new Date(), verifiedBy: 'test' } });
});
afterAll(async () => {
  await appDb.$disconnect();
  await owner.$disconnect();
});

describe('in-app payroll as a full payroll system', () => {
  let runId = '';
  const statements = async () => (await call(tok.prep).get(`/api/payroll/runs/${runId}`)).body.statements as Statement[];

  it('pays salaried staff an even share of the year, with no hours needed', async () => {
    expect((await call(tok.prep).post(`/api/users/${manager}/salary`, { positionId: t.position.id, annualAmount: 78000, effectiveFrom: '2026-01-01' })).status).toBe(201);
    const run = await call(tok.prep).post('/api/payroll/runs', { departmentId: null, periodStart: PERIOD, weeks: 2, payDate: PAY_DATE });
    expect(run.status).toBe(201);
    runId = run.body.id;
    const m = (await statements()).find((s) => s.userId === manager)!;
    expect(m.gross).toBeCloseTo(3000, 2); // 78,000 / 26
  });

  it('adds a bonus taxed by the bonus method, a reimbursement that isn’t taxed, and a recovery', async () => {
    const g0 = t.users[0]!.id;
    const before = (await statements()).find((s) => s.userId === g0)!;
    expect((await call(tok.prep).post(`/api/payroll/runs/${runId}/adjustments`, { userId: g0, kind: 'BONUS', description: 'Season bonus', amount: 1000 })).status).toBe(201);
    expect((await call(tok.prep).post(`/api/payroll/runs/${runId}/adjustments`, { userId: g0, kind: 'REIMBURSEMENT', description: 'First aid course', amount: 120 })).status).toBe(201);
    expect((await call(tok.prep).post(`/api/payroll/runs/${runId}/adjustments`, { userId: g0, kind: 'RECOVERY', description: 'Uniform not returned', amount: 40 })).status).toBe(201);
    expect((await call(tok.prep).post(`/api/payroll/runs/${runId}/adjustments`, { userId: g0, kind: 'NOPE', description: 'x', amount: 1 })).status).toBe(400);
    const after = (await statements()).find((s) => s.userId === g0)!;
    expect(after.gross).toBeCloseTo(before.gross + 1000, 2);
    expect(after.deductions.reimbursements).toBe(120);
    const taxBefore = before.deductions.federalTax + before.deductions.provincialTax;
    const taxAfter = after.deductions.federalTax + after.deductions.provincialTax;
    const bonusTax = taxAfter - taxBefore;
    // Taxed on the bonus, at a marginal rate: more than nothing, far less than the bonus, and less than
    // taxing it as if every pay were that large would (which annualizes it 26 times).
    expect(bonusTax).toBeGreaterThan(100);
    expect(bonusTax).toBeLessThan(450);
    expect(after.net).toBeCloseTo(after.gross - after.totalDeductions + 120, 2);
  });

  it('takes a court-ordered deduction, capped by its share of net pay and by the total owed', async () => {
    const g1 = t.users[1]!.id;
    expect((await call(tok.prep).post(`/api/users/${g1}/payroll-orders`, { kind: 'SUPPORT_ORDER', payee: 'Family Responsibility Office', reference: 'FRO-123', amountPerPay: 5000, maxPercentOfNet: 50, totalOwed: 600, startsOn: '2026-01-01' })).status).toBe(201);
    expect((await call(tok.prep).post(`/api/users/${g1}/payroll-orders`, { kind: 'GARNISHMENT', payee: 'X', startsOn: '2026-01-01' })).status).toBe(400);
    await call(tok.prep).post(`/api/payroll/runs/${runId}/recalculate`);
    const s = (await statements()).find((x) => x.userId === g1)!;
    const taken = s.deductions.orders![0]!.amount;
    // Wants 5,000; limited to the total owed (600), and never over half of net.
    expect(taken).toBeLessThanOrEqual(600);
    expect(taken).toBeGreaterThan(0);
  });

  it('the journal still balances with reimbursements, recoveries and orders', async () => {
    const ok = await call(tok.approver).post(`/api/payroll/runs/${runId}/approve`);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const j = await call(tok.prep).get(`/api/accounting/journal/${runId}`);
    expect(j.status).toBe(200);
    expect(j.body.balanced).toBe(true);
    expect(j.body.lines.map((l: { key: string }) => l.key)).toEqual(expect.arrayContaining(['reimbursements', 'ordersPayable', 'recoveries']));
  });

  it('an off-cycle run pays only its one-time items, beside the regular run', async () => {
    const off = await call(tok.prep).post('/api/payroll/runs', { departmentId: null, periodStart: PERIOD, weeks: 2, payDate: '2026-03-27', kind: 'OFF_CYCLE', note: 'Retro pay, new collective agreement' });
    expect(off.status).toBe(201);
    expect(off.body).toMatchObject({ kind: 'OFF_CYCLE', note: 'Retro pay, new collective agreement' });
    const r = await call(tok.prep).post(`/api/payroll/runs/${off.body.id}/adjustments`, { userId: t.users[1]!.id, kind: 'RETRO', description: 'Retro to Jan 1', amount: 450 });
    expect(r.status).toBe(201);
    const st = (await call(tok.prep).get(`/api/payroll/runs/${off.body.id}`)).body.statements as Statement[];
    expect(st).toHaveLength(1);
    expect(st[0]).toMatchObject({ userId: t.users[1]!.id, gross: 450 });
    expect(st[0]!.deductions.federalTax).toBeGreaterThan(0);
  });
});
