import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { signAccessToken } from '../../src/auth/tokens.js';
import { app as appDb, owner, seedTenant } from './fixtures.js';

const server = createApp();
const SUB = 'rates';
let t: Awaited<ReturnType<typeof seedTenant>>;
let hr: string;
let hrId: string;
let staff: string;

const call = (token: string) => {
  const w = (r: request.Test) => r.auth(token, { type: 'bearer' }).set('x-tenant-subdomain', SUB);
  return {
    get: (p: string) => w(request(server).get(p)),
    post: (p: string, b: object = {}) => w(request(server).post(p)).send(b),
    patch: (p: string, b: object) => w(request(server).patch(p)).send(b),
  };
};
const rates = async (userId: string) =>
  (await owner.payRate.findMany({ where: { userId }, orderBy: { effectiveFrom: 'asc' } })).map((r) => [r.hourlyRate.toString(), r.effectiveFrom.toISOString().slice(0, 10), r.effectiveTo?.toISOString().slice(0, 10) ?? null]);

beforeAll(async () => {
  t = await seedTenant(SUB, 2);
  const h = await owner.user.create({ data: { tenantId: t.tenant.id, roles: ['HR_ADMIN'], employmentStatus: 'FULL_TIME', firstName: 'Hana', lastName: 'Rates', email: 'hr@rates.test' } });
  hrId = h.id;
  hr = await signAccessToken({ sub: h.id, tid: t.tenant.id, roles: ['HR_ADMIN'], aat: Math.floor(Date.now() / 1000) });
  staff = await signAccessToken({ sub: t.users[0]!.id, tid: t.tenant.id, roles: ['STAFF'], aat: Math.floor(Date.now() / 1000) });
});
afterAll(async () => {
  await appDb.$disconnect();
  await owner.$disconnect();
});

describe('correcting pay rates', () => {
  it('a mistyped rate is corrected in place, with the reason audited', async () => {
    const id = t.users[0]!.id;
    await call(hr).post(`/api/users/${id}/pay-rates`, { positionId: t.position.id, hourlyRate: '21.50', effectiveFrom: '2027-01-01' });
    const wrong = await call(hr).post(`/api/users/${id}/pay-rates`, { positionId: t.position.id, hourlyRate: '225.00', effectiveFrom: '2027-07-01' });
    expect((await call(staff).patch(`/api/users/${id}/pay-rates/${wrong.body.id}`, { hourlyRate: '22.50', reason: 'Typo' })).status).toBe(403);
    expect((await call(hr).patch(`/api/users/${id}/pay-rates/${wrong.body.id}`, { hourlyRate: '22.50' })).status).toBe(400);
    const r = await call(hr).patch(`/api/users/${id}/pay-rates/${wrong.body.id}`, { hourlyRate: '22.50', reason: 'Typed 225 for 22.50' });
    expect(r.status).toBe(200);
    expect(await rates(id)).toEqual([
      ['21.5', '2027-01-01', '2027-06-30'],
      ['22.5', '2027-07-01', null],
    ]);
    const log = await owner.auditLog.findFirstOrThrow({ where: { action: 'payrate.correct', entityId: wrong.body.id } });
    expect(log.before).toMatchObject({ hourlyRate: '225' });
    expect(log.after).toMatchObject({ hourlyRate: '22.5', reason: 'Typed 225 for 22.50' });
  });

  it('a wrong start date moves, and the previous rate ends the day before', async () => {
    const id = t.users[0]!.id;
    const current = await owner.payRate.findFirstOrThrow({ where: { userId: id, effectiveTo: null } });
    expect((await call(hr).patch(`/api/users/${id}/pay-rates/${current.id}`, { effectiveFrom: '2026-12-01', reason: 'Before the previous one' })).body.code).toBe('RATE_ORDER');
    expect((await call(hr).patch(`/api/users/${id}/pay-rates/${current.id}`, { effectiveFrom: '2027-06-01', reason: 'Raise started in June' })).status).toBe(200);
    expect(await rates(id)).toEqual([
      ['21.5', '2027-01-01', '2027-05-31'],
      ['22.5', '2027-06-01', null],
    ]);
  });

  it('a rate entered by mistake is removed and the one before carries on', async () => {
    const id = t.users[0]!.id;
    const current = await owner.payRate.findFirstOrThrow({ where: { userId: id, effectiveTo: null } });
    expect((await call(hr).post(`/api/users/${id}/pay-rates/${current.id}/remove`, {})).status).toBe(400);
    expect((await call(hr).post(`/api/users/${id}/pay-rates/${current.id}/remove`, { reason: 'Entered for the wrong person' })).status).toBe(200);
    expect(await rates(id)).toEqual([['21.5', '2027-01-01', null]]);
    expect(await owner.auditLog.count({ where: { action: 'payrate.remove', entityId: current.id } })).toBe(1);
  });

  it('a rate an approved or paid pay run already used can’t be changed or removed', async () => {
    const id = t.users[1]!.id;
    const used = await call(hr).post(`/api/users/${id}/pay-rates`, { positionId: t.position.id, hourlyRate: '20.00', effectiveFrom: '2026-01-01' });
    const run = await owner.payRun.create({ data: { tenantId: t.tenant.id, periodStart: new Date('2026-03-02T00:00:00Z'), periodEnd: new Date('2026-03-15T00:00:00Z'), payDate: new Date('2026-03-20T00:00:00Z'), periodsPerYear: 26, status: 'PAID', preparedById: hrId } });
    const fix = await call(hr).patch(`/api/users/${id}/pay-rates/${used.body.id}`, { hourlyRate: '21.00', reason: 'Should have been 21' });
    expect(fix.status).toBe(409);
    expect(fix.body.code).toBe('PERIOD_PAID');
    expect((await call(hr).post(`/api/users/${id}/pay-rates/${used.body.id}/remove`, { reason: 'Mistake' })).body.code).toBe('PERIOD_PAID');
    // Voided: nothing was paid at that rate.
    await owner.payRun.update({ where: { id: run.id }, data: { status: 'VOID' } });
    expect((await call(hr).patch(`/api/users/${id}/pay-rates/${used.body.id}`, { hourlyRate: '21.00', reason: 'Should have been 21' })).status).toBe(200);
  });
});

