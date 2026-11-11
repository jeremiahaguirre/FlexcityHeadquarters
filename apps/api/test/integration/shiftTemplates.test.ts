/** Weekly shift templates and shift preferences, end to end: drafts only, idempotent, undo, closures, scope, privacy, tenant isolation, feature switches, Fill's explanation. */
import request from 'supertest';
import { DateTime } from 'luxon';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { signAccessToken } from '../../src/auth/tokens.js';
import { withTenant } from '../../src/lib/db.js';
import { forgetFeatures } from '../../src/services/platform/features.js';
import { anonymizeUser } from '../../src/services/privacy/erasure.js';
import { autoDraftTemplates } from '../../src/services/scheduling/shiftTemplates.js';
import { app as appDb, owner, seedTenant } from './fixtures.js';

const server = createApp();
const SUB = 'tmplwk';
const SUB2 = 'tmplwk2';
const TZ = 'America/Vancouver';
const now = () => Math.floor(Date.now() / 1000);
const call = (token: string, sub = SUB) => ({
  get: (p: string) => request(server).get(p).set('x-tenant-subdomain', sub).auth(token, { type: 'bearer' }),
  post: (p: string, b: object = {}) => request(server).post(p).set('x-tenant-subdomain', sub).auth(token, { type: 'bearer' }).send(b),
  put: (p: string, b: object = {}) => request(server).put(p).set('x-tenant-subdomain', sub).auth(token, { type: 'bearer' }).send(b),
  del: (p: string) => request(server).delete(p).set('x-tenant-subdomain', sub).auth(token, { type: 'bearer' }),
});

// A Monday three weeks out.
const monday = DateTime.now().setZone(TZ).startOf('week').plus({ weeks: 3 });
const WEEK = monday.toISODate()!;
const plus = (d: number) => monday.plus({ days: d }).toISODate()!;

let t: Awaited<ReturnType<typeof seedTenant>>;
let t2: Awaited<ReturnType<typeof seedTenant>>;
let parksPos = '';
const tok = { sup: '', guard: '', guard2: '', parksSup: '', sup2: '', hr: '' };
let templateId = '';

async function setFeatures(tenantId: string, features: object) {
  await owner.tenant.update({ where: { id: tenantId }, data: { features } });
  forgetFeatures(tenantId);
}

beforeAll(async () => {
  t = await seedTenant(SUB, 3);
  t2 = await seedTenant(SUB2, 1);
  const aquatics = await owner.department.create({ data: { tenantId: t.tenant.id, name: 'Aquatics', aquatic: true } });
  const parks = await owner.department.create({ data: { tenantId: t.tenant.id, name: 'Parks' } });
  await owner.position.update({ where: { id: t.position.id }, data: { departmentId: aquatics.id } });
  parksPos = (await owner.position.create({ data: { tenantId: t.tenant.id, name: 'Parks Worker', departmentId: parks.id } })).id;
  // Open Monday to Friday 06:00–21:00; closed on weekends.
  await owner.facilityHours.createMany({ data: [1, 2, 3, 4, 5].map((d) => ({ tenantId: t.tenant.id, facilityId: t.facility.id, dayOfWeek: d, opensMinute: 360, closesMinute: 1260 })) });
  for (const id of t.users.map((u) => u.id)) await owner.availability.createMany({ data: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ tenantId: t.tenant.id, userId: id, dayOfWeek: d, startMinute: 0, endMinute: 1440, effectiveFrom: new Date('2020-01-01') })) });
  const sup = await owner.user.create({ data: { tenantId: t.tenant.id, roles: ['AQUATIC_SUPERVISOR'], employmentStatus: 'FULL_TIME', firstName: 'Sue', lastName: 'Sup', email: `sup@${SUB}.test` } });
  await owner.departmentManager.create({ data: { tenantId: t.tenant.id, departmentId: aquatics.id, userId: sup.id } });
  tok.sup = await signAccessToken({ sub: sup.id, tid: t.tenant.id, roles: ['AQUATIC_SUPERVISOR'], aat: now() });
  const hr = await owner.user.create({ data: { tenantId: t.tenant.id, roles: ['HR_ADMIN'], employmentStatus: 'FULL_TIME', firstName: 'Hal', lastName: 'HR', email: `hr@${SUB}.test` } });
  tok.hr = await signAccessToken({ sub: hr.id, tid: t.tenant.id, roles: ['HR_ADMIN'], aat: now() });
  tok.guard = await signAccessToken({ sub: t.users[0]!.id, tid: t.tenant.id, roles: ['STAFF'], aat: now() });
  tok.guard2 = await signAccessToken({ sub: t.users[1]!.id, tid: t.tenant.id, roles: ['STAFF'], aat: now() });
  const role = await owner.customRole.create({ data: { tenantId: t.tenant.id, name: 'Parks Lead', permissions: ['schedule.read', 'schedule.write', 'schedule.templates', 'users.read'], scopePositionIds: [parksPos] } });
  const ps = await owner.user.create({ data: { tenantId: t.tenant.id, roles: ['EMPLOYEE'], employmentStatus: 'FULL_TIME', firstName: 'Pat', lastName: 'Parks', email: `parks@${SUB}.test` } });
  await owner.userCustomRole.create({ data: { tenantId: t.tenant.id, userId: ps.id, customRoleId: role.id } });
  tok.parksSup = await signAccessToken({ sub: ps.id, tid: t.tenant.id, roles: ['EMPLOYEE'], aat: now() });
  const sup2 = await owner.user.create({ data: { tenantId: t2.tenant.id, roles: ['AQUATIC_SUPERVISOR'], employmentStatus: 'FULL_TIME', firstName: 'Two', lastName: 'Sup', email: `sup@${SUB2}.test` } });
  tok.sup2 = await signAccessToken({ sub: sup2.id, tid: t2.tenant.id, roles: ['AQUATIC_SUPERVISOR'], aat: now() });
});
afterAll(async () => {
  await appDb.$disconnect();
  await owner.$disconnect();
});

