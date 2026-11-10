import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { signAccessToken } from '../../src/auth/tokens.js';
import { STARTING_VALUES, ensureTaxTables } from '../../src/services/payroll/taxTables.js';
import { app as appDb, owner, seedTenant } from './fixtures.js';

process.env.LOCAL_KEK_BASE64 ||= randomBytes(32).toString('base64');

const server = createApp();
const SUB = 'gatineau';
let t: Awaited<ReturnType<typeof seedTenant>>;
const tok = { hr: '', hr2: '' };
const call = (token: string) => ({
  get: (p: string) => request(server).get(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }),
  post: (p: string, b: object = {}) => request(server).post(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }).send(b),
  put: (p: string, b: object = {}) => request(server).put(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }).send(b),
});
let runId = '';
// A Quebec facility; the second guard lives and is employed in Ontario (pay profile).
const quebecer = () => t.users[0]!.id;
const ontarian = () => t.users[1]!.id;

beforeAll(async () => {
  t = await seedTenant(SUB, 2);
  await owner.facility.update({ where: { id: t.facility.id }, data: { province: 'QC', timezone: 'America/Toronto' } });
  await owner.tenant.update({ where: { id: t.tenant.id }, data: { payWeekStartDay: 1 } });
  const now = Math.floor(Date.now() / 1000);
  const mk = async (name: string) => (await owner.user.create({ data: { tenantId: t.tenant.id, roles: ['HR_ADMIN'], employmentStatus: 'FULL_TIME', firstName: name, lastName: 'X', email: `${name}@${SUB}.test` } })).id;
  tok.hr = await signAccessToken({ sub: await mk('hr'), tid: t.tenant.id, roles: ['HR_ADMIN'], aat: now, mfa: true });
  tok.hr2 = await signAccessToken({ sub: await mk('hr2'), tid: t.tenant.id, roles: ['HR_ADMIN'], aat: now, mfa: true });
  await owner.payProfile.create({ data: { tenantId: t.tenant.id, userId: ontarian(), province: 'ON' } });
  for (const u of t.users) {
    await owner.user.update({ where: { id: u.id }, data: { hireDate: new Date('2024-01-01') } });
    await owner.payRate.create({ data: { tenantId: t.tenant.id, userId: u.id, positionId: t.position.id, hourlyRate: 30, effectiveFrom: new Date('2025-01-01') } });
    for (const d of [2, 3, 4, 5, 9, 10, 11, 12]) {
      const start = new Date(Date.UTC(2026, 2, d, 14));
      await owner.timePunch.create({ data: { tenantId: t.tenant.id, userId: u.id, facilityId: t.facility.id, positionId: t.position.id, clockIn: start, clockOut: new Date(start.getTime() + 8 * 3_600_000), status: 'APPROVED' } });
    }
  }
  await ensureTaxTables(owner, 2026);
  // Tax tables are shared by every city (and test file): only the Quebec one is un-checked here.
  await owner.payrollTaxTable.updateMany({ where: { year: 2026, verifiedAt: null }, data: { verifiedAt: new Date(), verifiedBy: 'test' } });
  await owner.payrollTaxTable.updateMany({ where: { year: 2026, jurisdiction: 'QC' }, data: { data: STARTING_VALUES[2026]!.QC as object, verifiedAt: null, verifiedBy: null } });
});
afterAll(async () => {
  await owner.payrollTaxTable.updateMany({ where: { year: 2026, jurisdiction: 'QC' }, data: { verifiedAt: new Date(), verifiedBy: 'test' } });
  await appDb.$disconnect();
  await owner.$disconnect();
});

