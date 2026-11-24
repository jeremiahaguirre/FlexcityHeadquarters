/**
 * The menu, the page guard and the API must agree: whoever is shown a menu item
 * can load that screen. Each built-in role, each switched-off feature, and a
 * custom role holding just one of the item's permissions opens every screen in
 * its menu and loads what the screen first asks for. A screen shown to people
 * whose API answers "no access" or "switched off" (a "No access" page or an
 * endless skeleton) fails here.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { signAccessToken } from '../../src/auth/tokens.js';
import { MENU } from '../../src/auth/menu.js';
import type { Permission } from '../../src/auth/permissions.js';
import { ROLE_PERMISSIONS } from '../../src/auth/permissions.js';
import { ALLOWED_CUSTOM_PERMISSIONS, withNeeds } from '../../src/services/people/customRoles.js';
import { FEATURE_KEYS, forgetFeatures } from '../../src/services/platform/features.js';
import type { AccessRole } from '../../src/generated/prisma/client.js';
import { app as appDb, owner, seedTenant } from './fixtures.js';

const server = createApp();
const SUB = 'menuaccess';
const FROM = '2026-06-01T00:00:00.000Z';
const TO = '2026-06-08T00:00:00.000Z';

/**
 * What each screen asks for when it opens. A [path, permissions] pair is asked
 * for only by people holding one of those permissions (the screen checks first).
 * Every menu item needs an entry, so a new screen can't skip this check.
 */
