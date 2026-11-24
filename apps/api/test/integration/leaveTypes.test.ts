/**
 * City-defined leave types: the six built-in kinds keep exactly their behaviour (requests, balances,
 * protection, the public API's type), requests from before leave types still count, and an
 * organization's own kinds work end to end: names in EN/FR, paid hours in payroll under their pay
 * code, balances with a yearly entitlement and a carry-over cap, protection, and a manager → HR
 * approval chain.
 */
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { resetLimits } from '../../src/auth/rateLimit.js';
import { signAccessToken } from '../../src/auth/tokens.js';
import { withTenant } from '../../src/lib/db.js';
import { paidLeaveDays } from '../../src/services/payroll/leavePay.js';
import { runPayroll } from '../../src/services/payroll/payrollRun.js';
import { forgetCustomPermissions } from '../../src/services/people/customRoles.js';
import { addDays, startOfLocalDay } from '../../src/lib/time.js';
import { app as appDb, owner, seedTenant } from './fixtures.js';

const server = createApp();
const SUB = 'leavetypes';
const OTHER = 'leavetypesb';
let t: Awaited<ReturnType<typeof seedTenant>>;
let b: Awaited<ReturnType<typeof seedTenant>>;
const ids = { hr: '', sup: '' };
const tok = { hr: '', sup: '', guard: '', guard2: '', maker: '', guardB: '' };
const now = () => Math.floor(Date.now() / 1000);
const call = (token: string, sub = SUB) => ({
  get: (p: string) => request(server).get(p).set('x-tenant-subdomain', sub).auth(token, { type: 'bearer' }),
  post: (p: string, body: object = {}) => request(server).post(p).set('x-tenant-subdomain', sub).auth(token, { type: 'bearer' }).send(body),
  patch: (p: string, body: object = {}) => request(server).patch(p).set('x-tenant-subdomain', sub).auth(token, { type: 'bearer' }).send(body),
  put: (p: string, body: object = {}) => request(server).put(p).set('x-tenant-subdomain', sub).auth(token, { type: 'bearer' }).send(body),
});
type Kind = { id: string; code: string; system: string | null; name: string; nameFr: string; protectedLeave: boolean; approvalChain: string[] };
type Balance = { type: string; entitled: number | null; carryover: number; used: number; pending: number; remaining: number | null };
// A Monday–Friday week in 2027, 8 a.m. to 8 a.m. Vancouver (16:00 UTC): nothing scheduled, so 40 hours.
const WEEK = { startsAt: '2027-03-01T16:00:00.000Z', endsAt: '2027-03-06T16:00:00.000Z' };
const day = (d: string) => ({ startsAt: `${d}T16:00:00.000Z`, endsAt: `${new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)}T16:00:00.000Z` });
let kinds: Kind[] = [];
let bereavement = '';
let union = '';

beforeAll(async () => {
  resetLimits();
  t = await seedTenant(SUB, 2);
  b = await seedTenant(OTHER, 1);
  const mk = async (roles: ('HR_ADMIN' | 'AQUATIC_SUPERVISOR')[], name: string) => (await owner.user.create({ data: { tenantId: t.tenant.id, roles, employmentStatus: 'FULL_TIME', firstName: name, lastName: 'X', email: `${name}@${SUB}.test` } })).id;
  ids.hr = await mk(['HR_ADMIN'], 'hr');
  ids.sup = await mk(['AQUATIC_SUPERVISOR'], 'sup');
  tok.hr = await signAccessToken({ sub: ids.hr, tid: t.tenant.id, roles: ['HR_ADMIN'], aat: now(), mfa: true });
  tok.sup = await signAccessToken({ sub: ids.sup, tid: t.tenant.id, roles: ['AQUATIC_SUPERVISOR'], aat: now() });
  tok.guard = await signAccessToken({ sub: t.users[0]!.id, tid: t.tenant.id, roles: ['STAFF'], aat: now() });
  tok.guard2 = await signAccessToken({ sub: t.users[1]!.id, tid: t.tenant.id, roles: ['STAFF'], aat: now() });
  // HR who also approves time off: makes the API key that sends time off already approved.
  const maker = await mk(['HR_ADMIN', 'AQUATIC_SUPERVISOR'], 'maker');
  tok.maker = await signAccessToken({ sub: maker, tid: t.tenant.id, roles: ['HR_ADMIN', 'AQUATIC_SUPERVISOR'], aat: now(), mfa: true });
  tok.guardB = await signAccessToken({ sub: b.users[0]!.id, tid: b.tenant.id, roles: ['STAFF'], aat: now() });
  for (const u of t.users) {
    await owner.user.update({ where: { id: u.id }, data: { hireDate: new Date('2020-01-01'), employeeNumber: `E-${u.id.slice(0, 4)}` } });
    await owner.payRate.create({ data: { tenantId: t.tenant.id, userId: u.id, positionId: t.position.id, hourlyRate: 25, effectiveFrom: new Date('2025-01-01') } });
  }
});
afterAll(async () => {
  await appDb.$disconnect();
  await owner.$disconnect();
});