describe('Quebec payroll', () => {
  it('won’t approve until FH has checked the Quebec table', async () => {
    const run = await call(tok.hr).post('/api/payroll/runs', { departmentId: null, periodStart: '2026-03-02', weeks: 2, payDate: '2026-03-20' });
    expect(run.status).toBe(201);
    runId = run.body.id;
    const detail = (await call(tok.hr).get(`/api/payroll/runs/${runId}`)).body;
    expect(detail.run.blockers.map((b: { code: string }) => b.code)).toContain('QUEBEC_UNVERIFIED');
    expect(detail.run.blockers.map((b: { code: string }) => b.code)).not.toContain('QUEBEC');
  });

  it('takes QPP, QPIP and Quebec tax for Quebec staff, and CPP for the Ontarian, from the same pay', async () => {
    await owner.payrollTaxTable.updateMany({ where: { year: 2026, jurisdiction: 'QC' }, data: { verifiedAt: new Date(), verifiedBy: 'test' } });
    expect((await call(tok.hr).post(`/api/payroll/runs/${runId}/recalculate`)).status).toBeLessThan(300);
    const detail = (await call(tok.hr).get(`/api/payroll/runs/${runId}`)).body;
    expect(detail.run.blockers).toEqual([]);
    const qc = detail.statements.find((s: { userId: string }) => s.userId === quebecer());
    const on = detail.statements.find((s: { userId: string }) => s.userId === ontarian());
    expect(qc.province).toBe('QC');
    expect(on.province).toBe('ON');
    expect(qc.gross).toBe(on.gross);
    expect(qc.deductions.plan).toBe('QPP');
    expect(on.deductions.plan).toBe('CPP');
    // QPP's rate is higher than CPP's; EI is lower in Quebec; only Quebec has QPIP.
    expect(qc.deductions.cpp).toBeGreaterThan(on.deductions.cpp);
    expect(qc.deductions.ei).toBeLessThan(on.deductions.ei);
    expect(qc.deductions.qpip).toBeCloseTo(qc.gross * 0.0043, 2);
    expect(qc.deductions.employerQpip).toBeCloseTo(qc.gross * 0.00602, 2);
    expect(on.deductions.qpip).toBeUndefined();
    // Federal tax is abated in Quebec; Quebec tax is the larger share.
    expect(qc.deductions.federalTax).toBeLessThan(on.deductions.federalTax);
    expect(qc.deductions.provincialTax).toBeGreaterThan(qc.deductions.federalTax);
    expect(qc.net).toBeCloseTo(qc.gross - qc.totalDeductions, 2);
    expect((await call(tok.hr2).post(`/api/payroll/runs/${runId}/approve`)).status).toBe(200);
  });

  it('sends QPP, QPIP and Quebec tax to Revenu Québec, and EI and federal tax to CRA', async () => {
    const r = (await call(tok.hr).get('/api/payroll/remittance?month=2026-03')).body;
    const detail = (await call(tok.hr).get(`/api/payroll/runs/${runId}`)).body;
    const qc = detail.statements.find((s: { userId: string }) => s.userId === quebecer());
    const on = detail.statements.find((s: { userId: string }) => s.userId === ontarian());
    expect(r.revenuQuebec.qppEmployee).toBeCloseTo(qc.deductions.cpp + qc.deductions.cpp2, 2);
    expect(r.revenuQuebec.qpipEmployer).toBeCloseTo(qc.deductions.employerQpip, 2);
    expect(r.revenuQuebec.quebecTax).toBeCloseTo(qc.deductions.provincialTax, 2);
    // Employer-only Health Services Fund: a city is a public body, so the top rate.
    expect(r.revenuQuebec.hsf).toMatchObject({ sector: 'public', rate: 0.0426 });
    expect(r.revenuQuebec.hsf.amount).toBeCloseTo(qc.gross * 0.0426, 2);
    expect(r.cppEmployee).toBeCloseTo(on.deductions.cpp + on.deductions.cpp2, 2);
    expect(r.incomeTax).toBeCloseTo(qc.deductions.federalTax + on.deductions.federalTax + on.deductions.provincialTax, 2);
    expect(r.eiEmployee).toBeCloseTo(qc.deductions.ei + on.deductions.ei, 2);

    const j = (await call(tok.hr).get(`/api/accounting/journal/${runId}`)).body;
    expect(j.balanced).toBe(true);
    const credit = (key: string) => j.lines.filter((l: { key: string }) => l.key === key).reduce((a: number, l: { credit: number }) => a + l.credit, 0);
    expect(credit('quebecPayable')).toBeCloseTo(r.revenuQuebec.total, 2);
    expect(j.lines.some((l: { key: string }) => l.key === 'employerQpip')).toBe(true);
  });

  it('puts Quebec staff on an RL-1 and in the QPP boxes of their T4', async () => {
    expect((await call(tok.hr).put('/api/payroll/settings', { quebecNumber: '12345' })).status).toBe(400);
    expect((await call(tok.hr).put('/api/payroll/settings', { quebecNumber: '1234567890RS0001' })).status).toBe(200);
    const rl1 = (await call(tok.hr).get('/api/payroll/rl1?year=2026')).body;
    expect(rl1.employer.quebecNumber).toBe('1234567890RS0001');
    expect(rl1.slips).toHaveLength(1);
    const s = rl1.slips[0];
    expect(s.userId).toBe(quebecer());
    expect(s.boxH).toBeGreaterThan(0);
    expect(s.boxI).toBe(s.boxA);
    expect(s.boxBA).toBeGreaterThan(0);
    expect(rl1.summary.contributions).toMatchObject({ sector: 'public', hsfRate: 0.0426, wsdrfBeforeTraining: 0 });
    expect(rl1.summary.contributions.cnt).toBeCloseTo(s.boxA * 0.0006, 2);
    // A private employer with a small payroll pays the lowest rate.
    expect((await call(tok.hr).put('/api/payroll/settings', { quebecSector: 'private' })).status).toBe(200);
    expect((await call(tok.hr).get('/api/payroll/rl1?year=2026')).body.summary.contributions.hsfRate).toBe(0.0165);

    const t4 = (await call(tok.hr).get('/api/payroll/t4?year=2026')).body;
    const q = t4.slips.find((x: { userId: string }) => x.userId === quebecer());
    const o = t4.slips.find((x: { userId: string }) => x.userId === ontarian());
    expect(q.box16Cpp).toBe(0);
    expect(q.box17Qpp).toBe(s.boxBA);
    expect(q.box55Ppip).toBe(s.boxH);
    expect(o.box17Qpp).toBe(0);
    // Box 22 on a Quebec T4 is federal tax only.
    expect(q.box22IncomeTax + s.boxE).toBeGreaterThan(q.box22IncomeTax);
  });
});