type Call = string | [string, Permission[]];
const LANDING: Record<string, Call[]> = {
  '/today': [`/api/me/shifts?from=${FROM}&to=${TO}`, ['/api/shiftboard/offers', ['shiftboard.claim']], ['/api/offers/pending', ['shiftboard.approve']], ['/api/time-off', ['timeoff.approve']], ['/api/punches', ['timeclock.review']], ['/api/ops/status', ['ops.status.read']]],
  '/schedule': [`/api/me/shifts?from=${FROM}&to=${TO}`],
  '/board': ['/api/shiftboard/offers'],
  '/timeclock': [`/api/me/punches?from=${FROM}&to=${TO}`],
  '/time-off': ['/api/me/time-off'],
  '/availability': ['/api/me/availability'],
  '/preferences': ['/api/me/preferences'],
  '/bids': ['/api/me/bids'],
  '/lessons': ['/api/me/lessons?from=2026-06-01&to=2026-06-09'],
  '/alone': ['/api/me/lone-work'],
  '/patrol': ['/api/me/patrols', '/api/winter/routes'],
  '/pretrip': ['/api/vehicles'],
  '/pay': ['/api/me/pay'],
  '/expenses': ['/api/me/expenses'],
  '/logbook': ['/api/facilities'],
  '/messages': ['/api/messages/conversations'],
  '/headcount': ['/api/ops/headcounts/current'],
  '/deck': ['/api/facilities'],
  '/status': ['/api/ops/pools'],
  '/ops': ['/api/ops/headcounts/current', `/api/ops/readings?from=${FROM}&to=${TO}`],
  '/incidents': [['/api/incidents?from=' + FROM + '&to=' + TO, ['incidents.read']]],
  // The overview, then each tab the person gets (lib/hr.ts hrTabs) and the staff list its forms pick from.
  '/manage/hr': [
    '/api/hr/overview',
    ['/api/leave/balances?year=2026', ['leave.manage']],
    ['/api/reviews', ['performance.manage']],
    ['/api/policies', ['policies.manage']],
    ['/api/grievances', ['grievances.manage']],
    ['/api/offboarding', ['users.write']],
    ['/api/users', ['performance.manage', 'grievances.manage', 'users.write']],
  ],
  '/members': ['/api/fees'],
  '/manage/programs': ['/api/campaigns', '/api/swim-levels'],
  '/manage/schedule': ['/api/schedule/fill/options'],
  '/manage/forecast': ['/api/facilities'],
  '/manage/approvals': [['/api/offers/pending', ['shiftboard.approve']], ['/api/time-off', ['timeoff.approve']], ['/api/punches', ['timeclock.review']], ['/api/trades', ['shiftboard.approve']]],
  '/manage/staff': ['/api/users?status=ACTIVE', '/api/positions'],
  '/manage/overtime': ['/api/positions', ['/api/overtime/policy', ['overtime.manage']]],
  '/manage/onboarding': ['/api/onboarding/people'],
  '/manage/training': ['/api/training'],
  '/manage/injuries': ['/api/injury-claims'],
  '/manage/care': ['/api/care/checkins'],
  '/manage/lone-work': ['/api/lone-work'],
  '/manage/call-outs': ['/api/call-outs'],
  '/manage/winter': ['/api/winter/settings', '/api/winter/routes'],
  '/manage/rotations': ['/api/schedule/rotations', '/api/facilities'],
  '/manage/shift-templates': ['/api/schedule/templates'],
  '/manage/bids': ['/api/bids/rounds'],
  '/manage/on-call': [`/api/schedule/on-call?from=${FROM}&to=${TO}`, '/api/positions'],
  '/manage/work-rules': [[`/api/schedule/changes?from=${FROM}&to=${TO}`, ['schedule.write', 'payroll.export']], '/api/schedule/work-rules'],
  '/manage/people': ['/api/people/review'],
  '/manage/org-chart': ['/api/org-chart'],
  '/manage/compliance': ['/api/facilities'],
  '/manage/fleet': ['/api/vehicles'],
  '/manage/coverage': ['/api/coverage/rules', '/api/coverage/gaps?from=2026-06-01&days=7'],
  '/manage/benchmarks': ['/api/benchmarks'],
  '/manage/certifications': ['/api/certifications/unverified'],
  '/manage/jobs': ['/api/jobs'],
  '/manage/payroll': ['/api/payroll/runs'],
  '/manage/expenses': ['/api/expenses?status=SUBMITTED'],
  '/manage/benefits': ['/api/benefits'],
  '/manage/accounting': ['/api/accounting/labour-cost?year=2026'],
  '/manage/fees': ['/api/fees'],
  '/manage/bookings': ['/api/bookable-services', '/api/bookings'],
  '/manage/reports': ['/api/reports', '/api/reports/saved'],
  '/manage/announcements': ['/api/announcements'],
  '/manage/messages': ['/api/messages-admin/reports'],
  '/manage/surveys': ['/api/surveys'],
  '/manage/roles': ['/api/roles'],
  '/manage/billing': ['/api/billing?lang=en-CA'],
  '/manage/settings': [['/api/settings', ['tenant.configure']], ['/api/ops/pools?all=1', ['ops.configure']]],
  '/union': ['/api/union/locals'],
  '/union/bids': ['/api/bids/rounds'],
  '/surveys': ['/api/me/surveys'],
};

let tenantId: string;
const tokens = new Map<string, string>();

async function tokenFor(key: string, roles: AccessRole[], customPerms?: Permission[]): Promise<string> {
  const hit = tokens.get(key);
  if (hit) return hit;
  const u = await owner.user.create({ data: { tenantId, roles, employmentStatus: 'FULL_TIME', firstName: 'Menu', lastName: key.replace(/[^a-z]/gi, ''), email: `${key.replace(/[^a-z0-9]/gi, '-')}@${SUB}.test` } });
  if (customPerms) {
    const r = await owner.customRole.create({ data: { tenantId, name: key, permissions: customPerms } });
    await owner.userCustomRole.create({ data: { tenantId, userId: u.id, customRoleId: r.id } });
  }
  const token = await signAccessToken({ sub: u.id, tid: tenantId, roles });
  tokens.set(key, token);
  return token;
}

const get = (token: string, path: string) => request(server).get(path).set('x-tenant-subdomain', SUB).auth(token, { type: 'bearer' });

