import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { signAccessToken } from '../../src/auth/tokens.js';
import { ensureTaxTables } from '../../src/services/payroll/taxTables.js';
import { app as appDb, owner, seedTenant } from './fixtures.js';

// Banking and SINs are sealed: a throwaway key for the test run.
process.env.LOCAL_KEK_BASE64 ||= randomBytes(32).toString('base64');

const server = createApp();
const SUB = 'paycity';
let t: Awaited<ReturnType<typeof seedTenant>>;
const tok = { prep: '', approver: '', approverNoKey: '', g0: '', g1: '', sup: '' };
const ids = { prep: '', approver: '' };
const PERIOD = '2026-03-02'; // a Monday, two weeks
const PAY_DATE = '2026-03-20';
const call = (token: string) => ({
  get: (p: string) => request(server).get(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }),
  post: (p: string, b: object = {}) => request(server).post(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }).send(b),
  put: (p: string, b: object = {}) => request(server).put(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }).send(b),
});
const now = () => Math.floor(Date.now() / 1000);

beforeAll(async () => {
  t = await seedTenant(SUB, 3);
  await owner.tenant.update({ where: { id: t.tenant.id }, data: { payWeekStartDay: 1 } });
  const hr = async (name: string) => (await owner.user.create({ data: { tenantId: t.tenant.id, roles: ['HR_ADMIN'], employmentStatus: 'FULL_TIME', firstName: name, lastName: 'HR', email: `${name}@paycity.test` } })).id;
  ids.prep = await hr('prep');
  ids.approver = await hr('approver');
  const sup = (await owner.user.create({ data: { tenantId: t.tenant.id, roles: ['AQUATIC_SUPERVISOR'], employmentStatus: 'FULL_TIME', firstName: 'Sup', lastName: 'X', email: 'sup@paycity.test' } })).id;
  tok.prep = await signAccessToken({ sub: ids.prep, tid: t.tenant.id, roles: ['HR_ADMIN'], aat: now(), mfa: true });
  tok.approver = await signAccessToken({ sub: ids.approver, tid: t.tenant.id, roles: ['HR_ADMIN'], aat: now(), mfa: true });
  tok.approverNoKey = await signAccessToken({ sub: ids.approver, tid: t.tenant.id, roles: ['HR_ADMIN'], aat: now() });
  tok.g0 = await signAccessToken({ sub: t.users[0]!.id, tid: t.tenant.id, roles: ['STAFF'], aat: now() });
  tok.g1 = await signAccessToken({ sub: t.users[1]!.id, tid: t.tenant.id, roles: ['STAFF'], aat: now() });
  tok.sup = await signAccessToken({ sub: sup, tid: t.tenant.id, roles: ['AQUATIC_SUPERVISOR'], aat: now() });
  // Pay rates and two weeks of approved hours: 8 h a day, Monday to Thursday, for two guards.
  for (const u of t.users.slice(0, 2)) {
    await owner.user.update({ where: { id: u.id }, data: { hireDate: new Date('2024-01-01'), employeeNumber: `E${u.id.slice(0, 4)}` } });
    await owner.payRate.create({ data: { tenantId: t.tenant.id, userId: u.id, positionId: t.position.id, hourlyRate: 25, effectiveFrom: new Date('2025-01-01') } });
    for (const d of [2, 3, 4, 5, 9, 10, 11, 12]) {
      const start = new Date(Date.UTC(2026, 2, d, 16)); // 8 a.m. Pacific
      await owner.timePunch.create({ data: { tenantId: t.tenant.id, userId: u.id, facilityId: t.facility.id, positionId: t.position.id, clockIn: start, clockOut: new Date(start.getTime() + 8 * 3_600_000), status: 'APPROVED' } });
    }
  }
  await ensureTaxTables(owner, 2026);
  await owner.payrollTaxTable.updateMany({ where: { year: 2026 }, data: { verifiedAt: null } });
});
afterAll(async () => {
  await appDb.$disconnect();
  await owner.$disconnect();
});