describe('the built-in kinds behave exactly as before', () => {
  it('every organization has the six built-in kinds, in the old order, the moment it needs them', async () => {
    const r = await call(tok.guard).get('/api/leave-types');
    expect(r.status).toBe(200);
    kinds = r.body.types;
    expect(kinds.map((k) => [k.code, k.system])).toEqual(['VACATION', 'SICK', 'PROTECTED_LEAVE', 'UNPAID_PERSONAL', 'OTHER', 'LIEU'].map((c) => [c, c]));
    expect(kinds.filter((k) => k.protectedLeave).map((k) => k.code)).toEqual(['SICK', 'PROTECTED_LEAVE']);
    expect(kinds.every((k) => k.approvalChain.length === 0)).toBe(true);
  });

  it('a vacation request by its type: stored as VACATION (linked to the kind), charged 40 h, in the VACATION balance with the default 120 h', async () => {
    const r = await call(tok.guard).post('/api/me/time-off', { type: 'VACATION', ...WEEK });
    expect(r.status).toBe(201);
    expect(r.body.request.type).toBe('VACATION');
    expect(r.body.request.leaveTypeId).toBe(kinds[0]!.id);
    expect((await call(tok.sup).post(`/api/time-off/${r.body.request.id}/decision`, { decision: 'APPROVE' })).body.status).toBe('APPROVED');
    expect(Number((await owner.timeOffRequest.findUniqueOrThrow({ where: { id: r.body.request.id } })).chargedHours)).toBe(40);
    const mine = (await call(tok.guard).get('/api/me/leave?year=2027')).body.types as Balance[];
    expect(mine.map((x) => x.type)).toEqual(['VACATION', 'SICK', 'PROTECTED_LEAVE', 'UNPAID_PERSONAL', 'OTHER']);
    expect(mine[0]).toMatchObject({ type: 'VACATION', entitled: 120, used: 40, remaining: 80 });
    expect(mine[1]).toMatchObject({ type: 'SICK', entitled: 40, used: 0 });
    expect(mine[4]).toMatchObject({ type: 'OTHER', entitled: null });
  });

  it('sick days and protected leave still can’t be refused without a reason', async () => {
    const r = await call(tok.guard).post('/api/me/time-off', { type: 'SICK', ...day('2027-03-10') });
    expect((await call(tok.sup).post(`/api/time-off/${r.body.request.id}/decision`, { decision: 'DENY' })).status).toBe(400);
    expect((await call(tok.sup).post(`/api/time-off/${r.body.request.id}/decision`, { decision: 'DENY', note: 'Documented reason' })).body.status).toBe('DENIED');
  });

  it('requests and entitlements from before leave types (no kind linked) still count for their built-in kind', async () => {
    // As the app wrote them before this change, or an older version writes them during a deploy.
    await owner.timeOffRequest.create({ data: { tenantId: t.tenant.id, userId: t.users[0]!.id, type: 'VACATION', status: 'APPROVED', startsAt: new Date('2027-04-05T16:00:00Z'), endsAt: new Date('2027-04-06T16:00:00Z'), chargedHours: 8, chargedBasis: 'WEEKDAYS' } });
    await owner.leaveEntitlement.create({ data: { tenantId: t.tenant.id, userId: t.users[0]!.id, year: 2027, type: 'SICK', hours: 56, carryover: 0 } });
    const mine = (await call(tok.guard).get('/api/me/leave?year=2027')).body.types as Balance[];
    expect(mine[0]).toMatchObject({ type: 'VACATION', used: 48, remaining: 72 });
    expect(mine[1]).toMatchObject({ type: 'SICK', entitled: 56 });
    // HR changing it links the old row instead of adding a second one.
    expect((await call(tok.hr).put(`/api/users/${t.users[0]!.id}/leave`, { year: 2027, type: 'SICK', hours: 64 })).status).toBe(200);
    expect(await owner.leaveEntitlement.count({ where: { userId: t.users[0]!.id, year: 2027 } })).toBe(1);
    expect((await owner.leaveEntitlement.findFirstOrThrow({ where: { userId: t.users[0]!.id, year: 2027 } })).leaveTypeId).toBe(kinds[1]!.id);
  });

  it('a built-in kind can be given a pay code, never renamed (the app shows its own words) or changed in how it works', async () => {
    const sick = kinds[1]!;
    const same = { name: sick.name, nameFr: sick.nameFr, paid: true, hasBalance: true, protectedLeave: true, payCode: 'SCK' };
    expect((await call(tok.hr).patch(`/api/settings/leave-types/${sick.id}`, same)).status).toBe(200);
    expect((await call(tok.hr).patch(`/api/settings/leave-types/${sick.id}`, { ...same, name: 'Sick leave' })).body.code).toBe('LEAVE_TYPE_SYSTEM');
    expect((await call(tok.hr).patch(`/api/settings/leave-types/${sick.id}`, { ...same, protectedLeave: false })).body.code).toBe('LEAVE_TYPE_SYSTEM');
    expect((await call(tok.hr).patch(`/api/settings/leave-types/${sick.id}`, { ...same, archived: true })).body.code).toBe('LEAVE_TYPE_SYSTEM');
    expect((await owner.leaveType.findUniqueOrThrow({ where: { id: sick.id } })).protectedLeave).toBe(true);
  });
});