/** The menu as the app shows it (apps/web/src/lib/nav.ts visibleNav), from /api/me. */
async function menuOf(token: string) {
  const me = (await get(token, '/api/me')).body as { permissions: string[]; hiddenMenu: string[]; features: Record<string, boolean> };
  const can = (p: string) => me.permissions.includes(p);
  return { can, items: MENU.filter((m) => !me.hiddenMenu.includes(m.href) && m.permissions.some(can) && !(m.feature && me.features[m.feature] === false)) };
}

/** Opens every screen in the person's menu; returns the screens whose first requests failed. */
async function brokenScreens(token: string): Promise<string[]> {
  const { can, items } = await menuOf(token);
  const broken: string[] = [];
  for (const m of items) {
    for (const c of LANDING[m.href] ?? []) {
      const [path, only] = typeof c === 'string' ? [c, null] : c;
      if (only && !only.some(can)) continue;
      const res = await get(token, path);
      if (res.status >= 400) broken.push(`${m.href} → GET ${path}: ${res.status} ${res.body?.code ?? ''}`);
    }
  }
  return broken;
}

beforeAll(async () => {
  const t = await seedTenant(SUB, 0);
  tenantId = t.tenant.id;
});
afterAll(async () => {
  await appDb.$disconnect();
  await owner.$disconnect();
});

const ROLES = Object.keys(ROLE_PERMISSIONS) as AccessRole[];

describe('menu, page guard and API agree', () => {
  it('every menu item says what its screen loads first', () => {
    expect(MENU.filter((m) => !LANDING[m.href]).map((m) => m.href)).toEqual([]);
  });

  it.each(ROLES)('%s: every screen in the menu loads', async (role) => {
    expect((await brokenScreens(await tokenFor(`role-${role}`, [role]))).join('\n')).toBe('');
  });

  it.each(FEATURE_KEYS.filter((f) => f !== 'union'))('with %s switched off, every role’s menu still loads', async (feature) => {
    await owner.tenant.update({ where: { id: tenantId }, data: { features: { [feature]: false } } });
    forgetFeatures(tenantId);
    try {
      const broken: string[] = [];
      for (const role of ROLES) broken.push(...(await brokenScreens(await tokenFor(`role-${role}`, [role]))).map((b) => `${role}: ${b}`));
      expect(broken.join('\n')).toBe('');
    } finally {
      await owner.tenant.update({ where: { id: tenantId }, data: { features: {} } });
      forgetFeatures(tenantId);
    }
  });

  it('My pay follows the payroll switch, not the timeclock, and salaried HR has it too', async () => {
    const hrefs = async (role: AccessRole) => (await menuOf(await tokenFor(`role-${role}`, [role]))).items.map((m) => m.href);
    expect(await hrefs('HR_ADMIN')).toContain('/pay');
    await owner.tenant.update({ where: { id: tenantId }, data: { features: { timeclock: false } } });
    forgetFeatures(tenantId);
    try {
      for (const role of ['STAFF', 'FRONT_DESK', 'EMPLOYEE', 'HR_ADMIN'] as const) expect(await hrefs(role), role).toContain('/pay');
      await owner.tenant.update({ where: { id: tenantId }, data: { features: { payroll: false } } });
      forgetFeatures(tenantId);
      for (const role of ROLES) expect(await hrefs(role), role).not.toContain('/pay');
    } finally {
      await owner.tenant.update({ where: { id: tenantId }, data: { features: {} } });
      forgetFeatures(tenantId);
    }
  });

  // One custom role per menu permission a city can give: the screen it shows must load with only that
  // capability, plus what the role is saved with for it (customRoles.ts CUSTOM_PERMISSION_NEEDS).
  const single = [...new Set(MENU.flatMap((m) => m.permissions))].filter((p) => ALLOWED_CUSTOM_PERMISSIONS.has(p));
  it.each(single)('a custom role holding only %s', async (p) => {
    expect((await brokenScreens(await tokenFor(`only-${p}`, [], withNeeds([p])))).join('\n')).toBe('');
  });
});