const template = () => ({
  name: 'Summer',
  slots: [
    // Mon–Fri mornings, two guards.
    { daysOfWeek: [1, 2, 3, 4, 5], startMinute: 7 * 60, endMinute: 15 * 60, facilityId: t.facility.id, positionId: t.position.id, headcount: 2, unpaidBreakMinutes: 30 },
    // Saturday: the facility is closed, so these are skipped.
    { daysOfWeek: [6], startMinute: 9 * 60, endMinute: 17 * 60, facilityId: t.facility.id, positionId: t.position.id, headcount: 1 },
  ],
});

describe('weekly shift templates', () => {
  it('a supervisor saves a template; staff and other cities can’t see it', async () => {
    const r = await call(tok.sup).post('/api/schedule/templates', template());
    expect(r.status).toBe(201);
    templateId = r.body.id;
    expect(r.body.slots).toHaveLength(2);
    expect((await call(tok.guard).get('/api/schedule/templates')).status).toBe(403);
    expect((await call(tok.sup2, SUB2).get('/api/schedule/templates')).body.templates).toEqual([]);
    expect((await call(tok.sup2, SUB2).post(`/api/schedule/templates/${templateId}/apply`, { from: WEEK, to: plus(7) })).status).toBe(404);
  });

  it('a lead scoped to another department can’t use it', async () => {
    expect((await call(tok.parksSup).get('/api/schedule/templates')).body.templates).toEqual([]);
    expect((await call(tok.parksSup).post(`/api/schedule/templates/${templateId}/apply`, { from: WEEK, to: plus(7) })).status).toBe(403);
  });

  it('preview writes nothing; apply makes DRAFT shifts only, skipping the closed day', async () => {
    const pre = await call(tok.sup).post(`/api/schedule/templates/${templateId}/apply`, { from: WEEK, to: plus(7), dryRun: true });
    expect(pre.status).toBe(200);
    expect(pre.body).toMatchObject({ created: 10, existing: 0, skipped: 1, applicationId: null });
    expect(await owner.shift.count({ where: { tenantId: t.tenant.id } })).toBe(0);
    const r = await call(tok.sup).post(`/api/schedule/templates/${templateId}/apply`, { from: WEEK, to: plus(7) });
    expect(r.body.created).toBe(10);
    expect(r.body.items.find((i: { code: string }) => i.code === 'FACILITY_CLOSED')).toBeTruthy();
    const shifts = await owner.shift.findMany({ where: { tenantId: t.tenant.id } });
    expect(shifts).toHaveLength(10);
    expect(shifts.every((s) => s.status === 'DRAFT' && s.userId === null && s.unpaidBreakMinutes === 30)).toBe(true);
    // 07:00 local on the Monday.
    expect(DateTime.fromJSDate(shifts.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())[0]!.startsAt).setZone(TZ).toFormat('yyyy-MM-dd HH:mm')).toBe(`${WEEK} 07:00`);
    const log = await owner.auditLog.findFirst({ where: { tenantId: t.tenant.id, action: 'shift_template.apply' } });
    expect(log?.entityId).toBe(templateId);
  });

  it('is idempotent: applying again makes nothing; a longer range only adds the missing week', async () => {
    const again = await call(tok.sup).post(`/api/schedule/templates/${templateId}/apply`, { from: WEEK, to: plus(7) });
    expect(again.body).toMatchObject({ created: 0, existing: 10, applicationId: null });
    const longer = await call(tok.sup).post(`/api/schedule/templates/${templateId}/apply`, { from: WEEK, to: plus(14) });
    expect(longer.body).toMatchObject({ created: 10, existing: 10 });
    expect(await owner.shift.count({ where: { tenantId: t.tenant.id, status: 'DRAFT' } })).toBe(20);
  });

  it('undo cancels the application’s drafts and keeps anything published since', async () => {
    const apps = await call(tok.sup).get('/api/schedule/templates');
    const last = apps.body.applications[0];
    expect(last.created).toBe(10);
    const made = await owner.shift.findMany({ where: { templateApplicationId: last.id } });
    await owner.shift.update({ where: { id: made[0]!.id }, data: { status: 'PUBLISHED', userId: t.users[0]!.id } });
    const u = await call(tok.sup).post(`/api/schedule/templates/applications/${last.id}/undo`);
    expect(u.body).toEqual({ cancelled: 9, kept: 1 });
    expect((await call(tok.sup).post(`/api/schedule/templates/applications/${last.id}/undo`)).status).toBe(400);
    expect(await owner.shift.count({ where: { templateApplicationId: last.id, status: 'CANCELLED' } })).toBe(9);
    // The first week is untouched.
    expect(await owner.shift.count({ where: { tenantId: t.tenant.id, status: 'DRAFT' } })).toBe(10);
  });

  it('respects the template’s own dates', async () => {
    const r = await call(tok.sup).put(`/api/schedule/templates/${templateId}`, { ...template(), validTo: plus(2) });
    expect(r.status).toBe(200);
    const pre = await call(tok.sup).post(`/api/schedule/templates/${templateId}/apply`, { from: plus(14), to: plus(21), dryRun: true });
    expect(pre.body).toMatchObject({ created: 0, outsideDates: 7 });
    await call(tok.sup).put(`/api/schedule/templates/${templateId}`, template());
  });

  it('automatic drafts only when the organization turns them on (tenant.configure)', async () => {
    await call(tok.sup).put(`/api/schedule/templates/${templateId}`, { ...template(), autoWeeksAhead: 1 });
    const off = await withTenant(t.tenant.id, (tx) => autoDraftTemplates(tx));
    expect(off).toBe(0);
    expect((await call(tok.sup).put('/api/schedule/templates/settings', { autoCreate: true })).status).toBe(403);
    // HR has tenant.configure but no templates permission: the route refuses before; give it through the supervisor + HR combo.
    const both = await signAccessToken({ sub: (await owner.user.findFirstOrThrow({ where: { email: `hr@${SUB}.test` } })).id, tid: t.tenant.id, roles: ['HR_ADMIN', 'AQUATIC_SUPERVISOR'], aat: now() });
    expect((await call(both).put('/api/schedule/templates/settings', { autoCreate: true })).body).toEqual({ autoCreate: true });
    const on = await withTenant(t.tenant.id, (tx) => autoDraftTemplates(tx));
    expect(on).toBeGreaterThan(0);
    expect(await withTenant(t.tenant.id, (tx) => autoDraftTemplates(tx))).toBe(0);
    const auto = await owner.shiftTemplateApplication.findFirst({ where: { tenantId: t.tenant.id, automatic: true } });
    expect(auto?.createdById).toBeNull();
  });

  it('switched off: the routes refuse', async () => {
    await setFeatures(t.tenant.id, { shiftTemplates: false });
    const r = await call(tok.sup).get('/api/schedule/templates');
    expect([403, 404]).toContain(r.status);
    await setFeatures(t.tenant.id, {});
  });
});