describe('the organization’s own kinds', () => {
  it('HR adds bereavement (paid, 24 h a year, no carry-over, protected, its own pay code) and union leave (manager, then HR)', async () => {
    const r = await call(tok.hr).post('/api/settings/leave-types', { name: 'Bereavement', nameFr: 'Deuil', paid: true, hasBalance: true, yearlyHours: 24, carryOverMaxHours: 0, protectedLeave: true, payCode: 'BRV' });
    expect(r.status).toBe(201);
    expect(r.body.code).toBe('BEREAVEMENT');
    bereavement = r.body.id;
    const u = await call(tok.hr).post('/api/settings/leave-types', { name: 'Union leave', nameFr: 'Congé syndical', paid: false, hasBalance: false, approvalChain: ['MANAGER', 'HR'] });
    expect(u.status).toBe(201);
    union = u.body.id;
    expect((await call(tok.hr).post('/api/settings/leave-types', { name: 'Twice', nameFr: 'Deux fois', paid: false, hasBalance: false, approvalChain: ['HR', 'HR'] })).body.code).toBe('LEAVE_CHAIN_REPEATS');
    // Not for a supervisor or staff; another city doesn't see them.
    expect((await call(tok.sup).post('/api/settings/leave-types', { name: 'Mine', nameFr: 'Le mien', paid: false, hasBalance: false })).status).toBe(403);
    expect((await call(tok.guardB, OTHER).get('/api/leave-types')).body.types.map((k: Kind) => k.code)).not.toContain('BEREAVEMENT');
    expect((await call(tok.guardB, OTHER).post('/api/me/time-off', { leaveTypeId: bereavement, ...day('2027-05-03') })).body.code).toBe('LEAVE_TYPE_UNKNOWN');
  });

  it('a bereavement request is stored as OTHER with its kind, is protected, and has its own balance (the built-in OTHER is untouched)', async () => {
    const r = await call(tok.guard).post('/api/me/time-off', { leaveTypeId: bereavement, ...day('2027-05-03') });
    expect(r.status).toBe(201);
    expect(r.body.request).toMatchObject({ type: 'OTHER', leaveTypeId: bereavement });
    expect((await call(tok.sup).post(`/api/time-off/${r.body.request.id}/decision`, { decision: 'DENY' })).status).toBe(400);
    expect((await call(tok.sup).post(`/api/time-off/${r.body.request.id}/decision`, { decision: 'APPROVE' })).body.status).toBe('APPROVED');
    const mine = (await call(tok.guard).get('/api/me/leave?year=2027')).body.types as Array<Balance & { name: string; nameFr: string }>;
    expect(mine.find((x) => x.type === 'BEREAVEMENT')).toMatchObject({ name: 'Bereavement', nameFr: 'Deuil', entitled: 24, used: 8, remaining: 16 });
    expect(mine.find((x) => x.type === 'OTHER')).toMatchObject({ used: 0 });
    // Union leave keeps no balance.
    expect(mine.some((x) => x.type === 'UNION_LEAVE')).toBe(false);
    // My list shows the kind's names.
    const list = (await call(tok.guard).get('/api/me/time-off')).body as Array<{ id: string; leaveType: Kind }>;
    expect(list.find((x) => x.id === r.body.request.id)!.leaveType).toMatchObject({ name: 'Bereavement', nameFr: 'Deuil', system: null });
  });

  it('carry-over is capped by the kind', async () => {
    expect((await call(tok.hr).put(`/api/users/${t.users[0]!.id}/leave`, { year: 2027, leaveTypeId: bereavement, hours: 24, carryover: 8 })).body.code).toBe('CARRYOVER_OVER_LIMIT');
    expect((await call(tok.hr).put(`/api/users/${t.users[0]!.id}/leave`, { year: 2027, leaveTypeId: bereavement, hours: 32, carryover: 0 })).status).toBe(200);
    expect(((await call(tok.guard).get('/api/me/leave?year=2027')).body.types as Balance[]).find((x) => x.type === 'BEREAVEMENT')).toMatchObject({ entitled: 32, remaining: 24 });
    expect((await call(tok.hr).put(`/api/users/${t.users[0]!.id}/leave`, { year: 2027, leaveTypeId: union, hours: 8 })).body.code).toBe('LEAVE_TYPE_NO_BALANCE');
  });

  it('union leave goes to the manager, then to HR; the manager can’t take the HR step', async () => {
    const r = await call(tok.guard2).post('/api/me/time-off', { leaveTypeId: union, ...day('2027-05-04') });
    expect(r.status).toBe(201);
    const id = r.body.request.id;
    const first = await call(tok.sup).post(`/api/time-off/${id}/decision`, { decision: 'APPROVE' });
    expect(first.body).toMatchObject({ status: 'PENDING', step: 1 });
    expect((await owner.timeOffRequest.findUniqueOrThrow({ where: { id } })).status).toBe('PENDING');
    const again = await call(tok.sup).post(`/api/time-off/${id}/decision`, { decision: 'APPROVE' });
    expect([again.status, again.body.code]).toEqual([403, 'LEAVE_STEP_NOT_YOURS']);
    // HR (leave.manage, not a time-off approver) sees it waiting for them, and only that.
    expect(((await call(tok.hr).get('/api/time-off')).body as Array<{ id: string }>).map((x) => x.id)).toEqual([id]);
    expect((await call(tok.hr).post(`/api/time-off/${id}/decision`, { decision: 'APPROVE' })).body.status).toBe('APPROVED');
    expect(await owner.auditLog.count({ where: { action: 'timeoff.step', entityId: id } })).toBe(1);
  });

  it('HR who doesn’t approve time off still can’t decide an ordinary request', async () => {
    const r = await call(tok.guard2).post('/api/me/time-off', { type: 'VACATION', ...day('2027-05-12') });
    expect((await call(tok.hr).post(`/api/time-off/${r.body.request.id}/decision`, { decision: 'APPROVE' })).status).toBe(403);
    await call(tok.guard2).post(`/api/me/time-off/${r.body.request.id}/cancel`);
  });

  it('payroll pays bereavement hours as LEAVE_PAY under the kind’s own code; unpaid union leave adds nothing', async () => {
    await owner.payCodeMapping.create({ data: { tenantId: t.tenant.id, key: 'VACATION_PAY', code: 'VAC' } });
    const out = await withTenant(t.tenant.id, (tx) => runPayroll(tx, t.tenant.id, '2027-05-03', 1, null, null, { format: 'generic' }));
    const lines = out.results.find((x) => x.userId === t.users[0]!.id)!.result.lines.filter((l) => l.code === 'LEAVE_PAY');
    expect(lines.map((l) => [Number(l.hours), Number(l.rate), Number(l.amount), l.exportCode])).toEqual([[8, 25, 200, 'BRV']]);
    expect(out.results.find((x) => x.userId === t.users[1]!.id)).toBeUndefined();
    expect(out.csv.ok && out.csv.csv).toContain(',BRV,8.00,25.00,200.00,');
  });

  it('archived kinds can’t be asked for, and past requests keep them', async () => {
    expect((await call(tok.hr).patch(`/api/settings/leave-types/${union}`, { name: 'Union leave', nameFr: 'Congé syndical', paid: false, hasBalance: false, approvalChain: ['MANAGER', 'HR'], archived: true })).status).toBe(200);
    expect((await call(tok.guard).get('/api/leave-types')).body.types.map((k: Kind) => k.id)).not.toContain(union);
    expect((await call(tok.guard).post('/api/me/time-off', { leaveTypeId: union, ...day('2027-06-01') })).body.code).toBe('LEAVE_TYPE_ARCHIVED');
    expect((await owner.timeOffRequest.count({ where: { leaveTypeId: union } }))).toBe(1);
  });
});