describe('direct deposit and TD1', () => {
  it('an employee adds their bank account; someone else has to verify it, and they hear about it', async () => {
    const bad = await call(tok.g0).post('/api/me/bank-accounts', { holderName: 'Guard Zero', institution: '1', transit: '12345', account: '1234567', agree: true });
    expect(bad.status).toBe(400);
    const r = await call(tok.g0).post('/api/me/bank-accounts', { holderName: 'Guard Zero', institution: '004', transit: '12345', account: '9876543210', agree: true });
    expect(r.status).toBe(201);
    expect(r.body.status).toBe('PENDING');
    expect(r.body.account).toBe('••••3210');
    expect(JSON.stringify(r.body)).not.toContain('9876543210');
    expect(await owner.notification.count({ where: { userId: t.users[0]!.id, type: 'bank_changed' } })).toBe(1);
    // Stored sealed: the full number isn't in the database in clear.
    const row = await owner.bankAccount.findUniqueOrThrow({ where: { id: r.body.id } });
    expect(Buffer.from(row.accountCiphertext).toString('utf8')).not.toContain('9876543210');
    expect((await call(tok.prep).post(`/api/bank-accounts/${r.body.id}/verify`, { approve: true })).status).toBe(200);
    expect((await call(tok.g0).get('/api/me/pay')).body.bankAccounts[0].status).toBe('ACTIVE');
  });

  it('HR entering someone’s banking can’t also verify it', async () => {
    const r = await call(tok.prep).post(`/api/users/${t.users[1]!.id}/bank-accounts`, { holderName: 'Guard One', institution: '001', transit: '54321', account: '1112223', agree: true });
    expect(r.status).toBe(201);
    expect((await call(tok.prep).post(`/api/bank-accounts/${r.body.id}/verify`, { approve: true })).status).toBe(403);
    expect((await call(tok.approver).post(`/api/bank-accounts/${r.body.id}/verify`, { approve: true })).status).toBe(200);
  });

  it('employees fill in TD1 claims and a valid SIN once', async () => {
    expect((await call(tok.g0).put('/api/me/pay-profile', { sin: '123 456 789' })).status).toBe(400);
    expect((await call(tok.g0).put('/api/me/pay-profile', { sin: '046 454 286' })).status).toBe(400); // 0… isn't issued to people
    expect((await call(tok.g0).put('/api/me/pay-profile', { sin: '130 692 544', federalClaim: 16452 })).status).toBe(200);
    expect((await call(tok.g0).get('/api/me/pay')).body.profile.sin).toBe('•••-•••-544');
    expect((await call(tok.g0).put('/api/me/pay-profile', { sin: '193 456 787' })).status).toBe(403);
    // Full SIN: payroll only, with a passkey, and the view is logged.
    expect((await call(tok.approverNoKey).get(`/api/users/${t.users[0]!.id}/sin`)).status).toBe(403);
    expect((await call(tok.approver).get(`/api/users/${t.users[0]!.id}/sin`)).body.sin).toBe('130-692-544');
    expect(await owner.auditLog.count({ where: { tenantId: t.tenant.id, action: 'payroll.sin.view' } })).toBe(1);
  });
});