describe('the API refuses what the menu doesn’t offer', () => {
  it('My pay: without pay.self (a union steward) the pay API refuses too, reads and changes alike', async () => {
    const steward = await tokenFor('role-UNION_STEWARD', ['UNION_STEWARD']);
    expect((await menuOf(steward)).items.map((m) => m.href)).not.toContain('/pay');
    expect((await get(steward, '/api/me/pay')).status).toBe(403);
    const deposit = await request(server).post('/api/me/bank-accounts').set('x-tenant-subdomain', SUB).auth(steward, { type: 'bearer' }).send({ holderName: 'S', institution: '004', transit: '12345', account: '1234567' });
    expect(deposit.status).toBe(403);
    expect(await owner.bankAccount.count({ where: { tenantId } })).toBe(0);
  });
});

describe('overtime standings for union stewards', () => {
  // Stewards hold seniority.read while the city has the union feature on.
  const withFeatures = async (features: Record<string, boolean>, fn: () => Promise<void>) => {
    await owner.tenant.update({ where: { id: tenantId }, data: { features } });
    forgetFeatures(tenantId);
    try {
      await fn();
    } finally {
      await owner.tenant.update({ where: { id: tenantId }, data: { features: {} } });
      forgetFeatures(tenantId);
    }
  };

  it('a steward opens Overtime from the menu and reads the order, but can’t record call-outs or see the policy form', async () => {
    const steward = await tokenFor('role-UNION_STEWARD', ['UNION_STEWARD']);
    const position = await owner.position.create({ data: { tenantId, name: 'Overtime lifeguard' } });
    await withFeatures({ union: true }, async () => {
      expect((await menuOf(steward)).items.map((m) => m.href)).toContain('/manage/overtime');
      // What the screen asks for when it opens (the Union hub itself needs the city's hub connection, not set up here).
      expect((await get(steward, '/api/positions')).status).toBe(200);
      const r = await get(steward, `/api/overtime/standings?positionId=${position.id}`);
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ policy: expect.any(Object), rows: [] });
      expect((await get(steward, '/api/overtime/policy')).status).toBe(403);
      const entry = await request(server).post('/api/overtime/entries').set('x-tenant-subdomain', SUB).auth(steward, { type: 'bearer' }).send({ userId: position.id, positionId: position.id, kind: 'REFUSED', hours: '4', occurredAt: new Date().toISOString() });
      expect(entry.status).toBe(403);
    });
  });

  it('hides it while overtime is switched off', async () => {
    const steward = await tokenFor('role-UNION_STEWARD', ['UNION_STEWARD']);
    await withFeatures({ union: true, overtime: false }, async () => {
      expect((await menuOf(steward)).items.map((m) => m.href)).not.toContain('/manage/overtime');
      expect((await menuOf(steward)).items.map((m) => m.href)).toContain('/union');
    });
  });
});

