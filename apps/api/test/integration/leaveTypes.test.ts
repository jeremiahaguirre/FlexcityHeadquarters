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
import { runPayroll } from '../../src/services/payroll/payrollRun.js';
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

  it('a built-in kind can be renamed and given a pay code, never changed in how it works', async () => {
    const sick = kinds[1]!;
    const same = { name: 'Sick leave', nameFr: 'Congé de maladie', paid: true, hasBalance: true, protectedLeave: true, payCode: 'SCK' };
    expect((await call(tok.hr).patch(`/api/settings/leave-types/${sick.id}`, same)).status).toBe(200);
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