describe('review round 1', () => {
  it('a role limited to departments can’t define or change kinds; a pay code needs someone who sets pay codes or approves pay', async () => {
    const scopedRole = await owner.customRole.create({ data: { tenantId: t.tenant.id, name: 'Aquatics HR', permissions: ['leave.manage', 'users.read'], scopePositionIds: [t.position.id] } });
    const leaveOnly = await owner.customRole.create({ data: { tenantId: t.tenant.id, name: 'Leave clerk', permissions: ['leave.manage'] } });
    const mkUser = async (name: string, roleId: string) => {
      const u = await owner.user.create({ data: { tenantId: t.tenant.id, roles: ['EMPLOYEE'], employmentStatus: 'FULL_TIME', firstName: name, lastName: 'X', email: `${name}@${SUB}.test` } });
      await owner.userCustomRole.create({ data: { tenantId: t.tenant.id, userId: u.id, customRoleId: roleId } });
      return signAccessToken({ sub: u.id, tid: t.tenant.id, roles: ['EMPLOYEE'], aat: now(), mfa: true });
    };
    const scoped = await mkUser('scopedhr', scopedRole.id);
    const clerk = await mkUser('clerk', leaveOnly.id);
    forgetCustomPermissions(t.tenant.id);
    const body = { name: 'Jury duty', nameFr: 'Fonction de juré', paid: true, hasBalance: false };
    expect((await call(scoped).post('/api/settings/leave-types', body)).status).toBe(403);
    expect((await call(scoped).patch(`/api/settings/leave-types/${bereavement}`, { name: 'Bereavement', nameFr: 'Deuil', paid: true, hasBalance: true, yearlyHours: 24, carryOverMaxHours: 0, protectedLeave: true, payCode: 'BRV' })).status).toBe(403);
    expect((await call(clerk).post('/api/settings/leave-types', { ...body, payCode: 'JRY' })).body.code).toBe('LEAVE_PAY_CODE_NOT_YOURS');
    const jury = await call(clerk).post('/api/settings/leave-types', body);
    expect(jury.status).toBe(201);
    expect((await call(clerk).patch(`/api/settings/leave-types/${jury.body.id}`, { ...body, payCode: 'JRY' })).body.code).toBe('LEAVE_PAY_CODE_NOT_YOURS');
  });

  it('once a kind has been used, how it is paid and protected can’t change', async () => {
    const was = { name: 'Bereavement', nameFr: 'Deuil', paid: true, hasBalance: true, yearlyHours: 24, carryOverMaxHours: 0, protectedLeave: true, payCode: 'BRV' };
    expect((await call(tok.hr).patch(`/api/settings/leave-types/${bereavement}`, { ...was, paid: false })).body.code).toBe('LEAVE_TYPE_IN_USE');
    expect((await call(tok.hr).patch(`/api/settings/leave-types/${bereavement}`, { ...was, payCode: 'BRV2' })).body.code).toBe('LEAVE_TYPE_IN_USE');
    expect((await call(tok.hr).patch(`/api/settings/leave-types/${bereavement}`, { ...was, yearlyHours: 32 })).status).toBe(200);
    expect((await call(tok.hr).patch(`/api/settings/leave-types/${bereavement}`, was)).status).toBe(200);
  });

  const pay = async (week: string) => {
    const out = await withTenant(t.tenant.id, (tx) => runPayroll(tx, t.tenant.id, week, 1));
    return out.results.filter((x) => x.userId === t.users[1]!.id).flatMap((x) => x.result.lines).filter((l) => l.code === 'LEAVE_PAY').reduce((a, l) => a + Number(l.hours), 0);
  };

  it('leave across two pay periods is paid in each, day by day', async () => {
    // Thursday May 13 08:00 to Tuesday May 18 08:00 in Vancouver: Thursday, Friday and Monday, 24 hours.
    const r = await call(tok.guard2).post('/api/me/time-off', { leaveTypeId: bereavement, startsAt: '2027-05-13T15:00:00.000Z', endsAt: '2027-05-18T15:00:00.000Z' });
    expect((await call(tok.sup).post(`/api/time-off/${r.body.request.id}/decision`, { decision: 'APPROVE' })).body.status).toBe('APPROVED');
    // Pay weeks start on Sunday: May 9–15 holds Thursday and Friday, May 16–22 the Monday.
    expect([await pay('2027-05-09'), await pay('2027-05-16')]).toEqual([16, 8]);
  });

  it('leave approved after its period was run is paid in the period of the approval', async () => {
    const r = await call(tok.guard2).post('/api/me/time-off', { leaveTypeId: bereavement, ...day('2027-05-24') });
    expect((await call(tok.sup).post(`/api/time-off/${r.body.request.id}/decision`, { decision: 'APPROVE' })).body.status).toBe('APPROVED');
    // Approved on Wednesday June 2, after the week of May 23 was paid.
    await owner.timeOffRequest.update({ where: { id: r.body.request.id }, data: { decidedAt: new Date('2027-06-02T18:00:00Z') } });
    expect([await pay('2027-05-23'), await pay('2027-05-30')]).toEqual([0, 8]);
  });
});

