/** One person, two positions at two facilities in two departments: overtime, rates, tax once, costs split. */
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { signAccessToken } from '../../src/auth/tokens.js';
import { ensureTaxTables } from '../../src/services/payroll/taxTables.js';
import { app as appDb, owner, seedTenant } from './fixtures.js';

process.env.LOCAL_KEK_BASE64 ||= randomBytes(32).toString('base64');
const server = createApp();
const SUB = 'twoposts';
let t: Awaited<ReturnType<typeof seedTenant>>;
const tok = { prep: '', approver: '' };
const dept = { aquatics: '', programs: '' };
let instructor = '';
const call = (token: string) => ({
  get: (p: string) => request(server).get(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }),
  post: (p: string, b: object = {}) => request(server).post(p).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' }).send(b),
});
type Line = { code: string; positionId: string | null; hours: number; rate: number; amount: number };

beforeAll(async () => {
  t = await seedTenant(SUB, 1);
  await owner.tenant.update({ where: { id: t.tenant.id }, data: { payWeekStartDay: 1 } });
  const now = Math.floor(Date.now() / 1000);
  const hr = async (name: string) => (await owner.user.create({ data: { tenantId: t.tenant.id, roles: ['HR_ADMIN'], employmentStatus: 'FULL_TIME', firstName: name, lastName: 'HR', email: `${name}@${SUB}.test` } })).id;
  tok.prep = await signAccessToken({ sub: await hr('prep'), tid: t.tenant.id, roles: ['HR_ADMIN'], aat: now, mfa: true });
  tok.approver = await signAccessToken({ sub: await hr('approver'), tid: t.tenant.id, roles: ['HR_ADMIN'], aat: now, mfa: true });
  dept.aquatics = (await owner.department.create({ data: { tenantId: t.tenant.id, name: 'Aquatics', glCode: 'AQ' } })).id;
  dept.programs = (await owner.department.create({ data: { tenantId: t.tenant.id, name: 'Programs', glCode: 'PR' } })).id;
  await owner.position.update({ where: { id: t.position.id }, data: { departmentId: dept.aquatics } });
  instructor = (await owner.position.create({ data: { tenantId: t.tenant.id, name: 'Instructor', departmentId: dept.programs } })).id;
  const second = await owner.facility.create({ data: { tenantId: t.tenant.id, name: 'Second Pool', province: 'BC', timezone: 'America/Vancouver' } });
  const u = t.users[0]!;
  await owner.user.update({ where: { id: u.id }, data: { hireDate: new Date('2024-01-01') } });
  await owner.userPosition.create({ data: { tenantId: t.tenant.id, userId: u.id, positionId: instructor } });
  await owner.payRate.create({ data: { tenantId: t.tenant.id, userId: u.id, positionId: t.position.id, hourlyRate: 25, effectiveFrom: new Date('2025-01-01') } });
  await owner.payRate.create({ data: { tenantId: t.tenant.id, userId: u.id, positionId: instructor, hourlyRate: 30, effectiveFrom: new Date('2025-01-01') } });
  // One week (Mon 2 Mar 2026): three 8-hour days as a lifeguard at the first pool, three as an instructor at the second.
  const punch = (day: number, facilityId: string, positionId: string) => {
    const start = new Date(Date.UTC(2026, 2, day, 16));
    return owner.timePunch.create({ data: { tenantId: t.tenant.id, userId: u.id, facilityId, positionId, clockIn: start, clockOut: new Date(start.getTime() + 8 * 3_600_000), status: 'APPROVED' } });
  };
  for (const d of [2, 3, 4]) await punch(d, t.facility.id, t.position.id);
  for (const d of [5, 6, 7]) await punch(d, second.id, instructor);
  await ensureTaxTables(owner, 2026);
  await owner.payrollTaxTable.updateMany({ where: { year: 2026 }, data: { verifiedAt: new Date(), verifiedBy: 'test' } });
});
afterAll(async () => {
  await appDb.$disconnect();
  await owner.$disconnect();
});

describe('one person, two positions at two facilities', () => {
  it('a department run won’t pay half of them: tax has to be worked out once', async () => {
    const r = await call(tok.prep).post('/api/payroll/runs', { departmentId: dept.aquatics, periodStart: '2026-03-02', weeks: 1, payDate: '2026-03-13' });
    expect(r.status).toBe(201);
    expect(r.body.blockers.map((b: { code: string }) => b.code)).toContain('OTHER_DEPARTMENT_HOURS');
    await call(tok.prep).post(`/api/payroll/runs/${r.body.id}/void`, { reason: 'Use a city-wide run' });
  });

  it('counts both facilities toward weekly overtime, each hour at its own position’s rate', async () => {
    const r = await call(tok.prep).post('/api/payroll/runs', { departmentId: null, periodStart: '2026-03-02', weeks: 1, payDate: '2026-03-13' });
    expect(r.status).toBe(201);
    const detail = (await call(tok.prep).get(`/api/payroll/runs/${r.body.id}`)).body;
    expect(detail.statements).toHaveLength(1);
    const lines = (await owner.payStatement.findFirstOrThrow({ where: { payRunId: r.body.id } })).earnings as unknown as Line[];
    const hours = (code: RegExp) => lines.filter((l) => code.test(l.code)).reduce((a, l) => a + Number(l.hours), 0);
    // 48 hours in the week; BC pays time and a half after 40.
    expect(hours(/^OVERTIME/)).toBeCloseTo(8, 2);
    expect(hours(/^REGULAR/)).toBeCloseTo(40, 2);
    expect(lines.some((l) => l.positionId === instructor && Number(l.rate) === 30)).toBe(true);
    expect(lines.some((l) => l.positionId === t.position.id && Number(l.rate) === 25)).toBe(true);

    // The journal charges each department its own share, and still balances.
    expect((await call(tok.approver).post(`/api/payroll/runs/${r.body.id}/approve`)).status).toBe(200);
    const j = (await call(tok.prep).get(`/api/accounting/journal/${r.body.id}`)).body;
    expect(j.balanced).toBe(true);
    const wages = j.lines.filter((l: { key: string }) => l.key === 'wages');
    expect(wages.map((l: { segment: string }) => l.segment).sort()).toEqual(['AQ', 'PR']);
  });
});
