/**
 * Two-person pay-run approval can't be defeated (SEC-10): the approval pays exactly what was prepared
 * and reviewed, whoever last changes a run is its preparer, and nobody changes their own pay first.
 * A run whose deposit file went out can't be voided and paid again (SEC-19).
 */
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { signAccessToken } from '../../src/auth/tokens.js';
import { ensureTaxTables } from '../../src/services/payroll/taxTables.js';
import { app as appDb, owner, seedTenant } from './fixtures.js';

process.env.LOCAL_KEK_BASE64 ||= randomBytes(32).toString('base64');

const server = createApp();
const SUB = 'payapproval';
let t: Awaited<ReturnType<typeof seedTenant>>;
const tok = { prep: '', approver: '' };
const ids = { prep: '', approver: '' };
const call = (token: string) => ({
  get: (p: string) => request(server).get(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }),
  post: (p: string, b: object = {}) => request(server).post(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }).send(b),
  put: (p: string, b: object = {}) => request(server).put(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }).send(b),
});
const now = () => Math.floor(Date.now() / 1000);

/** Two weeks of approved hours, 8 h a day, Monday to Thursday, from `monday` (a UTC date). */
async function hours(userId: string, monday: Date) {
  for (const d of [0, 1, 2, 3, 7, 8, 9, 10]) {
    const start = new Date(monday.getTime() + d * 86_400_000 + 16 * 3_600_000);
    await owner.timePunch.create({ data: { tenantId: t.tenant.id, userId, facilityId: t.facility.id, positionId: t.position.id, clockIn: start, clockOut: new Date(start.getTime() + 8 * 3_600_000), status: 'APPROVED' } });
  }
}

beforeAll(async () => {
  t = await seedTenant(SUB, 2);
  await owner.tenant.update({ where: { id: t.tenant.id }, data: { payWeekStartDay: 1 } });
  const hr = async (name: string) => (await owner.user.create({ data: { tenantId: t.tenant.id, roles: ['HR_ADMIN'], employmentStatus: 'FULL_TIME', firstName: name, lastName: 'HR', email: `${name}@${SUB}.test` } })).id;
  ids.prep = await hr('prep');
  ids.approver = await hr('approver');
  tok.prep = await signAccessToken({ sub: ids.prep, tid: t.tenant.id, roles: ['HR_ADMIN'], aat: now(), mfa: true });
  tok.approver = await signAccessToken({ sub: ids.approver, tid: t.tenant.id, roles: ['HR_ADMIN'], aat: now(), mfa: true });
  for (const u of [...t.users, { id: ids.approver }]) {
    await owner.user.update({ where: { id: u.id }, data: { hireDate: new Date('2024-01-01'), employeeNumber: `E${u.id.slice(0, 4)}` } });
    await owner.payRate.create({ data: { tenantId: t.tenant.id, userId: u.id, positionId: t.position.id, hourlyRate: 25, effectiveFrom: new Date('2025-01-01') } });
    await hours(u.id, new Date('2026-03-02T00:00:00Z'));
    await hours(u.id, new Date('2026-03-16T00:00:00Z'));
  }
  await ensureTaxTables(owner, 2026);
  await owner.payrollTaxTable.updateMany({ where: { year: 2026 }, data: { verifiedAt: new Date(), verifiedBy: 'test' } });
});
afterAll(async () => {
  await appDb.$disconnect();
  await owner.$disconnect();
});

describe('nobody changes their own pay while pay runs need two people (SEC-10)', () => {
  it('refuses your own pay rate, salary and tax profile; someone else may change them', async () => {
    const rate = { positionId: t.position.id, hourlyRate: '999.99', effectiveFrom: '2026-03-02' };
    const own = [
      await call(tok.approver).post(`/api/users/${ids.approver}/pay-rates`, rate),
      await call(tok.approver).post(`/api/users/${ids.approver}/salary`, { positionId: t.position.id, annualAmount: 9_000_000, effectiveFrom: '2026-03-02' }),
      await call(tok.approver).post(`/api/users/${ids.approver}/salary/end`, { lastDay: '2026-03-01' }),
      await call(tok.approver).put(`/api/users/${ids.approver}/pay-profile`, { federalClaim: 99_999 }),
    ];
    for (const r of own) expect([r.status, r.body.code]).toEqual([403, 'SELF_PAY_CHANGE']);
    expect(await owner.payRate.count({ where: { userId: ids.approver, hourlyRate: 999.99 } })).toBe(0);
    expect(await owner.salary.count({ where: { userId: ids.approver } })).toBe(0);
    expect((await call(tok.prep).post(`/api/users/${ids.approver}/pay-rates`, { ...rate, hourlyRate: '26.00' })).status).toBe(201);
  });
});