describe('statutory holiday pay counts paid leave as wages', () => {
  it('Ontario: three days of bereavement in the four weeks before Family Day count, as days worked would', async () => {
    const on = await seedTenant('leavetypeson', 1);
    await owner.facility.update({ where: { id: on.facility.id }, data: { province: 'ON', timezone: 'America/Toronto' } });
    const who = on.users[0]!.id;
    await owner.user.update({ where: { id: who }, data: { hireDate: new Date('2020-01-01') } });
    await owner.payRate.create({ data: { tenantId: on.tenant.id, userId: who, positionId: on.position.id, hourlyRate: 20, effectiveFrom: new Date('2025-01-01') } });
    await owner.statutoryHoliday.upsert({ where: { province_date: { province: 'ON', date: new Date('2031-02-17') } }, create: { province: 'ON', date: new Date('2031-02-17'), name: 'Family Day', nameFr: 'Fête de la famille', key: 'FAMILY_DAY' }, update: {} });
    // Monday to Friday, 8 hours at $20, January 20 to February 14, except Monday to Wednesday January 27–29 on bereavement.
    const leaveDays = ['2031-01-27', '2031-01-28', '2031-01-29'];
    for (let d = '2031-01-20'; d < '2031-02-15'; d = addDays(d, 1)) {
      if ([0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay()) || leaveDays.includes(d)) continue;
      const start = new Date(startOfLocalDay(d, 'America/Toronto').getTime() + 9 * 3_600_000);
      await owner.timePunch.create({ data: { tenantId: on.tenant.id, userId: who, facilityId: on.facility.id, positionId: on.position.id, clockIn: start, clockOut: new Date(start.getTime() + 8 * 3_600_000), status: 'APPROVED' } });
    }
    const kind = await owner.leaveType.create({ data: { tenantId: on.tenant.id, code: 'BEREAVEMENT', name: 'Bereavement', nameFr: 'Deuil', paid: true } });
    await owner.timeOffRequest.create({ data: { tenantId: on.tenant.id, userId: who, type: 'OTHER', leaveTypeId: kind.id, status: 'APPROVED', startsAt: startOfLocalDay('2031-01-27', 'America/Toronto'), endsAt: startOfLocalDay('2031-01-30', 'America/Toronto'), chargedHours: 24, chargedBasis: 'WEEKDAYS', decidedAt: new Date('2031-01-25T15:00:00Z') } });
    const out = await withTenant(on.tenant.id, (tx) => runPayroll(tx, on.tenant.id, '2031-02-16', 1));
    const hp = out.results.find((x) => x.userId === who)!.result.lines.filter((l) => l.code === 'STAT_HOLIDAY_PAY').reduce((a, l) => a + Number(l.amount), 0);
    // Four weeks' wages ÷ 20: 17 days worked and 3 days of paid leave, $160 each.
    expect(hp).toBe(160);
  });
});