describe('pay rate safeguards', () => {
  it('nobody sets, corrects or removes their own pay rate', async () => {
    await owner.userPosition.create({ data: { tenantId: t.tenant.id, userId: hrId, positionId: t.position.id } });
    const own = await call(hr).post(`/api/users/${hrId}/pay-rates`, { positionId: t.position.id, hourlyRate: '99.00', effectiveFrom: '2027-01-01' });
    expect(own.status).toBe(403);
    expect(own.body.code).toBe('OWN_PAY_RATE');
    const r = await owner.payRate.create({ data: { tenantId: t.tenant.id, userId: hrId, positionId: t.position.id, hourlyRate: 30, effectiveFrom: new Date('2027-01-01') } });
    expect((await call(hr).patch(`/api/users/${hrId}/pay-rates/${r.id}`, { hourlyRate: '99.00', reason: 'Raise' })).body.code).toBe('OWN_PAY_RATE');
    expect((await call(hr).post(`/api/users/${hrId}/pay-rates/${r.id}/remove`, { reason: 'Mistake' })).body.code).toBe('OWN_PAY_RATE');
  });

  it('a rate stays locked by the run that paid it after the person moves department', async () => {
    const u = await owner.user.create({ data: { tenantId: t.tenant.id, roles: ['STAFF'], employmentStatus: 'PART_TIME', firstName: 'Moe', lastName: 'Moved', email: 'moe@rates.test' } });
    const dept = await owner.department.create({ data: { tenantId: t.tenant.id, name: 'Old department' } });
    const rate = await owner.payRate.create({ data: { tenantId: t.tenant.id, userId: u.id, positionId: t.position.id, hourlyRate: 20, effectiveFrom: new Date('2026-01-01') } });
    const run = await owner.payRun.create({ data: { tenantId: t.tenant.id, departmentId: dept.id, periodStart: new Date('2026-04-06T00:00:00Z'), periodEnd: new Date('2026-04-19T00:00:00Z'), payDate: new Date('2026-04-24T00:00:00Z'), periodsPerYear: 26, status: 'PAID', preparedById: hrId } });
    await owner.payStatement.create({ data: { tenantId: t.tenant.id, payRunId: run.id, userId: u.id, departmentId: dept.id, province: 'BC', year: 2026, payDate: run.payDate, hours: 10, earnings: [], deductions: {}, gross: 200, totalDeductions: 0, net: 200, employerCpp: 0, employerEi: 0, ytd: {} } });
    // They hold no position in that department any more.
    const r = await call(hr).patch(`/api/users/${u.id}/pay-rates/${rate.id}`, { hourlyRate: '21.00', reason: 'Should have been 21' });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('PERIOD_PAID');
  });

  it('a start after the rate’s own end says so', async () => {
    const id = t.users[0]!.id;
    const closed = await owner.payRate.findFirstOrThrow({ where: { userId: id, effectiveTo: { not: null } } }).catch(() => null);
    if (!closed) {
      await call(hr).post(`/api/users/${id}/pay-rates`, { positionId: t.position.id, hourlyRate: '23.00', effectiveFrom: '2027-09-01' });
    }
    const ended = await owner.payRate.findFirstOrThrow({ where: { userId: id, effectiveTo: { not: null } }, orderBy: { effectiveFrom: 'desc' } });
    const after = new Date(ended.effectiveTo!.getTime() + 5 * 86_400_000).toISOString().slice(0, 10);
    expect((await call(hr).patch(`/api/users/${id}/pay-rates/${ended.id}`, { effectiveFrom: after, reason: 'Wrong start' })).body.code).toBe('RATE_AFTER_END');
  });
});

describe('payroll people who left', () => {
  it('?include=former also lists people laid off for the season or who left, with their status', async () => {
    const id = t.users[1]!.id;
    await owner.user.update({ where: { id }, data: { status: 'INACTIVE' } });
    const active = await call(hr).get('/api/payroll/people');
    expect(active.body.people.map((p: { id: string }) => p.id)).not.toContain(id);
    const all = await call(hr).get('/api/payroll/people?include=former');
    expect(all.body.people.find((p: { id: string }) => p.id === id)).toMatchObject({ status: 'INACTIVE' });
  });
});
