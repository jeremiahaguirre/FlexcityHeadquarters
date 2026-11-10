import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { signAccessToken } from '../../src/auth/tokens.js';
import { ensureTaxTables } from '../../src/services/payroll/taxTables.js';
import { app as appDb, owner, seedTenant } from './fixtures.js';

process.env.LOCAL_KEK_BASE64 ||= randomBytes(32).toString('base64');

const server = createApp();
const SUB = 'bencity';
let t: Awaited<ReturnType<typeof seedTenant>>;
const tok = { hr: '', hr2: '', sup: '' };
const call = (token: string) => ({
  get: (p: string) => request(server).get(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }),
  post: (p: string, b: object = {}) => request(server).post(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }).send(b),
});

beforeAll(async () => {
  t = await seedTenant(SUB, 2);
  await owner.tenant.update({ where: { id: t.tenant.id }, data: { payWeekStartDay: 1 } });
  const now = Math.floor(Date.now() / 1000);
  const mk = async (roles: Array<'HR_ADMIN' | 'AQUATIC_SUPERVISOR'>, name: string) => (await owner.user.create({ data: { tenantId: t.tenant.id, roles, employmentStatus: 'FULL_TIME', firstName: name, lastName: 'X', email: `${name}@${SUB}.test` } })).id;
  tok.hr = await signAccessToken({ sub: await mk(['HR_ADMIN'], 'hr'), tid: t.tenant.id, roles: ['HR_ADMIN'], aat: now, mfa: true });
  tok.hr2 = await signAccessToken({ sub: await mk(['HR_ADMIN'], 'hr2'), tid: t.tenant.id, roles: ['HR_ADMIN'], aat: now, mfa: true });
  tok.sup = await signAccessToken({ sub: await mk(['AQUATIC_SUPERVISOR'], 'sup'), tid: t.tenant.id, roles: ['AQUATIC_SUPERVISOR'], aat: now });
  for (const u of t.users) {
    await owner.user.update({ where: { id: u.id }, data: { hireDate: new Date('2024-01-01') } });
    await owner.payRate.create({ data: { tenantId: t.tenant.id, userId: u.id, positionId: t.position.id, hourlyRate: 30, effectiveFrom: new Date('2025-01-01') } });
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

describe('benefits and deductions', () => {
  const plans: Record<string, string> = {};

  it('is for HR: a supervisor can’t manage benefits', async () => {
    expect((await call(tok.sup).get('/api/benefits')).status).toBe(403);
  });

  it('HR sets up plans and enrolls people', async () => {
    for (const [key, body] of Object.entries({
      pension: { name: 'MEPP pension', kind: 'PENSION', employeePercent: 9, employerPercent: 9 },
      dues: { name: 'CUPE dues', kind: 'UNION_DUES', employeeAmount: 20 },
      dental: { name: 'Dental', kind: 'DENTAL', employeeAmount: 15, employerAmount: 25 },
      life: { name: 'Group life', kind: 'LIFE', employerAmount: 8, employerTaxable: true },
    })) {
      const r = await call(tok.hr).post('/api/benefits/plans', body);
      expect(r.status).toBe(201);
      plans[key] = r.body.id;
    }
    for (const planId of Object.values(plans)) expect((await call(tok.hr).post('/api/benefits/enrollments', { planId, userId: t.users[0]!.id, startsOn: '2026-01-01' })).status).toBe(201);
    expect((await call(tok.hr).post('/api/benefits/enrollments', { planId: plans.dental, userId: t.users[0]!.id, startsOn: '2026-02-01' })).body.code).toBe('ALREADY_ENROLLED');
  });

  it('takes the right deductions with the right tax treatment', async () => {
    const run = await call(tok.hr).post('/api/payroll/runs', { departmentId: null, periodStart: '2026-03-02', weeks: 2, payDate: '2026-03-20' });
    expect(run.status).toBe(201);
    const detail = (await call(tok.hr).get(`/api/payroll/runs/${run.body.id}`)).body;
    const withPlans = detail.statements.find((s: { userId: string }) => s.userId === t.users[0]!.id);
    const without = detail.statements.find((s: { userId: string }) => s.userId === t.users[1]!.id);
    expect(withPlans.gross).toBe(without.gross);
    const d = withPlans.deductions;
    expect(d.rpp).toBeCloseTo(withPlans.gross * 0.09, 2);
    expect(d.unionDues).toBe(20);
    expect(d.afterTax).toBe(15);
    expect(d.taxableBenefit).toBe(8);
    expect(d.employerBenefits).toBeCloseTo(withPlans.gross * 0.09 + 25 + 8, 2);
    // Pension and dues lower the tax; CPP is a little higher (the taxable life benefit), EI the same.
    expect(d.federalTax).toBeLessThan(without.deductions.federalTax);
    expect(d.cpp).toBeGreaterThan(without.deductions.cpp);
    expect(d.ei).toBe(without.deductions.ei);
    expect(withPlans.net).toBeCloseTo(withPlans.gross - (d.total + d.rpp + d.unionDues + d.afterTax), 2);
    expect(withPlans.totalDeductions).toBeCloseTo(d.total + d.rpp + d.unionDues + d.afterTax, 2);
    expect((await call(tok.hr2).post(`/api/payroll/runs/${run.body.id}/approve`)).status).toBe(200);
  });

  it('puts pension, dues and taxable benefits on the T4, and totals what each provider is owed', async () => {
    const t4 = (await call(tok.hr).get('/api/payroll/t4?year=2026')).body;
    const slip = t4.slips.find((s: { userId: string }) => s.userId === t.users[0]!.id);
    expect(slip.box20Rpp).toBeGreaterThan(0);
    expect(slip.box44UnionDues).toBe(20);
    expect(slip.box40TaxableBenefits).toBe(8);
    const other = t4.slips.find((s: { userId: string }) => s.userId === t.users[1]!.id);
    expect(slip.box14EmploymentIncome).toBeCloseTo(other.box14EmploymentIncome + 8, 2);
    const rem = (await call(tok.hr).get('/api/payroll/remittance?month=2026-03')).body;
    const dental = rem.benefitsByPlan.find((p: { name: string }) => p.name === 'Dental');
    expect(dental).toMatchObject({ employee: 15, employer: 25 });
  });
});