describe('public API', () => {
  it('lists the kinds, and takes a request by leave_type_id or by type as before', async () => {
    const k = await call(tok.maker).post('/api/integrations/api-keys', { name: 'HRIS', scopes: ['timeoff:read', 'timeoff:write', 'timeoff:approve'] });
    expect(k.status).toBe(201);
    const v1 = (m: 'get' | 'post', p: string, body?: object) => request(server)[m](`/api/v1${p}`).auth(k.body.key, { type: 'bearer' }).set('Idempotency-Key', `${p}-${Math.random()}`).send(body);
    const list = await v1('get', '/leave-types');
    expect(list.body.data.find((x: { code: string }) => x.code === 'BEREAVEMENT')).toMatchObject({ built_in: false, name_fr: 'Deuil', paid: true, yearly_hours: '24.00', pay_code: 'BRV' });
    expect(list.body.data.find((x: { code: string }) => x.code === 'VACATION')).toMatchObject({ built_in: true });
    const old = await v1('post', '/time-off', { person_id: t.users[1]!.id, type: 'vacation', starts_at: '2027-07-05T16:00:00Z', ends_at: '2027-07-06T16:00:00Z' });
    expect(old.status).toBe(201);
    expect(old.body).toMatchObject({ type: 'vacation', leave_type: { code: 'VACATION' } });
    const own = await v1('post', '/time-off', { person_id: t.users[1]!.id, leave_type_id: bereavement, starts_at: '2027-07-07T16:00:00Z', ends_at: '2027-07-08T16:00:00Z', status: 'approved' });
    expect(own.status).toBe(201);
    expect(own.body).toMatchObject({ type: 'other', status: 'approved', leave_type: { code: 'BEREAVEMENT', name: 'Bereavement' } });
    expect((await v1('post', '/time-off', { person_id: t.users[1]!.id, starts_at: '2027-07-09T16:00:00Z', ends_at: '2027-07-10T16:00:00Z' })).status).toBe(422);
  });
});