describe('pay runs', () => {
  let runId = '';

  it('is HR’s: an aquatic supervisor can’t see payroll', async () => {
    expect((await call(tok.sup).get('/api/payroll/runs')).status).toBe(403);
  });

  it('prepares a draft with gross pay, CPP, EI and tax for each person', async () => {
    const r = await call(tok.prep).post('/api/payroll/runs', { departmentId: null, periodStart: PERIOD, weeks: 2, payDate: PAY_DATE });
    expect(r.status).toBe(201);
    runId = r.body.id;
    expect(r.body.status).toBe('DRAFT');
    expect(r.body.blockers.join(' ')).toMatch(/hasn’t been verified/);
    const detail = (await call(tok.prep).get(`/api/payroll/runs/${runId}`)).body;
    expect(detail.statements).toHaveLength(2);
    for (const s of detail.statements) {
      expect(s.hours).toBe(64);
      expect(s.gross).toBeGreaterThanOrEqual(1600); // 64 h × $25, plus vacation pay
      expect(s.deductions.cpp).toBeGreaterThan(0);
      expect(s.deductions.ei).toBeGreaterThan(0);
      expect(s.deductions.federalTax).toBeGreaterThan(0);
      expect(s.net).toBeCloseTo(s.gross - s.totalDeductions, 2);
    }
    expect((await call(tok.prep).post('/api/payroll/runs', { departmentId: null, periodStart: PERIOD, weeks: 2, payDate: PAY_DATE })).status).toBe(409);
  });

  it('won’t release pay until the tax tables are verified, by a second person, with a passkey', async () => {
    const blocked = await call(tok.approver).post(`/api/payroll/runs/${runId}/approve`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('RUN_BLOCKED');
    await owner.payrollTaxTable.updateMany({ where: { year: 2026 }, data: { verifiedAt: new Date(), verifiedBy: 'test' } });
    expect((await call(tok.prep).post(`/api/payroll/runs/${runId}/approve`)).status).toBe(403);
    expect((await call(tok.approverNoKey).post(`/api/payroll/runs/${runId}/approve`)).body.code).toBe('PASSKEY_REQUIRED');
    const ok = await call(tok.approver).post(`/api/payroll/runs/${runId}/approve`);
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe('APPROVED');
    expect(await owner.notification.count({ where: { userId: t.users[0]!.id, type: 'pay_statement_ready' } })).toBe(1);
  });

  it('creates the bank deposit file once direct deposit is set up', async () => {
    expect((await call(tok.approver).get(`/api/payroll/runs/${runId}/deposit-file`)).body.code).toBe('DEPOSIT_SETUP');
    const s = await call(tok.approver).put('/api/payroll/settings', { businessNumber: '123456789RP0001', originatorId: 'PAYCITY001', originatorShortName: 'City of Pay', originatorLongName: 'City of Paycity Payroll', destinationDataCentre: '00310', returnsInstitution: '003', returnsTransit: '00010', returnsAccount: '7654321' });
    expect(s.status).toBe(200);
    expect(s.body.returnsAccount).toBe('••••4321');
    const f = await call(tok.approver).get(`/api/payroll/runs/${runId}/deposit-file`);
    expect(f.status).toBe(200);
    const lines = f.text.split('\r\n').filter(Boolean);
    expect(lines.map((l) => l.length)).toEqual([1464, 1464, 1464]);
    expect(lines[1]).toContain('9876543210');
    expect(lines[2]!.slice(60, 68)).toBe('00000002');
    expect(f.headers['x-deposit-sha256']).toMatch(/^[0-9a-f]{64}$/);
    expect((await call(tok.g0).post(`/api/payroll/runs/${runId}/paid`)).status).toBe(403);
    expect((await call(tok.approver).post(`/api/payroll/runs/${runId}/paid`)).status).toBe(200);
  });

  it('employees see their own statements, not anyone else’s', async () => {
    const mine = (await call(tok.g0).get('/api/me/pay')).body.statements;
    expect(mine).toHaveLength(1);
    const s = (await call(tok.g0).get(`/api/me/pay-statements/${mine[0].id}`)).body;
    expect(s.employer.name).toBe(`City of ${SUB}`);
    expect(s.deposit).toBe('••••3210');
    expect(s.ytd.gross).toBeCloseTo(s.gross, 2);
    expect((await call(tok.g1).get(`/api/me/pay-statements/${mine[0].id}`)).status).toBe(404);
  });

  it('produces the remittance, register, T4s and ROE figures', async () => {
    const rem = (await call(tok.prep).get('/api/payroll/remittance?month=2026-03')).body;
    expect(rem.due).toBe('2026-04-15');
    expect(rem.total).toBeCloseTo(rem.cppEmployee + rem.cppEmployer + rem.eiEmployee + rem.eiEmployer + rem.incomeTax, 2);
    expect(rem.eiEmployer).toBeCloseTo(rem.eiEmployee * 1.4, 1);
    const csv = (await call(tok.prep).get(`/api/payroll/runs/${runId}/register.csv`)).text;
    expect(csv.split('\r\n')).toHaveLength(3);
    const t4 = (await call(tok.prep).get('/api/payroll/t4?year=2026')).body;
    expect(t4.slips).toHaveLength(2);
    expect(t4.summary.box14).toBeCloseTo(t4.slips.reduce((a: number, s: { box14EmploymentIncome: number }) => a + s.box14EmploymentIncome, 0), 2);
    expect(t4.summary.missingSin).toHaveLength(1);
    const roe = (await call(tok.prep).get(`/api/payroll/roe/${t.users[0]!.id}`)).body;
    expect(roe.totalInsurableHours).toBe(64);
  });

  it('the next run carries year-to-date forward, and a run can cover one department', async () => {
    const dept = await call(tok.prep).post('/api/departments', { name: 'Aquatics', aquatic: true, positionIds: [t.position.id] });
    expect(dept.status).toBe(201);
    const other = (await owner.position.create({ data: { tenantId: t.tenant.id, name: 'Clerk' } })).id;
    expect((await call(tok.prep).post('/api/departments', { name: 'Office', positionIds: [other] })).status).toBe(201);
    const empty = await call(tok.prep).post('/api/payroll/runs', { departmentId: (await owner.department.findFirstOrThrow({ where: { tenantId: t.tenant.id, name: 'Office' } })).id, periodStart: '2026-03-16', weeks: 2, payDate: '2026-04-03' });
    expect(empty.status).toBe(201);
    expect(empty.body.totals.people).toBe(0);
    for (const u of t.users.slice(0, 1)) {
      const start = new Date(Date.UTC(2026, 2, 17, 16));
      await owner.timePunch.create({ data: { tenantId: t.tenant.id, userId: u.id, facilityId: t.facility.id, positionId: t.position.id, clockIn: start, clockOut: new Date(start.getTime() + 8 * 3_600_000), status: 'APPROVED' } });
    }
    const run = await call(tok.prep).post('/api/payroll/runs', { departmentId: dept.body.id, periodStart: '2026-03-16', weeks: 2, payDate: '2026-04-03' });
    const detail = (await call(tok.prep).get(`/api/payroll/runs/${run.body.id}`)).body;
    expect(detail.statements).toHaveLength(1);
    expect(detail.byDepartment[0].departmentId).toBe(dept.body.id);
    expect((await call(tok.approver).post(`/api/payroll/runs/${run.body.id}/approve`)).status).toBe(200);
    const statements = (await call(tok.g0).get('/api/me/pay')).body.statements;
    const [latest, first] = statements;
    expect(latest.ytd.gross).toBeCloseTo(first.gross + latest.gross, 2);
  });
});