describe('approval pays exactly what was prepared and reviewed (SEC-10)', () => {
  let runId = '';
  const PERIOD = { departmentId: null, periodStart: '2026-03-02', weeks: 2, payDate: '2026-03-20' };

  it('a pay change after preparation refuses the approval, and the run is left as reviewed', async () => {
    const r = await call(tok.prep).post('/api/payroll/runs', PERIOD);
    expect(r.status).toBe(201);
    runId = r.body.id;
    const reviewed = (await call(tok.approver).get(`/api/payroll/runs/${runId}`)).body;
    // The approver raises a colleague's rate from the start of the period, then approves.
    expect((await call(tok.approver).post(`/api/users/${t.users[0]!.id}/pay-rates`, { positionId: t.position.id, hourlyRate: '90.00', effectiveFrom: '2026-03-02' })).status).toBe(201);
    const refused = await call(tok.approver).post(`/api/payroll/runs/${runId}/approve`, { fingerprint: reviewed.fingerprint });
    expect([refused.status, refused.body.code]).toEqual([409, 'RUN_CHANGED']);
    expect(reviewed.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    const after = (await call(tok.approver).get(`/api/payroll/runs/${runId}`)).body;
    expect(after.run.status).toBe('DRAFT');
    expect(after.fingerprint).toBe(reviewed.fingerprint);
    expect(after.run.totals.gross).toBe(reviewed.run.totals.gross);
  });

  it('whoever recalculates becomes the preparer, and approves only what they reviewed', async () => {
    // The approver recalculates (picking up the new rate): now they prepared it, so someone else approves.
    expect((await call(tok.approver).post(`/api/payroll/runs/${runId}/recalculate`)).status).toBe(200);
    expect((await call(tok.approver).post(`/api/payroll/runs/${runId}/approve`)).status).toBe(403);
    // The other administrator approves only the version they looked at.
    const stale = await call(tok.prep).post(`/api/payroll/runs/${runId}/approve`, { fingerprint: 'a'.repeat(64) });
    expect([stale.status, stale.body.code]).toEqual([409, 'RUN_CHANGED']);
    const { fingerprint } = (await call(tok.prep).get(`/api/payroll/runs/${runId}`)).body;
    const ok = await call(tok.prep).post(`/api/payroll/runs/${runId}/approve`, { fingerprint });
    expect([ok.status, ok.body.status]).toEqual([200, 'APPROVED']);
  });

  it('adding a one-time item makes you the preparer too', async () => {
    const r = await call(tok.prep).post('/api/payroll/runs', { ...PERIOD, periodStart: '2026-03-16', payDate: '2026-04-03' });
    expect(r.status).toBe(201);
    expect((await call(tok.approver).post(`/api/payroll/runs/${r.body.id}/adjustments`, { userId: t.users[1]!.id, kind: 'BONUS', description: 'Spot bonus', amount: 100 })).status).toBe(201);
    expect((await owner.payRun.findUniqueOrThrow({ where: { id: r.body.id } })).preparedById).toBe(ids.approver);
    expect((await call(tok.approver).post(`/api/payroll/runs/${r.body.id}/approve`)).status).toBe(403);
    expect((await call(tok.prep).post(`/api/payroll/runs/${r.body.id}/void`, { reason: 'Not needed for the test' })).status).toBe(200);
  });
});

describe('a pay run whose deposit file went out can’t be voided and paid again (SEC-19)', () => {
  it('refuses the void once the file exists, and gives expense claims back when a run is voided before', async () => {
    const run = await owner.payRun.findFirstOrThrow({ where: { tenantId: t.tenant.id, status: 'APPROVED' } });
    await owner.payRun.update({ where: { id: run.id }, data: { depositFileSha256: 'f'.repeat(64), fileCreationNumber: 1 } });
    const refused = await call(tok.approver).post(`/api/payroll/runs/${run.id}/void`, { reason: 'Pay it again' });
    expect([refused.status, refused.body.code]).toEqual([409, 'VOID_AFTER_FILE']);
    expect((await owner.payRun.findUniqueOrThrow({ where: { id: run.id } })).status).toBe('APPROVED');
    // A run marked paid by its file stays paid: the clash check keeps the period from being paid twice.
    expect((await call(tok.prep).post('/api/payroll/runs', { departmentId: null, periodStart: '2026-03-02', weeks: 2, payDate: '2026-03-20' })).status).toBe(409);

    // An approved run voided before any file was made gives its expense claims back.
    const claim = await owner.expenseClaim.create({ data: { tenantId: t.tenant.id, userId: t.users[1]!.id, title: 'Mileage', total: 42.5, status: 'APPROVED', decidedAt: new Date('2026-03-01T12:00:00Z') } });
    const r = await call(tok.prep).post('/api/payroll/runs', { departmentId: null, periodStart: '2026-03-30', weeks: 2, payDate: '2026-04-17' });
    expect(r.status).toBe(201);
    expect((await call(tok.approver).post(`/api/payroll/runs/${r.body.id}/approve`)).status).toBe(200);
    expect((await owner.expenseClaim.findUniqueOrThrow({ where: { id: claim.id } })).status).toBe('PAID');
    expect((await call(tok.approver).post(`/api/payroll/runs/${r.body.id}/void`, { reason: 'Wrong period chosen' })).status).toBe(200);
    const back = await owner.expenseClaim.findUniqueOrThrow({ where: { id: claim.id } });
    expect([back.status, back.payRunId]).toEqual(['APPROVED', null]);
  });
});