describe('review round 2', () => {
  let d: Awaited<ReturnType<typeof seedTenant>>;
  let clerk = '';
  let kind = '';
  let supD = '';
  const leaveHours = async (week: string, positionIds: string[] | null) => {
    const out = await withTenant(d.tenant.id, (tx) => runPayroll(tx, d.tenant.id, week, 1, null, positionIds));
    const lines = out.results.filter((x) => x.userId === d.users[0]!.id).flatMap((x) => x.result.lines).filter((l) => l.code === 'LEAVE_PAY');
    return { hours: lines.reduce((a, l) => a + Number(l.hours), 0), amount: lines.reduce((a, l) => a + Number(l.amount), 0) };
  };
  beforeAll(async () => {
    d = await seedTenant('leavetypesd', 1);
    const tid = d.tenant.id;
    const guard = d.users[0]!.id;
    // The guard holds a position in two departments: Lifeguard (Aquatics, $25) and Library clerk (Library, $22).
    const aquatics = await owner.department.create({ data: { tenantId: tid, name: 'Aquatics', aquatic: true } });
    const libraryDept = await owner.department.create({ data: { tenantId: tid, name: 'Library' } });
    await owner.position.update({ where: { id: d.position.id }, data: { departmentId: aquatics.id } });
    clerk = (await owner.position.create({ data: { tenantId: tid, name: 'Library clerk', departmentId: libraryDept.id } })).id;
    await owner.userPosition.create({ data: { tenantId: tid, userId: guard, positionId: clerk } });
    await owner.user.update({ where: { id: guard }, data: { hireDate: new Date('2020-01-01') } });
    await owner.payRate.create({ data: { tenantId: tid, userId: guard, positionId: d.position.id, hourlyRate: 25, effectiveFrom: new Date('2025-01-01') } });
    await owner.payRate.create({ data: { tenantId: tid, userId: guard, positionId: clerk, hourlyRate: 22, effectiveFrom: new Date('2025-01-01') } });
    kind = (await owner.leaveType.create({ data: { tenantId: tid, code: 'BEREAVEMENT', name: 'Bereavement', nameFr: 'Deuil', paid: true } })).id;
    supD = (await owner.user.create({ data: { tenantId: tid, roles: ['HR_ADMIN', 'AQUATIC_SUPERVISOR'], employmentStatus: 'FULL_TIME', firstName: 'sup', lastName: 'D', email: 'sup@leavetypesd.test' } })).id;
  });

  it('paid leave is paid once, in one department’s run, even when the person works in two departments', async () => {
    // One approved 8-hour day, Wednesday June 9, 2027.
    await owner.timeOffRequest.create({ data: { tenantId: d.tenant.id, userId: d.users[0]!.id, type: 'OTHER', leaveTypeId: kind, status: 'APPROVED', ...day('2027-06-09'), chargedHours: 8, chargedBasis: 'WEEKDAYS', decidedAt: new Date('2027-06-01T18:00:00Z') } });
    expect(await leaveHours('2027-06-06', null)).toEqual({ hours: 8, amount: 200 });
    const aquaticsRun = await leaveHours('2027-06-06', [d.position.id]);
    const libraryRun = await leaveHours('2027-06-06', [clerk]);
    // The day goes to the run of the position whose rate pays it (the same choice as the city-wide run), and only there.
    expect([aquaticsRun, libraryRun]).toEqual([{ hours: 8, amount: 200 }, { hours: 0, amount: 0 }]);
  });

  it('leave counted by weekdays is paid on the days it was charged for: a holiday inside it is neither charged nor paid', async () => {
    const tid = d.tenant.id;
    const guard = d.users[0]!.id;
    // The city's own paid holiday on Wednesday August 4, 2027; bereavement Monday August 2 to Saturday August 7, nothing scheduled.
    await owner.tenantHoliday.create({ data: { tenantId: tid, name: 'Civic day', nameFr: 'Journée civique', date: new Date('2027-08-04') } });
    const r = await withTenant(tid, (tx) => tx.timeOffRequest.create({ data: { tenantId: tid, userId: guard, type: 'OTHER', leaveTypeId: kind, status: 'PENDING', startsAt: new Date('2027-08-02T07:00:00.000Z'), endsAt: new Date('2027-08-07T07:00:00.000Z') } }));
    const supTok = await signAccessToken({ sub: supD, tid, roles: ['HR_ADMIN', 'AQUATIC_SUPERVISOR'], aat: now(), mfa: true });
    expect((await request(server).post(`/api/time-off/${r.id}/decision`).set('x-tenant-subdomain', 'leavetypesd').auth(supTok, { type: 'bearer' }).send({ decision: 'APPROVE' })).body.status).toBe('APPROVED');
    expect(Number((await owner.timeOffRequest.findUniqueOrThrow({ where: { id: r.id } })).chargedHours)).toBe(32);
    const days = (await withTenant(tid, (tx) => paidLeaveDays(tx, { from: '2027-08-01', to: '2027-08-08', onlyUsers: null, positionIds: null }))).filter((x) => x.requestId === r.id);
    expect(days.map((x) => [x.day, Number(x.hours)])).toEqual([
      ['2027-08-02', 8],
      ['2027-08-03', 8],
      ['2027-08-05', 8],
      ['2027-08-06', 8],
    ]);
  });

  it('leave charged from shifts is paid on the days of those shifts, not spread over weekdays', async () => {
    const tid = d.tenant.id;
    const guard = d.users[0]!.id;
    // 8-hour shifts on Saturday May 15 and Sunday May 16, 2027, 9 a.m. to 5 p.m. in Vancouver.
    for (const date of ['2027-05-15', '2027-05-16']) {
      const startsAt = new Date(`${date}T16:00:00.000Z`);
      await owner.shift.create({ data: { tenantId: tid, facilityId: d.facility.id, positionId: d.position.id, userId: guard, startsAt, endsAt: new Date(startsAt.getTime() + 8 * 3_600_000), status: 'PUBLISHED' } });
    }
    // Bereavement from Thursday May 13 to Tuesday May 18 (Vancouver): it takes both shifts off, 16 hours.
    const r = await withTenant(tid, (tx) => tx.timeOffRequest.create({ data: { tenantId: tid, userId: guard, type: 'OTHER', leaveTypeId: kind, status: 'PENDING', startsAt: new Date('2027-05-13T07:00:00.000Z'), endsAt: new Date('2027-05-18T07:00:00.000Z') } }));
    const supTok = await signAccessToken({ sub: supD, tid, roles: ['HR_ADMIN', 'AQUATIC_SUPERVISOR'], aat: now(), mfa: true });
    const decided = await request(server).post(`/api/time-off/${r.id}/decision`).set('x-tenant-subdomain', 'leavetypesd').auth(supTok, { type: 'bearer' }).send({ decision: 'APPROVE' });
    expect([decided.status, decided.body.status ?? decided.body.code]).toEqual([200, 'APPROVED']);
    expect(await owner.timeOffRequest.findUniqueOrThrow({ where: { id: r.id } })).toMatchObject({ chargedBasis: 'SHIFTS' });
    expect(Number((await owner.timeOffRequest.findUniqueOrThrow({ where: { id: r.id } })).chargedHours)).toBe(16);
    // Pay weeks start on Sunday: May 9–15 holds the Saturday shift, May 16–22 the Sunday one.
    expect([(await leaveHours('2027-05-09', null)).hours, (await leaveHours('2027-05-16', null)).hours]).toEqual([8, 8]);
  });
});