describe('HR home for someone limited to a department', () => {
  it('counts only what their own lists show them', async () => {
    const mine = await owner.position.create({ data: { tenantId, name: 'Water operator' } });
    const mk = async (name: string, positionId?: string) => {
      const u = await owner.user.create({ data: { tenantId, roles: ['EMPLOYEE'], employmentStatus: 'FULL_TIME', firstName: name, lastName: 'Scope', email: `${name}@${SUB}.test` } });
      if (positionId) await owner.userPosition.create({ data: { tenantId, userId: u.id, positionId } });
      return u;
    };
    const inside = await mk('inside', mine.id);
    const outside = await mk('outside');
    const hr = await owner.user.create({ data: { tenantId, roles: ['HR_ADMIN'], employmentStatus: 'FULL_TIME', firstName: 'Hr', lastName: 'Scope', email: `hr-scope@${SUB}.test` } });
    const manager = await mk('manager', mine.id);
    const role = await owner.customRole.create({ data: { tenantId, name: 'Water Works manager', permissions: withNeeds(['performance.manage', 'grievances.manage']), scopePositionIds: [mine.id] } });
    await owner.userCustomRole.create({ data: { tenantId, userId: manager.id, customRoleId: role.id } });
    const past = new Date('2026-01-01');
    await owner.grievance.create({ data: { tenantId, number: 901, title: 'Overtime order', filedOn: past, userId: outside.id, createdById: hr.id } });
    await owner.grievance.create({ data: { tenantId, number: 902, title: 'Call-in pay', filedOn: past, userId: inside.id, createdById: hr.id } });
    await owner.performanceReview.create({ data: { tenantId, userId: outside.id, reviewerId: hr.id, cycle: '2026', dueOn: past, createdById: hr.id } });
    await owner.performanceReview.create({ data: { tenantId, userId: inside.id, reviewerId: manager.id, cycle: '2026', dueOn: past, createdById: hr.id } });

    const scoped = (await get(await signAccessToken({ sub: manager.id, tid: tenantId, roles: ['EMPLOYEE'] }), '/api/hr/overview')).body;
    expect(scoped).toMatchObject({ openGrievances: 1, reviewsOpen: 1, reviewsLate: 1 });
    // The people they reach: those holding the department's position.
    expect(scoped.staff).toBe(2);
    const all = (await get(await signAccessToken({ sub: hr.id, tid: tenantId, roles: ['HR_ADMIN'] }), '/api/hr/overview')).body;
    expect(all.openGrievances).toBe(2);
    expect(all.reviewsOpen).toBe(2);
    expect(all.staff).toBeGreaterThan(scoped.staff);
  });
});

describe('custom roles carry what their screens need', () => {
  it('a role saved with roles.manage, performance.manage, grievances.manage or users.write also holds users.read, visibly', async () => {
    const hr = await tokenFor('role-HR_ADMIN', ['HR_ADMIN']);
    const r = await request(server).post('/api/roles').set('x-tenant-subdomain', SUB).auth(hr, { type: 'bearer' }).send({ name: 'Role admin', permissions: ['roles.manage'] });
    expect(r.status).toBe(201);
    expect((await owner.customRole.findUniqueOrThrow({ where: { id: r.body.id } })).permissions.sort()).toEqual(['roles.manage', 'users.read']);
    // Access follows what is saved, nothing added on the way in: a role stored without the need doesn't get it.
    const bare = await tokenFor('bare-roles', [], ['roles.manage']);
    expect((await get(bare, '/api/me')).body.permissions).not.toContain('users.read');
  });

  it('the migration gives roles saved earlier what they now need, and pay.self to those who clock in', async () => {
    const old = await owner.customRole.create({ data: { tenantId, name: 'Saved earlier', permissions: ['shifts.self', 'timeclock.punch', 'grievances.manage'] } });
    const untouched = await owner.customRole.create({ data: { tenantId, name: 'Read only', permissions: ['schedule.read'] } });
    const sql = readFileSync(join(__dirname, '../../prisma/migrations/20261116180000_custom_role_needs/migration.sql'), 'utf8');
    for (const statement of sql.split(';').map((x) => x.replace(/--.*$/gm, '').trim()).filter(Boolean)) await owner.$executeRawUnsafe(`${statement} AND "tenantId" = '${tenantId}'::uuid`); // this test's city only
    expect((await owner.customRole.findUniqueOrThrow({ where: { id: old.id } })).permissions.sort()).toEqual(['grievances.manage', 'pay.self', 'shifts.self', 'timeclock.punch', 'users.read']);
    expect((await owner.customRole.findUniqueOrThrow({ where: { id: untouched.id } })).permissions).toEqual(['schedule.read']);
  });
});