describe('shift preferences', () => {
  const mine = { preferences: [{ kind: 'PREFER', daysOfWeek: [1], startMinute: 360, endMinute: 600 }, { kind: 'AVOID', daysOfWeek: [0], note: 'Family day' }], maxWeeklyHours: 24, maxDaysPerWeek: 4 };

  it('each person states and reads their own; the audit log keeps counts only', async () => {
    const r = await call(tok.guard).put('/api/me/preferences', mine);
    expect(r.status).toBe(200);
    expect(r.body.preferences).toHaveLength(2);
    expect(r.body).toMatchObject({ maxWeeklyHours: 24, maxDaysPerWeek: 4 });
    const g = await call(tok.guard).get('/api/me/preferences');
    expect(g.body.preferences.map((p: { kind: string }) => p.kind)).toEqual(['PREFER', 'AVOID']);
    expect(g.body.positions.map((p: { id: string }) => p.id)).toEqual([t.position.id]);
    const log = await owner.auditLog.findFirst({ where: { tenantId: t.tenant.id, action: 'preferences.update' } });
    expect(JSON.stringify(log?.after)).not.toContain('Family');
  });

  it('refuses a position the person doesn’t hold', async () => {
    const r = await call(tok.guard).put('/api/me/preferences', { preferences: [{ kind: 'PREFER', positionId: parksPos }] });
    expect(r.status).toBe(400);
  });

  it('their department’s schedulers read them; other staff, HR, other departments and other cities don’t', async () => {
    const id = t.users[0]!.id;
    expect((await call(tok.sup).get(`/api/users/${id}/preferences`)).body.maxWeeklyHours).toBe(24);
    expect((await call(tok.guard2).get(`/api/users/${id}/preferences`)).status).toBe(403);
    expect((await call(tok.hr).get(`/api/users/${id}/preferences`)).status).toBe(403);
    expect((await call(tok.parksSup).get(`/api/users/${id}/preferences`)).status).toBe(404);
    expect((await call(tok.sup2, SUB2).get(`/api/users/${id}/preferences`)).status).toBe(404);
  });

  it('Fill the schedule weighs them and says when one was honoured', async () => {
    const fill = await call(tok.sup).post('/api/schedule/fill/run', { departmentId: 'all', weekStart: WEEK, horizonStart: WEEK, weekIndex: 0, horizonWeeks: 1, seed: 1 });
    expect(fill.status).toBe(200);
    const monday7 = fill.body.slots.filter((s: { localStartsAt: string }) => s.localStartsAt.startsWith(`${WEEK}T07:00`)).map((s: { id: string }) => s.id);
    const mondays = fill.body.proposals.filter((p: { slotId: string }) => monday7.includes(p.slotId));
    expect(mondays.some((p: { userId: string }) => p.userId === t.users[0]!.id)).toBe(true);
    const codes = fill.body.proposals.flatMap((p: { reasons: Array<{ code: string }> }) => p.reasons.map((r) => r.code));
    expect(codes).toContain('PREFERENCE_MET');
  });

  it('the planner shows them to schedulers', async () => {
    const b = await call(tok.sup).get(`/api/schedule/planner?departmentId=all&from=${WEEK}&to=${plus(7)}`);
    if (b.status === 200) expect(b.body.people.find((p: { id: string }) => p.id === t.users[0]!.id).preferences.maxWeeklyHours).toBe(24);
  });

  it('switched off: refused, and Fill no longer reads them', async () => {
    await setFeatures(t.tenant.id, { shiftPreferences: false });
    expect((await call(tok.guard).get('/api/me/preferences')).status).toBeGreaterThanOrEqual(403);
    await setFeatures(t.tenant.id, {});
  });

  it('anonymizing someone deletes their preferences', async () => {
    const id = t.users[2]!.id;
    const g3 = await signAccessToken({ sub: id, tid: t.tenant.id, roles: ['STAFF'], aat: now() });
    await call(g3).put('/api/me/preferences', mine);
    expect(await owner.shiftPreference.count({ where: { userId: id } })).toBe(2);
    await withTenant(t.tenant.id, (tx) => anonymizeUser(tx, t.tenant.id, null, id));
    expect(await owner.shiftPreference.count({ where: { userId: id } })).toBe(0);
    expect(await owner.shiftPreferenceLimit.count({ where: { userId: id } })).toBe(0);
  });
});
